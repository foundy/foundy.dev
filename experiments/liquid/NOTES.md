# LIQUID SURFACE - proof-of-shock notes

Standalone raw-WebGL2 experiment (no three.js). Run: `cd experiments/liquid && npx vite --host` then open `/experiments/liquid/?set=bonnet` or `?set=mixed` (`&debug` for the overlay, `&fmt=u8` to force the RGBA8 sim fallback).

## Structure
- `src/water.ts` - GL: ping-pong wave sim (RGBA32F -> RGBA16F -> RGBA8 16-bit packing fallback), derive pass (slope/height/laplacian, bilinear), full-screen render pass, texture-array of product frames (896x1120, mipmapped).
- `src/shaders.ts` - sim / derive / render GLSL. `src/main.ts` - state, springs (swipe `s`, rise `p`), input, DOM, hand-off, sleep logic.
- Visuals are pure functions of `s`, `sv`, `p`; the sim is only stimulated (drops, rect sources at rise/sink thresholds).

## Input deviation (measured)
`touch-action: pan-y pinch-zoom` makes Chromium send `pointercancel` after ~2 moves of any vertical drag (verified with CDP touch), which kills vertical finger ripples. The browse view has nothing to scroll, so the surface uses `touch-action: pinch-zoom`; the detail view is native window scroll (surface has `pointer-events:none` there). Everything else follows the rules: buttons click-only, no global click suppression, no document touchmove preventDefault, pointercancel/lostpointercapture/visibilitychange cleanup.

## Quality loop - honest critique
Question: would this make a jaded Awwwards juror stop scrolling?

### Iteration 1 (first working build)
Critique: a photo card on grey-black. Ripples invisible on the dark floor, swipe frames blown out to white (caustic function mis-ported: values ~constant, multiplied the whole product), sparkle dust looked like TV snow, wet film warped the baby's face into a grimace, shadow around the hero was a dirty grey halo.
Changes: rewrote the caustic web (correct domain, static web on the floor that ripples bend), tanh-bounded caustic gain, env redesigned with strips/softboxes near the reflection centre so small slopes sweep highlights, slope soft-saturation + larger slope gain, sim amplitude limiter, ink-coloured halo + teal pool gradient, product edge bevel/rim, rarer round dust, thickness-gradient wet film (rivulet lanes + edge bead + clean drops) instead of noise differences, lighter shadow.

### Iteration 2
Critique: rest state reads calm and glossy but still "a card in a dark box" - the bonnet pad strip is a bit dull; ripples now look like real glass-clear water, swipe frames are convincing; rise was too fast and the pale background arrived almost instantly; sink ring showed a hard inner rectangle; vertical finger drags produced no ripples (touch-action).
Changes: slower rise spring (wp 5.4) and later/softer calm-front, sink ring strength halved, reflection reduced over products (cover mask) and raised on open water, `touch-action: pinch-zoom`, energy-based sleep (no pop when flattening), root background for hand-off colour, `--chrome` fix in reduced-motion/no-GL paths.

### Remaining honest weaknesses
- Wet-sheet during rise is subtle; rivulets are sparse vertical lines, not a truly volumetric sheet.
- The 4:5 rounded frame + gradient pad is inherited from the card-deck work; a photo "in a rectangle" limits the shock. A cut-out/matte-free treatment would need product-specific assets.
- Neighbour products are flat translucent bands; no true 3D depth. Resting state is intentionally static (sleeps), so it is less "alive" than a looping hero.
- Video encodes are low fidelity (Playwright screencast 25 fps VP8).

## Perf (Chromium headed, Apple M5 Pro Metal, DPR 2, 390x844; NOT a phone)
Active frames: 60 fps, frame p50 16.7 ms / p95 ~18 ms, >33 ms ratio 0-1%. Sim 182x395 (mobile) / 490x306 (desktop 1440x900), RGBA32F. Sleeps (no rAF) when energy estimate decays. JS 39 KB raw / 15.7 KB gzip. Real iPhone numbers are unmeasured.

## Media
`media/{bonnet,mixed}-{ripples,swipe,rise,sink}.webm` (<= 300 KB each), screenshots `media/*-{rest,finger-ripples,swipe-current,rise-p40,open}.jpg`. Regenerate: `node scripts/media.mjs all` (needs playwright + ffmpeg + dev server on :5199).

## Notes
- Hero close is a real `<button>` (click), the hero image has no handler, so a synthesized click after tapping the product cannot close it.
