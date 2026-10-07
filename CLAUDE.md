# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev                  # Astro dev server (add `-- --host` to open it from a phone on the LAN); also serves /spike/*
npm run build                # astro check (types) + astro build -> dist/
npm run preview              # serve dist/ (astro 7 daemonizes in non-TTY shells and prints its pid; `astro preview stop`)
npm test                     # vitest (motion primitives, decision rule, Lab simulation)
npm run verify               # fresh build + preview on a free port, then every verify script in Chromium/WebKit/Firefox
                             #   (hero, inspect, cards, lab) + audits (Lab chart labels, keyboard/zoom, axe). Non-zero exit on failure.
                             #   Options: node scripts/verify-all.mjs --no-build --browsers=chromium --only=hero,cards,audit
npm run bake:sdf             # rebake public/gl/wordmark-sdf.webp + src/gl/hero/wordmark.json from the font (outputs are committed)
node scripts/og.mjs          # regenerate public/og/*.png (title/summary/year of each case study); outputs are committed
node scripts/hero/render-stages.mjs <baseUrl>   # regenerate the Inspect stills public/gl/stages/*.webp (+ @2x) from a running preview
node scripts/audit/lighthouse.mjs <baseUrl> [runs]   # Lighthouse mobile+desktop on 4 pages -> docs/qa/lighthouse.json
```

Individual checks: `node scripts/<hero|inspect|cards|lab>/verify.mjs <baseUrl> <chromium|webkit|firefox>` and `node scripts/audit/{a11y,keyboard}.mjs <baseUrl> <browser>`.
Screenshots: `scripts/<phase>/shots.mjs`. Never leave a preview/dev server running; use a free port.

## Architecture

Personal portfolio (foundy.dev): Astro (static output) + vanilla TypeScript. No UI framework. The plan, decisions and per-phase notes are in `docs/redesign-plan.md`; read it before changing behaviour.

- `src/pages/` `index` (home: hero, two work cards, about, contact), `work/[slug]` (case studies from `src/content/work/*.md`), `lab`, `404`. The hero spike pages live in `src/spike/pages/` and are injected as routes **only on the dev server** (`astro.config.mjs`); they are not built or deployed.
- `src/gl/` raw WebGL2 ink hero (`boot.ts` is the only JS on the home page's critical path; the hero chunk loads after first paint). `public/gl/wordmark-sdf.webp` is the baked SDF (lossless WebP), `public/gl/stages/` the pre-rendered Inspect stills (1x and @2x).
- `src/lib/motion/` spring, velocity, gesture (Pointer Events), recorder/replay. `src/lib/cards/` preview sheet + close decision (`decision.ts` holds `TAU_MS`, `CLOSE_FRACTION`). `src/lib/inspect/` shared Inspect layer (lazy). `src/lib/lab/` Lab simulation and UI.
- `src/data/site.ts` and `src/content/work/*.md` hold all copy. Everything invented is marked `mock` on screen; the list of what needs real information is `docs/content-todo.md`.
- `docs/device-checklist.md` is the iPhone pass; `docs/card-study-notes.md` the lessons from the legacy prototypes (tag `legacy-v1`).

## Rules of thumb

- Keep first-view cost low: no render-blocking JS, GL/Inspect/cards/Lab code stay lazy. Budgets: home initial script ~1.6 KB gz, hero chunk 15 KB gz, Inspect 10 KB, cards 12 KB, Lab 10 KB.
- Layout must not shift when JS hydrates (Lab renders same-sized placeholders server-side; keep that when editing Lab controls).
- Accessibility is checked by `npm run verify` (axe, keyboard walkthrough, 200% zoom and 320 px). Do not add `user-scalable=no`.
- Do not import `three` or `src/spike/*` from production pages.

## Deployment

GitHub Pages via `.github/workflows/deploy.yml` (`npm ci && npm run build`, uploads `dist/`). Pushes to `main` build and deploy.
