# Tuning the effects

Each effect has its own knobs, live in the page's "Tuning" panel — only the
section for the currently-selected effect is shown. No redeploy needed to
experiment; move a slider (or type into its number field) while listening
and it takes effect immediately (modulo the live-resize clicks noted below).

## Reversed Fricatives

Three numbers control this effect, defined in
`worklets/reversed-fricatives-processor.js`. It takes effect on the next
frame.

### The knobs

- **Frame size** — how many samples get buffered before that whole block is
  either passed through or reversed. Each frame also adds that much
  playback latency, since this is a blocky (non-overlapping) buffer, not
  an overlap-add one.
  - Default: 256 samples (~6ms @44.1kHz) — the slider's floor.
  - Started at 1024, then 2048, on the theory that a bigger block would
    make a reversal more audible. In practice the opposite won: the app
    sounds best at the *smallest* frame size the slider allows — smaller,
    more frequent reversals read as a glitchy voice effect; bigger ones
    just sound like dropouts/latency.

- **Energy threshold** — RMS of the frame's high-passed signal. Catches
  *sustained* noisy sounds — S, F, SH — because their energy stays high
  across the whole frame.
  - Default: 0 — the slider's floor. Started at 0.02, then 0.012; turned
    out lower is just better here too.

- **Peak threshold** — peak absolute value of the frame's high-passed
  signal. Catches *brief* broadband bursts — P, T, K, hard C/Q — that an
  RMS average dilutes away, since the burst is short relative to the frame
  and most of the frame around it is comparatively quiet.
  - Default: 0 — the slider's floor. Started at 0.09; same story as the
    energy threshold.

A frame is reversed if *either* threshold is crossed. **At the default
thresholds (0), that's every non-silent frame** — with both thresholds
floored, the detector no longer isolates fricatives/plosives specifically;
it reverses essentially everything, which is what ended up sounding like
the actual effect we wanted (see below).

### What we learned so far

- Our working theory going in — small threshold to target specific
  consonants, big frame to make each reversal audible — was backwards.
  What actually sounds good is the opposite: tiny frames (fast, granular
  reversal) and thresholds low enough to stop discriminating at all.
- Put differently: the "detector" framing (only reverse fricative/plosive
  segments) was solving a problem the ear didn't care about. What reads as
  a fun glitch effect is constant fine-grained reversal, not selective
  reversal of specific phonemes.
- Fricatives (continuous, high-frequency noise) and plosives (short,
  broadband bursts) are still acoustically distinct enough that one RMS
  threshold alone can't catch both — that's why there are two checks — but
  in practice we stopped relying on that distinction once we found zero
  worked better than either.
- All three numbers are still "tune by ear" — no principled default, just
  what sounded right on one mic in one room. Expect to keep adjusting per
  device.

### What to try, for what effect

| Want to...                                       | Try                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| The classic "only consonants reverse" effect     | Raise energy/peak thresholds back up (~0.01–0.02 energy, ~0.05–0.09 peak is where this repo started) |
| More constant, granular/glitchy reversal         | Keep thresholds at (or near) 0, lower the frame size                            |
| Catch P / T / K / hard C / Q specifically        | Lower peak threshold (only matters once it's above 0)                           |
| Catch S / F / SH specifically                    | Lower energy threshold (only matters once it's above 0)                         |
| Stop triggering on vowels / loud speech          | Raise whichever threshold is firing too often                                   |
| Reduce latency                                   | Lower frame size                                                                |
| A glitch/pop when you move the frame-size slider | Expected — a live frame-size change drops whatever's mid-buffer, it's not a bug |

The frame-flow panel on the page (cyan = captured, pink + amber top strip =
reversed) is the fastest way to see whether a change is doing what you
expect before trusting your ears. It's relabeled per effect — see Spooky
Halloween Voice below for what it shows there.

### Still open

- No overlap-add — frame boundaries are hard cuts, which is its own source
  of clicks independent of the detector. See README "Open questions".
- These numbers are global for the whole session; nothing adapts per
  speaker/mic automatically yet.

## Spooky Halloween Voice

A real-time pitch-down ("demon growl"), implemented as a simple two-grain
granular pitch shifter in `worklets/spooky-voice-processor.js` — no FFT, no
library. Two overlapping, Hann-windowed "grains" read from a circular buffer
slower than it's written to; their windows are phase-offset by half a period
so they sum to a constant gain, crossfading seamlessly between them.

### The knobs

- **Pitch shift** (semitones) — how far down the pitch drops. More negative
  = deeper/more demonic.
  - Default: -7 semitones.
  - Range: -12 (one octave down) to 0 (no shift). Below about -12 the
    granular buffer's safety margin runs out and artifacts get worse than
    the effect is worth, hence the slider floor.
- **Grain size** (samples) — the window length each grain reads/fades over.
  - Default: 2048 samples (~46ms @44.1kHz).
  - Bigger = smoother pitch shift but more smearing and latency; smaller =
    more robotic/metallic, less latency. Same tradeoff shape as Reversed
    Fricatives' frame size, different sweet spot — this effect wants a
    larger window than that one does, since it's shaping pitch, not
    detecting transients.

### What to try, for what effect

| Want to...                                        | Try                                                                |
| --------------------------------------------------- | --------------------------------------------------------------------- |
| Deeper, more demonic voice                        | Lower pitch shift (more negative)                                  |
| Subtle pitch darkening, less obviously processed  | Pitch shift closer to 0                                             |
| More robotic/metallic growl                       | Lower grain size                                                    |
| Smoother, less glitchy pitch shift                | Raise grain size (costs latency)                                   |
| A glitch/pop when you move the grain-size slider  | Expected — a live grain-size change drops whatever's mid-buffer, same tradeoff as Reversed Fricatives' frame size |

The frame-flow panel relabels to "grain flow" for this effect: each bar is
one grain's handoff cycle (not a fixed time slice), alternating orange
("grain A") and purple ("grain B") with a soft amber flame-tip marking each
handoff — same rhythm the two grains are crossfading at, just visible.

### Still open

- Grain size and pitch shift are currently independent, but very low pitch
  ratios need a bigger buffer margin than the `grainSize * 4` allocation
  gives — untested below -12 semitones.
- No formant correction, so the voice gets lower *and* a bit "chipmunk in
  reverse" (slightly muffled/dark) rather than a clean pitch-only shift.
  That's a known limitation of time-domain pitch shifting without a vocoder.
