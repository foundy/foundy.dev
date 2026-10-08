# bonnet

An interaction-first product card deck demo. A swipeable deck of five bonnet colours opens into a detail page (shared-element transition), pulls back down with the finger, scrubs through four photo angles and switches colour in place. **Demo: a sample product, nothing is for sale.**

Self-contained Vite + vanilla TypeScript, no framework, no runtime dependencies (about 9 KB gzipped JS).

## Run

```bash
npm install          # from the repo root (bonnet is an npm workspace) or inside this folder when standalone
npm run dev          # http://localhost:5173/bonnet/
npm test             # vitest: spring, velocity, deck target, close decision, angle snap, layout
npm run build        # tsc + vite build -> dist/ (base from BONNET_BASE, default /bonnet/)
npm run images       # regenerate public/assets/img (480w + large WebP) from assets-src/
npm run e2e -- http://127.0.0.1:4173/bonnet/ chromium   # Playwright checks (also webkit, firefox)
npm run media        # re-record docs/media (videos + screenshots)
```

From the foundy.dev root, `npm run build` runs `astro build` and then `build:bonnet`, which writes this app to `dist/bonnet/`.

## How it is built

- `src/main.ts`: one model. `pos` (deck position, float), `p` (open progress 0..1) and `angle` (float) are springs; every visual is a function of them. An explicit `mode` (closed, opening, open, closing, dragging) guards the state; one rAF loop sleeps when all springs settle.
- `src/layout.ts`: card look as a continuous function of `index - pos`.
- `src/motion/`: spring (closed form, keeps velocity on retarget), velocity estimator, release decisions (`decide.ts`).
- Images in `public/assets/img`, originals in `assets-src/` (not shipped).

## Extract to its own repo and subdomain (bonnet.foundy.dev)

1. Create `foundy/bonnet` and copy this folder's contents to its root (everything in `bonnet/`, including `assets-src/`). Add a `.gitignore` with `node_modules` and `dist`.
2. In `vite.config.ts` nothing changes: build with `BONNET_BASE=/` (or change the default `base` to `'/'`). `npm run build` then outputs a root-relative site.
3. Add `public/CNAME` containing exactly `bonnet.foundy.dev`.
4. Add `.github/workflows/deploy.yml` (same as foundy.dev's: checkout, setup-node 22, `npm ci`, `BONNET_BASE=/ npm run build`, upload `dist`, deploy-pages). In the repo settings, Pages source = GitHub Actions.
5. GitHub repo Settings > Pages > Custom domain: `bonnet.foundy.dev`, then enable "Enforce HTTPS" once the certificate is issued.
6. DNS (Namecheap > Domain List > foundy.dev > Advanced DNS): add a **CNAME Record**, Host `bonnet`, Value `foundy.github.io.`, TTL Automatic.
7. In foundy.dev: delete `bonnet/`, remove `build:bonnet` from the root `build` script and the `workspaces` entry (`npm install` to refresh the lockfile), and update the link in `src/content/work/card-study.md` to `https://bonnet.foundy.dev/`.

### Leave a redirect at foundy.dev/bonnet/

Add `public/bonnet/index.html` to foundy.dev:

```html
<!doctype html>
<meta charset="utf-8" />
<title>Bonnet</title>
<link rel="canonical" href="https://bonnet.foundy.dev/" />
<meta http-equiv="refresh" content="0; url=https://bonnet.foundy.dev/" />
<script>location.replace('https://bonnet.foundy.dev/' + location.hash);</script>
<a href="https://bonnet.foundy.dev/">Moved to bonnet.foundy.dev</a>
```

The script keeps `#moss` style links working.

## URLs

`/bonnet/` is the deck. `/bonnet/#ivory`, `#moss`, `#poppy`, `#sky`, `#butter` open that colour directly (no animation on load). Opening pushes history, closing pops it, Back runs the same close transition.
