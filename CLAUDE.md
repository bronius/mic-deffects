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
- `index.html` — UI shell: mic controls, tuning sliders, record/playback, help dialog.
- `app.js` — main-thread logic: `AudioContext` setup, worklet wiring, level meter,
  frame-flow canvas, recording.
- `worklets/reversed-fricatives-processor.js` — the `AudioWorklet`: per-frame detection
  and reversal.
- `style.css` — styling.
- `TUNING.md` — user-facing explanation of the three tuning knobs.
- `README.md` — project description, local-run instructions, open questions.

## Deploy
GitHub Pages from `main`, custom domain via `CNAME` (`mic.labs.bronius.com`). No Actions
workflow — pushing to `main` is the deploy.

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
