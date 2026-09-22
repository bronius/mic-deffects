const EFFECTS = [
  {
    id: "reversed-fricatives",
    label: "Reversed Fricatives",
    workletUrl: "worklets/reversed-fricatives-processor.js",
    processorName: "reversed-fricatives",
  },
];

const IDLE_STATUS = "Tap to start — headphones recommended to avoid feedback";

const micButton = document.querySelector(".mic-button");
const effectSelect = document.querySelector(".effect-select");
const levelFill = document.querySelector(".level-meter-fill");
const statusEl = document.querySelector(".status");
const frameFlowCanvas = document.querySelector(".frame-flow-canvas");
const frameFlowCtx = frameFlowCanvas.getContext("2d");
const helpButton = document.querySelector(".help-button");
const helpDialog = document.querySelector(".help-dialog");
const helpDialogClose = document.querySelector(".help-dialog-close");
const recButton = document.querySelector(".rec-button");
const recTimeEl = document.querySelector(".rec-time");
const playButton = document.querySelector(".play-button");

helpButton.addEventListener("click", () => helpDialog.showModal());
helpDialogClose.addEventListener("click", () => helpDialog.close());

for (const effect of EFFECTS) {
  const option = document.createElement("option");
  option.value = effect.id;
  option.textContent = effect.label;
  effectSelect.appendChild(option);
}

let listening = false;
let audioContext = null;
let mediaStream = null;
let sourceNode = null;
let effectNode = null;
let analyserNode = null;
let meterHandle = null;
let recDestination = null;

const MAX_FRAMES = 64; // rolling history length, in frames — actual duration depends on the tunable frame size
let frameHistory = [];

function resizeFrameFlowCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = frameFlowCanvas.getBoundingClientRect();
  frameFlowCanvas.width = rect.width * dpr;
  frameFlowCanvas.height = rect.height * dpr;
  frameFlowCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawFrameFlow() {
  const rect = frameFlowCanvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  frameFlowCtx.clearRect(0, 0, w, h);

  const colWidth = w / MAX_FRAMES;
  const barWidth = Math.max(1, colWidth - Math.min(2, colWidth * 0.2));

  frameHistory.forEach((frame, i) => {
    const x = i * colWidth;
    const barHeight = Math.max(2, Math.min(1, frame.rms * 8) * h); // *8: tune by ear
    const y = h - barHeight;

    frameFlowCtx.globalAlpha = frame.reversed ? 1 : 0.55;
    frameFlowCtx.fillStyle = frame.reversed ? "#ff6ec7" : "#5eead4";
    frameFlowCtx.fillRect(x, y, barWidth, barHeight);

    if (frame.reversed) {
      frameFlowCtx.globalAlpha = 1;
      frameFlowCtx.fillStyle = "#fbbf24";
      frameFlowCtx.fillRect(x, 0, barWidth, 3);
    }
  });
  frameFlowCtx.globalAlpha = 1;
}

function resetFrameFlow() {
  frameHistory = [];
  resizeFrameFlowCanvas();
  drawFrameFlow();
}

window.addEventListener("resize", resizeFrameFlowCanvas);

// Live-tunable detector params — sent to the worklet whenever they change.
// Defaults mirror worklets/reversed-fricatives-processor.js; see TUNING.md.
let frameSize = 3584;
let energyThreshold = 0.088;
let peakThreshold = 0.045;

const frameSizeMsEl = document.querySelector("#frame-size-ms");

function updateFrameSizeLabel() {
  const sampleRate = audioContext?.sampleRate ?? 44100;
  frameSizeMsEl.textContent = `${Math.round((frameSize / sampleRate) * 1000)} ms`;
}

function sendParamsToWorklet() {
  effectNode?.port.postMessage({ frameSize, energyThreshold, peakThreshold });
}

function bindTuningControl(rangeEl, numberEl, onChange) {
  const apply = (value) => {
    rangeEl.value = value;
    numberEl.value = value;
    onChange(Number(value));
  };
  rangeEl.addEventListener("input", () => apply(rangeEl.value));
  numberEl.addEventListener("change", () => {
    const clamped = Math.min(Number(numberEl.max), Math.max(Number(numberEl.min), Number(numberEl.value) || 0));
    apply(clamped);
  });
}

