# Slide Projector (proof-of-shock prototype)

Dev-only experiment (not in the root build). Raw WebGL2 + vanilla TS, 13 KB gz JS.

```
cd experiments/projector && npm i --no-package-lock && npx vite --host
# http://<lan-ip>:5173/experiments/projector/?set=bonnet   (or ?set=mixed, add &debug)
```
Tools: `tools/shots.mjs`, `tools/record.mjs`, `tools/flow.mjs` (input flow), `tools/handoff.mjs` (GL->DOM diff), `tools/edge.mjs` (reduced motion / context loss / perf). They need Chromium with GPU (ANGLE/Metal); set `PJ_CHROME` if the path differs.

## Architecture
- One fixed canvas (`pointer-events:none`). Passes: room -> wall projection (trapezoid + focus-pull blur, fringe, bloom, lamp falloff) -> 3D slide tray (cylinder, plate, instanced slide mounts, texture-array atlas, alpha-to-coverage) -> beam (half-res FBO, analytic cone + noise) -> 2400 dust points -> grain/vignette.
- Everything is a pure function of `pos` (carousel angle), `p` (critically damped spring, open/close) and time since the last slide change.
- Open: quad lerps from keystoned wall rect to the live `getBoundingClientRect()` of the DOM hero slot (re-read each frame, so scrolling/closing follow it); room lights, beam widening, tray drop all derive from `p`. At p>=0.99 -> `img.decode()` -> DOM img shown, GL hidden next rAF. Close re-shows GL at the same rect first, then hides the DOM img next rAF.
- Input: stage uses pointer events with capture + `pointercancel/lostpointercapture/visibilitychange` release, `touch-action:none` only on the stage; buttons are click-only; detail scrolls natively from the first frame. The hero slot retargets the spring on a *fresh* tap (the opening tap's synthetic click had closed it immediately in the first version - fixed).

## Quality loop (self-critique)
Round 1 (first GPU screenshots): the projection was a burnt white blob; beam was upside down (FBO y flip); caption collided with the beam; gate slide blown out; tray hub looked like a can.
Changes: composite y-flip fix; beam now ends at the quad's bottom corners and is masked inside the quad (veil 0.08); bloom 1.5 -> 0.55 + filmic shoulder (fades to identity at p=1); softer apex; lens moved to the slide top; caption moved above the wall; attenuation curves, shorter hub.
Round 2: mid-open still too hot -> exposure flash capped at +25%; added tray kick + gate weave + lamp "rush" on slide change, translucent ghost images on rear slide backs, plaster-ish noise in the wall glow; reduced-motion mid-state was a black rect -> now alpha crossfade; DOM fallback caption overlap fixed.
Juror verdict (honest): rest state and the strobe-through-slides are the strongest; open mid-frame (p~0.4-0.7) is cinematic. Weak spots: the rear half of the tray is a bit busy/dark; text over the beam at p~0.7 is muddy for a few frames; no sound/haptics on iOS; room is otherwise empty (no wall/floor detail); hand-off mean diff 0.15-1.2/255 (colour-management/resampling, not visible).

## Numbers (headless Chromium, ANGLE Metal on an M5 Pro - NOT an iPhone)
dpr2 390x844 scripted run (4 flicks, open, close): 58 fps, p50 16.7 ms, p95 16.8 ms, 0.4% frames >33 ms. Idle: ~30 fps dust redraw; stops fully when the DOM detail is handed off. Real iPhone numbers still unknown.
