# CLAUDE.md

Plain HTML/CSS/JS. No build step, no dependencies, no tests, no bundler, no package.json.
Don't go looking for one — if something needs doing, it's done by editing the files directly.

## Running locally
Must be served over `http://`, not opened as `file://` — `audioWorklet.addModule()` and
`getUserMedia()` both fail under `file://`.

```
python3 -m http.server 8000
```

## Files
- `index.html` — UI shell: mic controls, effect select, tuning sliders (per-effect
  groups), record/playback, help dialog.
- `app.js` — main-thread logic: `AudioContext` setup, worklet wiring, level meter,
  frame-flow canvas, recording.
- `worklets/reversed-fricatives-processor.js` — the `AudioWorklet`: per-frame detection
  and reversal.
- `worklets/spooky-voice-processor.js` — the `AudioWorklet`: granular pitch-down.
- `style.css` — styling.
- `TUNING.md` — user-facing explanation of each effect's tuning knobs.
- `README.md` — project description, local-run instructions, open questions.
- `cachebust.sh` — stamps `app.js`/worklet references with a content-hash query
  string; see "Cache-busting" below.

## Deploy
GitHub Pages from `main`, custom domain via `CNAME` (`mic.labs.bronius.com`). No Actions
workflow — pushing to `main` is the deploy.

## Cache-busting
GitHub Pages' CDN can serve a stale `app.js` or worklet after a push. `cachebust.sh`
rewrites the `?v=<content-hash>` query string on `app.js`'s `<script src>` in
`index.html` and on each `workletUrl` in `app.js`, so a file only gets a new URL
(and busts the cache) when its content actually changes — not on every deploy, the
way a timestamp would.

A pre-commit hook in `.githooks/pre-commit` runs it automatically whenever a commit
touches `app.js` or a `worklets/*.js` file, and re-stages the restamped files into
the same commit. It only fires once `git config core.hooksPath .githooks` has been
run in the clone (already done in this checkout).

Adding a new effect/worklet: add a `restamp "worklets/your-file.js" app.js` line in
`cachebust.sh` — the list there is explicit, not a glob, to mirror `EFFECTS` in
`app.js`. Forgetting this means the new worklet never gets cache-busted.

## Known traps (don't re-break these)
1. **Tuning defaults live in three places and can desync**: `app.js` module-level
   `frameSize`/`energyThreshold`/`peakThreshold`, `worklets/reversed-fricatives-processor.js`
   `DEFAULT_*` consts (dead in practice — `start()` in `app.js` always passes
   `processorOptions`, so the worklet's own defaults never apply), and `index.html`'s
   slider/number `value=`/`max=` attributes. Changing a default means updating all three,
   and checking the slider `max` can actually reach the new value.
2. **Recording stop order matters**: `MediaRecorder.stop()` finalizes asynchronously.
   `finishMediaRecorder()` must `await` the recorder's `stop` event *before* the
   `AudioContext` is closed, or the blob truncates to ~empty. Don't reorder.
3. **A 0/0 energy/peak threshold is intentional**, not dead logic: a frame reverses when
   `highPassRms > energyThreshold || highPassPeak > peakThreshold`, so at 0/0 every
   non-silent frame reverses and fricative detection is deliberately bypassed. It sounds
   good at the floor — leave it.
4. Changing frame size live reallocates the worklet's input buffer and drops in-flight
   samples (audible click). Expected, documented in `TUNING.md`, not a defect to fix.
5. Recording taps the signal post-effect, so a recording matches what was heard, not the
   raw mic input.
6. `NotSupportedError` on playback inside VS Code's Simple Browser is that embedded
   webview's codec support, not a real bug — Chrome plays the same blob fine.