bindTuningControl(
  document.querySelector("#frame-size-range"),
  document.querySelector("#frame-size-number"),
  (value) => {
    frameSize = value;
    updateFrameSizeLabel();
    sendParamsToWorklet();
  },
);
bindTuningControl(
  document.querySelector("#energy-threshold-range"),
  document.querySelector("#energy-threshold-number"),
  (value) => {
    energyThreshold = value;
    sendParamsToWorklet();
  },
);
bindTuningControl(
  document.querySelector("#peak-threshold-range"),
  document.querySelector("#peak-threshold-number"),
  (value) => {
    peakThreshold = value;
    sendParamsToWorklet();
  },
);
updateFrameSizeLabel();

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function setUiListening(next) {
  listening = next;
  micButton.classList.toggle("listening", listening);
  micButton.textContent = listening ? "Stop" : "Start";
  effectSelect.disabled = listening;
  updateTransportUI();
}

function browserSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.AudioContext);
}

function startLevelMeter() {
  const data = new Float32Array(analyserNode.fftSize);
  const tick = () => {
    analyserNode.getFloatTimeDomainData(data);
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) sumSquares += data[i] * data[i];
    const rms = Math.sqrt(sumSquares / data.length);
    levelFill.style.width = `${Math.min(100, rms * 400)}%`;
    meterHandle = requestAnimationFrame(tick);
  };
  tick();
}

function stopLevelMeter() {
  if (meterHandle) cancelAnimationFrame(meterHandle);
  meterHandle = null;
  levelFill.style.width = "0%";
}

async function start() {
  if (!browserSupported()) {
    setStatus("Your browser doesn't support the audio APIs this needs — try the latest Chrome, Edge, or Firefox.", true);
    return;
  }

  const effect = EFFECTS.find((e) => e.id === effectSelect.value) ?? EFFECTS[0];

  setStatus("Requesting mic access — click “Allow” in the browser prompt.");

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false },
    });
  } catch (err) {
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      setStatus("Mic access was blocked. Allow it in your browser's site settings, then tap Start again.", true);
    } else if (err.name === "NotFoundError") {
      setStatus("No microphone found on this device.", true);
    } else {
      setStatus("Couldn't access the microphone. Please try again.", true);
    }
    return;
  }

  try {
    audioContext = new AudioContext();
    await audioContext.audioWorklet.addModule(effect.workletUrl);

    mediaStream = stream;
    sourceNode = audioContext.createMediaStreamSource(stream);
    effectNode = new AudioWorkletNode(audioContext, effect.processorName, {
      channelCount: 1,
      channelCountMode: "explicit",
      processorOptions: { frameSize, energyThreshold, peakThreshold },
    });
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 512;
    recDestination = audioContext.createMediaStreamDestination();

    sourceNode.connect(effectNode);
    effectNode.connect(analyserNode);
    analyserNode.connect(audioContext.destination);
    effectNode.connect(recDestination); // post-effect tap, so recordings hear what you hear

    updateFrameSizeLabel();
    resetFrameFlow();
    effectNode.port.onmessage = (event) => {
      frameHistory.push(event.data);
      if (frameHistory.length > MAX_FRAMES) frameHistory.shift();
      drawFrameFlow();
    };

    setUiListening(true);
    setStatus("Listening…");
    startLevelMeter();
  } catch (err) {
    setStatus("This browser doesn't support the audio pipeline this needs (AudioWorklet).", true);
    stream.getTracks().forEach((t) => t.stop());
    await audioContext?.close();
    audioContext = null;
  }
}

async function stop() {
  stopLevelMeter();
  resetFrameFlow();
  sourceNode?.disconnect();
  effectNode?.disconnect();
  analyserNode?.disconnect();
  recDestination?.disconnect();
  mediaStream?.getTracks().forEach((t) => t.stop());
  await audioContext?.close();

  audioContext = null;
  sourceNode = null;
  effectNode = null;
  analyserNode = null;
  recDestination = null;
  mediaStream = null;

  setUiListening(false);
  setStatus(IDLE_STATUS);
}

micButton.addEventListener("click", () => {
  if (listening) {
    stop();
  } else {
    start();
  }
});

