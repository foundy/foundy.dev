# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start Astro dev server
npm run build    # astro check (types) + astro build -> dist/
npm run preview  # Preview production build locally
npm test         # vitest: motion primitives, close decision, recorder replay
```

## Architecture

Personal site (foundy.dev): Astro (static output) + vanilla TypeScript, no UI framework. Redesign in progress; see `docs/redesign-plan.md` (roadmap, decisions, quality bar). The pre-redesign site and card-deck prototypes are preserved at git tag `legacy-v1` (old data copies in `docs/legacy-data/`).

**Structure:**
- `src/pages/` - `index.astro`, `work/[slug].astro` (from the `work` collection), `lab.astro`, `404.astro`
- `src/content.config.ts` + `src/content/work/*.md` - `work` content collection (title, summary, order, year, plus `facts`/`preview` for the card's preview sheet)
- `src/layouts/Base.astro` - html shell: meta/OG, viewport (zoom must stay enabled), theme-color, favicon
- `src/styles/` - `tokens.css` (paper/ink design tokens), `global.css` (base, reduced-motion, view transitions)
- `src/gl/` - the WebGL2 hero. `boot.ts` is the only eager script (checks WebGL2 / `?gl=none` / reduced motion / Save-Data, then lazy-imports `hero/` and cross-fades over the SVG poster). `renderer.ts` = context, program/FBO ping-pong helpers, visibility-aware loop. `hero/` = `index.ts` (`mountHero`, `HeroHandle.renderStage()/stats()`), `pipeline.ts` (velocity -> deviation sim, then one display pass), `stages/{sdf,warp,flow,composite}.ts` (GLSL, each stage renderable alone via `HeroStage`), `input.ts` (pointer -> force, touch rules), `hud.ts` (`?hud=1` only). The wordmark SDF is baked at build time by `scripts/bake-sdf.mjs` (`npm run bake:sdf`, outputs committed).
- `src/lib/inspect/` - the Inspect layer, built for reuse. `core.ts` = `registerInspectable({id,title,element,kind:'stages'|'timeline',context,stages,timeline,onEnter,onExit,onScrub})` + global state (`inspect.enabled/active/scrub`, `refresh()` re-picks the active inspectable by its `context()`, `notifyTimeline()`) + tiny emitter. `panel.ts` = generic stages UI (scrubber, aria-live explanation, Details disclosure); `timeline.ts` = generic timeline UI (replay button, scrubber with marker stops, plain-English summary, Details). `toggle.ts` is the eager half (button + `I`/Escape keys; dynamic-imports `runtime.ts` on first use or hover/focus prefetch). `bridge.ts` hands the live hero handle and the card deck handle (`bridge.cards`) to Inspect; `runtime.ts` lazy-loads `../cards/inspect` when the deck exists. The hero's inspectable (copy, developer numbers, still-image fallback) is `src/gl/hero/inspect.ts`; styling is `src/styles/inspect.css`. No GL: stills `public/gl/stages/*.webp` from `scripts/hero/render-stages.mjs`.
- `src/lib/core/` - clock, quality tiers.
- `src/lib/motion/` - framework-free, time-based, unit-tested (`npm test`, vitest): `spring.ts` (closed-form damped spring, retarget keeps velocity), `velocity.ts` (least-squares px/ms over the last 90 ms), `gesture.ts` (`GesturePipeline` pure state machine fed `{t,x,y,type}` samples + `bindPointerGesture` DOM half: pointer capture, cancel handling, touchmove preventDefault), `recorder.ts` (versioned JSON recordings + deterministic `replay()`).
- `src/lib/cards/` - the work cards: `boot.ts` (eager ~0.5 KB: cards are plain links without JS; click/Enter opens the sheet; loads the chunk on pointerdown/focus/idle; `#work/<slug>` direct load), `index.ts` (lazy: the preview sheet, an explicit state machine idle/opening/open/dragging/closing, FLIP morph by springs, pull-down close, history/inert/focus), `decision.ts` (`decideClose`/`shouldClose`, drag rubber band; constants documented there), `inspect.ts` (card timeline inspectable: markers, summary, SVG overlay), `types.ts`. The sheet markup is static in `index.astro` (`#work-sheet`, per-card `<template data-sheet-for>`); styles `src/styles/cards.css`.
- `src/components/` - Astro components (HeroPoster, InspectToggle, WorkVisual, ...)
- `scripts/hero/`, `scripts/inspect/`, `scripts/cards/` (+ `sizes.mjs` chunk sizes) - Playwright verification (`verify.mjs`, `shots.mjs`); run against `npm run build && npm run preview`

**Key behaviors:**
- Work cards: click/tap/Enter on a card opens a preview sheet in the same document (URL `#work/<slug>`, pushState); Escape, close button, scrim, Back and a pull-down from scrollTop 0 close it. Background is `inert`, focus returns to the card. Only transform/opacity are animated; a transform has exactly one owner (the spring loop). Docs: `docs/card-study-notes.md`.
- Cross-document view transitions via CSS `@view-transition` (no ClientRouter); unsupported browsers navigate normally
- English only; system font stack for now (TODO: self-hosted fonts)

**Deployment:**
- GitHub Pages via `.github/workflows/deploy.yml` (Node 22, `npm ci`, `npm run build`, upload `dist`)
- Pushes to `main` trigger automatic build and deploy
