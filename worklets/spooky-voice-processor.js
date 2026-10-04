// Real-time pitch-down ("demon growl") via a simple two-grain granular
// pitch shifter — no FFT, no library. Two read "grains" pull from a shared
// circular buffer at pitchRatio (<1 = lower pitch) while writes land at the
// normal 1x rate. Each grain is weighted by a Hann window over its phase
// (0 at the edges, 1 at the midpoint); the grains are phase-offset by half a
// period, so their windows sum to exactly 1 (0.5-0.5cos(x) + 0.5-0.5cos(x+pi)
// = 1) — meaning the crossfade between them is seamless. When a grain's
// phase wraps (window back at 0, so no audible seam), its read position is
// resynced to ~grainSize samples behind the write head, preventing the
// ever-growing drift that pitchRatio < 1 would otherwise cause.
//
// grainSize / pitchRatio are live-tunable from the main thread (the
// "Tuning" panel in index.html) via port messages — the consts below are
// just startup defaults. See TUNING.md.
const DEFAULT_GRAIN_SIZE = 2048; // ~46ms at 44.1kHz
const DEFAULT_PITCH_RATIO = Math.pow(2, -7 / 12); // -7 semitones

class SpookyVoiceProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const params = options?.processorOptions ?? {};
    this.grainSize = params.grainSize ?? DEFAULT_GRAIN_SIZE;
    this.pitchRatio = params.pitchRatio ?? DEFAULT_PITCH_RATIO;

    this.allocate();
    this.port.onmessage = (event) => this.applyParams(event.data);
  }

  allocate() {
    // 4x grainSize gives enough headroom for the read head to lag the write
    // head by up to ~2x grainSize mid-cycle at the slowest supported pitch
    // ratio (0.5, i.e. -12 semitones) without the write head lapping it.
    this.bufferLen = this.grainSize * 4;
    this.buffer = new Float32Array(this.bufferLen);
    this.writePos = 0;
    this.grains = [
      { phase: 0, readPos: 0, label: false },
      { phase: this.grainSize / 2, readPos: 0, label: true },
    ];
    for (const g of this.grains) {
      g.readPos = this.mod(this.writePos - this.grainSize + g.phase, this.bufferLen);
    }
    this.reportEnergy = 0;
    this.reportCount = 0;
  }

  applyParams(params) {
    if (!params) return;
    if (typeof params.pitchRatio === "number") this.pitchRatio = params.pitchRatio;
    if (typeof params.grainSize === "number" && params.grainSize !== this.grainSize) {
      // A live grain-size change drops whatever's mid-buffer instead of
      // resizing in place — worth a tiny click, same tradeoff as the
      // reversed-fricatives frame-size change. See TUNING.md.
      this.grainSize = params.grainSize;
      this.allocate();
    }
  }

  mod(n, m) {
    return ((n % m) + m) % m;
  }

  readInterpolated(pos) {
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = this.buffer[this.mod(i0, this.bufferLen)];
    const b = this.buffer[this.mod(i0 + 1, this.bufferLen)];
    return a + (b - a) * frac;
  }

  process(inputs, outputs) {
    const input = inputs[0][0];
    const output = outputs[0][0];
    if (!input) {
      output.fill(0);
      return true;
    }

    const N = this.grainSize;
    const r = this.pitchRatio;

    for (let i = 0; i < input.length; i++) {
      this.buffer[this.writePos] = input[i];

      let sample = 0;
      for (const g of this.grains) {
        const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * g.phase) / N);
        sample += window * this.readInterpolated(g.readPos);
      }
      output[i] = sample;

      this.reportEnergy += sample * sample;
      this.reportCount++;

      for (const g of this.grains) {
        g.phase += r;
        g.readPos = this.mod(g.readPos + r, this.bufferLen);
        if (g.phase >= N) {
          g.phase -= N;
          g.readPos = this.mod(this.writePos - N + g.phase, this.bufferLen);

          // Lets the main thread draw the frame-flow diagram without
          // touching the audio path — one message per grain handoff.
          const rms = Math.sqrt(this.reportEnergy / Math.max(1, this.reportCount));
          this.port.postMessage({ rms, reversed: g.label });
          this.reportEnergy = 0;
          this.reportCount = 0;
        }
      }

      this.writePos = (this.writePos + 1) % this.bufferLen;
    }

    return true;
  }
}

registerProcessor("spooky-halloween-voice", SpookyVoiceProcessor);
