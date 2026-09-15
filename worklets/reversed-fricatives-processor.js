// Blocky (non-overlapping) frame processor: buffers input into fixed-size
// frames, flags fricative-like frames via a high-passed energy/peak check,
// and reverses only those frames before playback. Overlap-add smoothing is
// a documented follow-up, not done here — see README "open questions".
//
// frameSize / energyThreshold / peakThreshold are live-tunable from the main
// thread (the "Tuning" panel in index.html) via port messages — the consts
// below are just startup defaults. See TUNING.md for what each one does.
const DEFAULT_FRAME_SIZE = 2048; // ~46ms at 44.1kHz
const DEFAULT_ENERGY_THRESHOLD = 0.012; // RMS of the high-passed frame — sustained noise (S, F)
const DEFAULT_PEAK_THRESHOLD = 0.09; // peak |high-passed sample| — brief bursts (P, T, K, hard C)

class ReversedFricativesProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const params = options?.processorOptions ?? {};
    this.frameSize = params.frameSize ?? DEFAULT_FRAME_SIZE;
    this.energyThreshold = params.energyThreshold ?? DEFAULT_ENERGY_THRESHOLD;
    this.peakThreshold = params.peakThreshold ?? DEFAULT_PEAK_THRESHOLD;

    this.inputFrame = new Float32Array(this.frameSize);
    this.inputFill = 0;
    this.outputQueue = [];

    this.port.onmessage = (event) => this.applyParams(event.data);
  }

  applyParams(params) {
    if (!params) return;
    if (typeof params.energyThreshold === "number") this.energyThreshold = params.energyThreshold;
    if (typeof params.peakThreshold === "number") this.peakThreshold = params.peakThreshold;
    if (typeof params.frameSize === "number" && params.frameSize !== this.frameSize) {
      // A live frame-size change drops whatever's mid-buffer instead of resizing
      // in place — worth a tiny click, not worth the complexity of preserving it.
      this.frameSize = params.frameSize;
      this.inputFrame = new Float32Array(this.frameSize);
      this.inputFill = 0;
    }
  }

  process(inputs, outputs) {
    const input = inputs[0][0];
    const output = outputs[0][0];

    if (input) {
      for (let i = 0; i < input.length; i++) {
        this.inputFrame[this.inputFill++] = input[i];
        if (this.inputFill === this.frameSize) {
          this.outputQueue.push({ data: this.processFrame(this.inputFrame), readPos: 0 });
          this.inputFrame = new Float32Array(this.frameSize);
          this.inputFill = 0;
        }
      }
    }

    this.fillOutput(output);
    return true;
  }

  processFrame(frame) {
    let prev = 0;
    let signalEnergy = 0;
    let highPassEnergy = 0;
    let highPassPeak = 0;
    for (let i = 0; i < frame.length; i++) {
      const sample = frame[i];
      const highPassed = sample - prev;
      prev = sample;
      signalEnergy += sample * sample;
      highPassEnergy += highPassed * highPassed;
      const absHighPassed = Math.abs(highPassed);
      if (absHighPassed > highPassPeak) highPassPeak = absHighPassed;
    }
    const rms = Math.sqrt(signalEnergy / frame.length);
    const highPassRms = Math.sqrt(highPassEnergy / frame.length);
    const reversed = highPassRms > this.energyThreshold || highPassPeak > this.peakThreshold;

    if (reversed) {
      frame.reverse();
    }

    // Lets the main thread draw the frame-flow diagram without touching the audio path.
    this.port.postMessage({ rms, reversed });
    return frame;
  }

  fillOutput(output) {
    let written = 0;
    while (written < output.length) {
      const item = this.outputQueue[0];
      if (!item) {
        output.fill(0, written);
        return;
      }
      const available = item.data.length - item.readPos;
      const toCopy = Math.min(available, output.length - written);
      output.set(item.data.subarray(item.readPos, item.readPos + toCopy), written);
      item.readPos += toCopy;
      written += toCopy;
      if (item.readPos >= item.data.length) {
        this.outputQueue.shift();
      }
    }
  }
}

registerProcessor("reversed-fricatives", ReversedFricativesProcessor);
