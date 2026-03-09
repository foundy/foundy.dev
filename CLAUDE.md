# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start Vite dev server with HMR
npm run build    # TypeScript check + Vite production build
npm run preview  # Preview production build locally
```

## Architecture

This is a minimal personal site (foundy.dev) built with vanilla TypeScript and Vite. No framework.

**Structure:**
- `src/main.ts` - Single entry point: fetches status data, renders the card, handles interactions
- `src/style.css` - All styles including animations and responsive design
- `public/data/status.json` - Dynamic content (identity, focus, experiment, updatedAt)
- `index.html` - Shell HTML with `#app` mount point

**Key behaviors:**
- Card expands on hover (desktop) or tap (mobile, via `.expanded` class toggle)
- Particle burst effect spawns on card interaction (`spawnParticles()`)
- Mobile detection uses `window.matchMedia('(hover: none)')`

**Deployment:**
- GitHub Pages via `.github/workflows/deploy.yml`
- Pushes to `main` trigger automatic build and deploy
