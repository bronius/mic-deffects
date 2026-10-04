const EFFECTS = [
  {
    id: "reversed-fricatives",
    label: "Reversed Fricatives",
    workletUrl: "worklets/reversed-fricatives-processor.js",
    processorName: "reversed-fricatives",
  },
  {
    id: "spooky-halloween-voice",
    label: "Spooky Halloween Voice",
    workletUrl: "worklets/spooky-voice-processor.js",
    processorName: "spooky-halloween-voice",
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

const tuningGroups = document.querySelectorAll(".tuning-group");
const legendLabelPassEl = document.querySelector(".legend-label-pass");
const legendLabelHitEl = document.querySelector(".legend-label-hit");
const legendSwatchPassEl = document.querySelector(".legend-swatch--pass");
const legendSwatchHitEl = document.querySelector(".legend-swatch--hit");
const frameFlowLabelEl = document.querySelector(".frame-flow-label");

// Per-effect frame-flow styling: bar colors/labels plus an optional soft
// "accentGlow" treatment for the top-of-bar marker (used by Spooky Halloween
// Voice for a Halloween-colored, softened flame tip instead of the sharp
// amber strip the fricatives effect uses).
const FRAME_FLOW_STYLE = {
  "reversed-fricatives": {
    title: "frame flow",
    pass: { label: "capture", color: "#5eead4", alpha: 0.55 },
    hit: { label: "reversed", color: "#ff6ec7" },
    accent: { color: "#fbbf24" },
  },
  "spooky-halloween-voice": {
    title: "grain flow",
    pass: { label: "grain A", color: "#f97316", alpha: 0.55 }, // pumpkin orange
    hit: { label: "grain B", color: "#a855f7" }, // witch purple
    accent: { color: "#ffb347", glow: "rgba(255, 140, 40, 0.65)", core: "#fff4c2" }, // soft flame tip
  },
};

function frameFlowStyle() {
  return FRAME_FLOW_STYLE[effectSelect.value] ?? FRAME_FLOW_STYLE["reversed-fricatives"];
}

function updateEffectUi() {
  const activeId = effectSelect.value;
  for (const group of tuningGroups) {
    group.hidden = group.dataset.effect !== activeId;
  }
  const style = frameFlowStyle();
  frameFlowLabelEl.textContent = style.title;
  legendLabelPassEl.textContent = style.pass.label;
  legendLabelHitEl.textContent = style.hit.label;
  legendSwatchPassEl.style.background = style.pass.color;
  legendSwatchPassEl.style.opacity = style.pass.alpha;
  legendSwatchHitEl.style.background = style.hit.color;
  legendSwatchHitEl.style.opacity = 1;
  resetFrameFlow();
}

effectSelect.addEventListener("change", updateEffectUi);

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
  const style = frameFlowStyle();

  frameHistory.forEach((frame, i) => {
    const x = i * colWidth;
    const barHeight = Math.max(2, Math.min(1, frame.rms * 8) * h); // *8: tune by ear
    const y = h - barHeight;

    frameFlowCtx.globalAlpha = frame.reversed ? 1 : style.pass.alpha;
    frameFlowCtx.fillStyle = frame.reversed ? style.hit.color : style.pass.color;
    frameFlowCtx.fillRect(x, y, barWidth, barHeight);

    if (frame.reversed) {
      frameFlowCtx.globalAlpha = 1;
      if (style.accent.glow) {
        // Softened "flame tip": a warm core fading to the accent color, with
        // a gentle blur instead of the fricatives effect's flat, sharp strip.
        frameFlowCtx.save();
        frameFlowCtx.shadowColor = style.accent.glow;
        frameFlowCtx.shadowBlur = 5;
        const gradient = frameFlowCtx.createLinearGradient(x, 0, x, 6);
        gradient.addColorStop(0, style.accent.core);
        gradient.addColorStop(1, style.accent.color);
        frameFlowCtx.fillStyle = gradient;
        frameFlowCtx.fillRect(x, 0, barWidth, 4);
        frameFlowCtx.restore();
      } else {
        frameFlowCtx.fillStyle = style.accent.color;
        frameFlowCtx.fillRect(x, 0, barWidth, 3);
      }
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

// Live-tunable params for Spooky Halloween Voice.
// Defaults mirror worklets/spooky-voice-processor.js; see TUNING.md.
let pitchSemitones = -7;
let grainSize = 2048;

function semitonesToRatio(semitones) {
  return Math.pow(2, semitones / 12);
}

const frameSizeMsEl = document.querySelector("#frame-size-ms");
const grainSizeMsEl = document.querySelector("#grain-size-ms");
const pitchShiftStEl = document.querySelector("#pitch-shift-st");

function updateFrameSizeLabel() {
  const sampleRate = audioContext?.sampleRate ?? 44100;
  frameSizeMsEl.textContent = `${Math.round((frameSize / sampleRate) * 1000)} ms`;
}

function updateGrainSizeLabel() {
  const sampleRate = audioContext?.sampleRate ?? 44100;
  grainSizeMsEl.textContent = `${Math.round((grainSize / sampleRate) * 1000)} ms`;
}

function updatePitchShiftLabel() {
  pitchShiftStEl.textContent = `${pitchSemitones} st`;
}

const PROCESSOR_OPTIONS_BY_EFFECT = {
  "reversed-fricatives": () => ({ frameSize, energyThreshold, peakThreshold }),
  "spooky-halloween-voice": () => ({ grainSize, pitchRatio: semitonesToRatio(pitchSemitones) }),
};

function sendParamsToWorklet() {
  if (!effectNode) return;
  const build = PROCESSOR_OPTIONS_BY_EFFECT[effectSelect.value];
  if (build) effectNode.port.postMessage(build());
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
bindTuningControl(
  document.querySelector("#pitch-shift-range"),
  document.querySelector("#pitch-shift-number"),
  (value) => {
    pitchSemitones = value;
    updatePitchShiftLabel();
    sendParamsToWorklet();
  },
);
bindTuningControl(
  document.querySelector("#grain-size-range"),
  document.querySelector("#grain-size-number"),
  (value) => {
    grainSize = value;
    updateGrainSizeLabel();
    sendParamsToWorklet();
  },
);
updateFrameSizeLabel();
updateGrainSizeLabel();
updatePitchShiftLabel();

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
      processorOptions: PROCESSOR_OPTIONS_BY_EFFECT[effect.id]?.() ?? {},
    });
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 512;
    recDestination = audioContext.createMediaStreamDestination();

    sourceNode.connect(effectNode);
    effectNode.connect(analyserNode);
    analyserNode.connect(audioContext.destination);
    effectNode.connect(recDestination); // post-effect tap, so recordings hear what you hear

    updateFrameSizeLabel();
    updateGrainSizeLabel();
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

updateEffectUi();
updateTransportUI();
setStatus(IDLE_STATUS);
