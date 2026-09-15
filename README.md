# Mic Deffects (sic)

A browser-based playground for realtime audio effects applied live to a
microphone stream. **Reversed fricatives is the first effect, not the whole
project** — the app should be built so additional mic effects can be added
later without a rewrite.

## Idea

Mic in, effect(s) applied in near-realtime, mic-like output played back —
same shape every time, only the effect itself changes. First effect:
reverse hard consonants and fricatives in spoken audio while leaving the
rest of speech untouched. Subtle enough to sound like a glitchy voice
filter, not a garbled mess.

## Use case

Entertainment. Johnny opens the app (on whatever device) and just talks.
The app listens and plays his voice back near-instantly, transformed by
whichever effect is selected. For the first effect: every hard
consonant/fricative (s, f, sh, t, k, ...) comes out reversed while the rest
of the audio plays forward and normally. Done well, it's a seamless,
unsettling little audio party trick — and a base to bolt more effects onto.

## First effect: reversed fricatives (pipeline)

1. Capture the mic stream in short, possibly overlapping frames/windows.
2. Run each frame through a detector that flags fricative-like segments
   (currently: high-pass filter + energy threshold — see below).
3. Reverse the samples within flagged segments only.
4. Recombine (overlap-add) into the output stream and play it back.

## Design decisions (and why)

These were the open questions before writing any code — recorded here so we
don't relitigate them without a reason to.

- **Not a single-effect app.** The name and structure ("Mic Deffects")
  assume more effects get added over time. The capture/playback pipeline
  and the per-effect processing should be separable, so a new effect is a
  new module, not a fork of the whole app.
- **Platform: browser (WebAudio API), not native or desktop.**
  Easiest thing to distribute at prototype stage — a link, no install, no
  app store review. Keeps the door open to a native rewrite later if
  latency or platform APIs turn out to demand it, without having sunk cost
  into a native build first.
- **Processing: fully on-device/local, no server round-trip.**
  A server hop adds network latency that would break the "near-realtime"
  feel of a live conversational effect. `AudioWorklet` gives us a
  dedicated audio thread in-browser for this.
- **Detection (fricatives effect): start with plain signal processing, not ML.**
  Simple high-pass + energy-threshold detection on short frames is fast,
  has no model-loading/inference latency, and is good enough to prove the
  effect out. It will misfire on some non-fricative noise — that's an
  accepted tradeoff for v1.
  - The detector is intentionally isolated behind a single interface
    (`frame -> isFricative: bool` or similar) so it can be swapped for a
    lightweight phoneme/onset classifier later without touching the
    capture/playback pipeline.
- **Scope: shareable demo, not a production release.**
  Needs to work reliably for other people opening the link on their own
  devices/browsers, but doesn't need accounts, onboarding polish, or
  store-grade permissions UX yet.

## Constraints / non-goals (for now)

- Not targeting a specific mobile OS or native app store release.
- Not doing server-side or cloud processing.
- Not aiming for perfect phoneme accuracy on the fricatives effect — false
  positives/negatives on the detector are acceptable as long as the overall
  effect reads as fun.
- Latency budget: as close to imperceptible as a browser can realistically
  get (target: sub-~30ms round trip, to be validated against what
  `AudioWorklet` + frame size actually allows).
- Domain, hosting, and deployment details (custom subdomain, DNS, GitHub
  Pages config, etc.) are deliberately left out of this README — they'll
  go in a separate technical/deployment doc once we get there.

## Open questions to revisit

- Frame/window size and overlap amount — tune once we can hear the effect.
- Where the high-pass cutoff and energy threshold should sit by default.
- Whether we need a fallback for browsers/devices without solid
  `AudioWorklet` support.
- What the effect-plugin boundary looks like in practice, once there's a
  second effect to test it against.
- If the demo takes off, whether a native rewrite is actually warranted.
