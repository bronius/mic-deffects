# Tuning the reversed-fricatives effect

Three numbers control this effect, defined in
`worklets/reversed-fricatives-processor.js` and exposed live in the page's
"Tuning" panel — no redeploy needed to experiment. Move a slider (or type
into its number field) while listening and it takes effect on the next
frame.

## The knobs

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

## What we learned so far

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

## What to try, for what effect

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
expect before trusting your ears.

## Still open

- No overlap-add — frame boundaries are hard cuts, which is its own source
  of clicks independent of the detector. See README "Open questions".
- These numbers are global for the whole session; nothing adapts per
  speaker/mic automatically yet.
