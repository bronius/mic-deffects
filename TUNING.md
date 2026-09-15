# Tuning the reversed-fricatives effect

Three numbers control this effect, defined in
`worklets/reversed-fricatives-processor.js` and exposed live in the page's
"Tuning" panel — no redeploy needed to experiment. Move a slider (or type
into its number field) while listening and it takes effect on the next
frame.

## The knobs

- **Frame size** — how many samples get buffered before that whole block is
  either passed through or reversed. Bigger blocks make a reversal more
  audible (a short block reversed sounds close to its unreversed self),
  but each frame also adds that much playback latency, since this is a
  blocky (non-overlapping) buffer, not an overlap-add one.
  - Default: 2048 samples (~46ms @44.1kHz).
  - Started at 1024 (~23ms) — too short to actually hear the reversal even
    when detection was firing correctly.

- **Energy threshold** — RMS of the frame's high-passed signal. Catches
  *sustained* noisy sounds — S, F, SH — because their energy stays high
  across the whole frame.
  - Default: 0.012.
  - Started at 0.02 — only S/F ever crossed it.

- **Peak threshold** — peak absolute value of the frame's high-passed
  signal. Catches *brief* broadband bursts — P, T, K, hard C/Q — that an
  RMS average dilutes away, since the burst is short relative to the frame
  and most of the frame around it is comparatively quiet.
  - Default: 0.09.
  - Added because lowering the energy threshold alone still missed
    plosives — they needed a peak check, not just a lower bar on the same
    RMS metric.

A frame is reversed if *either* threshold is crossed.

## What we learned so far

- Fricatives (continuous, high-frequency noise) and plosives (short,
  broadband bursts) are different enough acoustically that one RMS
  threshold can't catch both — hence two separate checks.
- Frame size and detection sensitivity are coupled to what you're trying to
  hear: a correctly-firing detector on too short a frame still sounds like
  nothing happened.
- All three numbers are "tune by ear" — there's no principled default,
  just what sounded right on one mic in one room. Expect to keep adjusting
  per device.

## What to try, for what effect

| Want to...                                  | Try                                        |
| -------------------------------------------- | ------------------------------------------- |
| Catch more consonants generally              | Lower energy threshold and/or peak threshold |
| Catch P / T / K / hard C / Q specifically    | Lower peak threshold                        |
| Catch S / F / SH specifically                | Lower energy threshold                      |
| Stop triggering on vowels / loud speech      | Raise whichever threshold is firing too often |
| Make a reversed frame more audible           | Raise frame size (adds latency)             |
| Reduce latency / snappier feel               | Lower frame size (reversal gets subtler)    |
| A glitch/pop when you move the frame-size slider | Expected — a live frame-size change drops whatever's mid-buffer, it's not a bug |

The frame-flow panel on the page (cyan = captured, pink + amber top strip =
reversed) is the fastest way to see whether a change is doing what you
expect before trusting your ears.

## Still open

- No overlap-add — frame boundaries are hard cuts, which is its own source
  of clicks independent of the detector. See README "Open questions".
- These numbers are global for the whole session; nothing adapts per
  speaker/mic automatically yet.
