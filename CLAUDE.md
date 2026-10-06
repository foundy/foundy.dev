# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start Astro dev server
npm run build    # astro check (types) + astro build -> dist/
npm run preview  # Preview production build locally
```

## Architecture

Personal site (foundy.dev): Astro (static output) + vanilla TypeScript, no UI framework. Redesign in progress; see `docs/redesign-plan.md` (roadmap, decisions, quality bar). The pre-redesign site and card-deck prototypes are preserved at git tag `legacy-v1` (old data copies in `docs/legacy-data/`).

**Structure:**
- `src/pages/` - `index.astro`, `work/[slug].astro` (from the `work` collection), `lab.astro`, `404.astro`
- `src/content.config.ts` + `src/content/work/*.md` - `work` content collection (title, summary, order, year)
- `src/layouts/Base.astro` - html shell: meta/OG, viewport (zoom must stay enabled), theme-color, favicon
- `src/styles/` - `tokens.css` (paper/ink design tokens), `global.css` (base, reduced-motion, view transitions)
- `src/gl/` - the WebGL2 hero. `boot.ts` is the only eager script (checks WebGL2 / `?gl=none` / reduced motion / Save-Data, then lazy-imports `hero/` and cross-fades over the SVG poster). `renderer.ts` = context, program/FBO ping-pong helpers, visibility-aware loop. `hero/` = `index.ts` (`mountHero`, `HeroHandle.renderStage()/stats()`), `pipeline.ts` (velocity -> deviation sim, then one display pass), `stages/{sdf,warp,flow,composite}.ts` (GLSL, each stage renderable alone via `HeroStage`), `input.ts` (pointer -> force, touch rules), `hud.ts` (`?hud=1` only). The wordmark SDF is baked at build time by `scripts/bake-sdf.mjs` (`npm run bake:sdf`, outputs committed).
- `src/lib/inspect/` - the Inspect layer, built for reuse (the card study in Phase 5 registers a `timeline` inspectable). `core.ts` = `registerInspectable({id,title,element,kind:'stages'|'timeline',stages,timeline,onEnter,onExit,onScrub})` + global state (`inspect.enabled/active/scrub`) + tiny emitter. `panel.ts` = generic stages UI (scrubber, aria-live explanation, Details disclosure). `toggle.ts` is the eager half (button + `I`/Escape keys; dynamic-imports `runtime.ts` on first use or hover/focus prefetch). `bridge.ts` hands the live hero handle to Inspect. The hero's inspectable (copy, developer numbers, still-image fallback) is `src/gl/hero/inspect.ts`; styling is `src/styles/inspect.css`. No GL: stills `public/gl/stages/*.webp` from `scripts/hero/render-stages.mjs`.
- `src/lib/{core,motion}/` - `core` (clock, quality tiers); `motion` reserved for spring/gesture modules
- `src/components/` - Astro components (HeroPoster, InspectToggle, ...)
- `scripts/hero/`, `scripts/inspect/` - Playwright verification (`verify.mjs`, `shots.mjs`); run against `npm run build && npm run preview`

**Key behaviors:**
- Cross-document view transitions via CSS `@view-transition` (no ClientRouter); unsupported browsers navigate normally
- English only; system font stack for now (TODO: self-hosted fonts)

**Deployment:**
- GitHub Pages via `.github/workflows/deploy.yml` (Node 22, `npm ci`, `npm run build`, upload `dist`)
- Pushes to `main` trigger automatic build and deploy