// Recording: taps recDestination (see start()) via MediaRecorder, capped at
// REC_MAX_MS. Stopping the recording — by hand or via the cap — also ends
// the live session, per the UX: REC-stop lands you in "Start or Play" state.
const REC_MAX_MS = 15000;
let recorder = null;
let recChunks = [];
let recordedUrl = null;
let recordedBlobSize = 0;
let recordedBlobType = "";
let recording = false;
let recTimeoutHandle = null;
let recTickHandle = null;
let recStartTime = 0;

let playing = false;
const playbackAudio = new Audio();
playbackAudio.addEventListener("ended", () => {
  playing = false;
  updateTransportUI();
});

function updateTransportUI() {
  recButton.hidden = !listening;
  recButton.classList.toggle("recording", recording);
  recButton.textContent = recording ? "■ Stop" : "● REC";
  recTimeEl.hidden = !recording;

  playButton.hidden = listening || !recordedUrl;
  playButton.classList.toggle("playing", playing);
  playButton.textContent = playing ? "■ Stop" : "▶ Play";

  micButton.disabled = recording || playing;
}

function pickRecorderMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  return candidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) ?? "";
}

function updateRecTime() {
  const elapsed = Math.min(REC_MAX_MS, performance.now() - recStartTime);
  recTimeEl.textContent = `${(elapsed / 1000).toFixed(1)}s / ${(REC_MAX_MS / 1000).toFixed(0)}s`;
}

function startRecording() {
  if (!listening || recording || !recDestination) return;

  recChunks = [];
  const mimeType = pickRecorderMimeType();
  recorder = new MediaRecorder(recDestination.stream, mimeType ? { mimeType } : undefined);
  recorder.ondataavailable = (e) => {
    if (e.data.size) recChunks.push(e.data);
  };
  recorder.onstop = () => {
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    const blob = new Blob(recChunks, { type: recorder.mimeType || "audio/webm" });
    recordedBlobSize = blob.size;
    recordedBlobType = blob.type;
    recordedUrl = URL.createObjectURL(blob);
    console.log(`Recording finalized: ${blob.size} bytes, type=${blob.type}`);
    updateTransportUI();
  };
  recorder.start();

  recording = true;
  recStartTime = performance.now();
  updateRecTime();
  recTickHandle = setInterval(updateRecTime, 200);
  recTimeoutHandle = setTimeout(stopRecording, REC_MAX_MS);
  updateTransportUI();
}

function finishMediaRecorder() {
  // recorder.stop() finalizes asynchronously (dataavailable + stop events) —
  // wait for that before tearing down the AudioContext, or the recording
  // gets cut off mid-flush and comes out empty.
  return new Promise((resolve) => {
    if (!recorder || recorder.state === "inactive") {
      resolve();
      return;
    }
    recorder.addEventListener("stop", resolve, { once: true });
    recorder.stop();
  });
}

async function stopRecording() {
  clearTimeout(recTimeoutHandle);
  clearInterval(recTickHandle);
  recTimeoutHandle = null;
  recTickHandle = null;

  await finishMediaRecorder();
  await stop();
  recording = false;

  if (recordedUrl) {
    const kb = Math.max(1, Math.round(recordedBlobSize / 1024));
    setStatus(`Recording ready — ${kb}KB (${recordedBlobType || "unknown type"}). Press ▶ Play.`);
  }
}

function playRecording() {
  if (!recordedUrl || listening) return;
  playbackAudio.src = recordedUrl;
  playbackAudio.currentTime = 0;
  playbackAudio.play().catch((err) => {
    console.error("Playback failed:", err);
    setStatus(`Couldn't play back the recording (${err?.name || "unknown error"}).`, true);
    playing = false;
    updateTransportUI();
  });
  playing = true;
  updateTransportUI();
}

function stopPlayback() {
  playbackAudio.pause();
  playbackAudio.currentTime = 0;
  playing = false;
  updateTransportUI();
}

recButton.addEventListener("click", () => {
  if (recording) {
    stopRecording();
  } else {
    startRecording();
  }
});

playButton.addEventListener("click", () => {
  if (playing) {
    stopPlayback();
  } else {
    playRecording();
  }
});

resetFrameFlow();
updateTransportUI();
setStatus(IDLE_STATUS);
