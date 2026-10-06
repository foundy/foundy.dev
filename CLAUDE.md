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
- `src/gl/`, `src/lib/{motion,inspect,core}/`, `src/components/` - reserved for upcoming shader hero, spring/gesture modules, Inspect layer (currently empty)

**Key behaviors:**
- Cross-document view transitions via CSS `@view-transition` (no ClientRouter); unsupported browsers navigate normally
- English only; system font stack for now (TODO: self-hosted fonts)

**Deployment:**
- GitHub Pages via `.github/workflows/deploy.yml` (Node 22, `npm ci`, `npm run build`, upload `dist`)
- Pushes to `main` trigger automatic build and deploy
