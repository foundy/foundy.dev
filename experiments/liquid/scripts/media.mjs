// Records short mobile videos (ripples / swipe / rise / sink) and screenshots for both catalogues.
//   node scripts/media.mjs [bonnet|mixed|all]      (needs `playwright` resolvable + the dev server on :5199, Chromium with a GPU)
// Video: Playwright recordVideo (390x844) -> trimmed + re-encoded with ffmpeg to <= 2 MB webm in ../media/
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'media');
const TMP = join(here, '..', '.tmp-video');
const BASE = process.env.LIQUID_URL || 'http://localhost:5199/experiments/liquid/';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const sets = process.argv[2] && process.argv[2] !== 'all' ? [process.argv[2]] : ['bonnet', 'mixed'];
mkdirSync(OUT, { recursive: true });

const line = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function session(set, name, script) {
  rmSync(TMP, { recursive: true, force: true });
  const browser = await chromium.launch({ headless: false, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: TMP, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const t0 = Date.now();
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const H = {
    page,
    async drag(pts, ms = 16, hold = 0) { await touch('touchStart', ...pts[0]); for (let i = 1; i < pts.length; i++) { await wait(ms); await touch('touchMove', ...pts[i]); } if (hold) await wait(hold); await touch('touchEnd'); },
    async tap(x, y) { await touch('touchStart', x, y); await wait(60); await touch('touchEnd'); },
    wait, line,
  };
  await page.goto(`${BASE}?set=${set}`);
  await wait(4600); // intro settles
  const start = (Date.now() - t0) / 1000;
  await script(H);
  await wait(400);
  const end = (Date.now() - t0) / 1000;
  await ctx.close();
  await browser.close();
  const src = join(TMP, readdirSync(TMP).find((f) => f.endsWith('.webm')));
  const dst = join(OUT, `${set}-${name}.webm`);
  for (const crf of [24, 28, 32, 36, 40, 46]) {
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-ss', String(Math.max(0, start - 0.2)), '-t', String(end - start + 0.4), '-i', src, '-an', '-c:v', 'libvpx', '-b:v', '0', '-crf', String(crf), '-deadline', 'good', '-cpu-used', '2', dst]);
    if (statSync(dst).size <= 2 * 1024 * 1024) break;
  }
  console.log(set, name, (statSync(dst).size / 1024).toFixed(0) + ' KB');
  rmSync(TMP, { recursive: true, force: true });
}

for (const set of sets) {
  await session(set, 'ripples', async (h) => {
    await h.tap(100, 640); await h.wait(500);
    const sw = Array.from({ length: 46 }, (_, i) => { const a = (i / 45) * Math.PI * 2.6; return [195 + Math.cos(a) * 120, 640 + Math.sin(a) * 80]; });
    await h.drag(sw, 14);
    await h.wait(900);
    await h.drag(h.line([60, 120], [330, 180], 18), 12);
    await h.wait(1600);
    await h.tap(270, 120); await h.wait(1500);
  });
  await session(set, 'swipe', async (h) => {
    await h.drag(h.line([320, 470], [90, 480], 14), 14);
    await h.wait(1500);
    await h.drag(h.line([320, 470], [60, 470], 7), 12);
    await h.wait(1500);
    await h.drag(h.line([60, 470], [330, 470], 10), 20);
    await h.wait(1500);
    await h.page.click('#next'); await h.wait(1700);
  });
  await session(set, 'rise', async (h) => {
    await h.drag(h.line([320, 470], [90, 480], 14), 14);
    await h.wait(1500);
    await h.tap(195, 392);
    await h.wait(2200);
    await h.page.mouse.wheel(0, 380); await h.wait(900);
  });
  await session(set, 'sink', async (h) => {
    await h.tap(195, 392);
    await h.wait(2300);
    await h.page.click('#back');
    await h.wait(2300);
  });
}
