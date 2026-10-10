// Records the worlds media: node e2e/worlds-media.mjs [--no-build] [--only=light|water|switch|stills]
//   docs/media/worlds-light-open.webm   Light: spin, buttons, tap -> open -> scroll -> close
//   docs/media/worlds-water-sticky.webm Water: sticky drag (a visible touch dot follows the finger), release commit/revert, buttons, open, close
//   docs/media/worlds-switch.webm       Light -> Water -> Light crossfade at the same product
//   docs/media/worlds-*.webp            stills
// Mobile viewport 390x844. Chromium uses the ANGLE/Metal GPU path. A small dot is injected ONLY here to show where the finger is.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs/media');
mkdirSync(out, { recursive: true });
const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
if (!process.argv.includes('--no-build')) {
  if (spawnSync('npx', ['vite', 'build'], { cwd: root, stdio: 'ignore' }).status !== 0) process.exit(1);
}
const port = await new Promise((res) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => res(p));
  });
});
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore', detached: true });
const stop = () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}
};
process.on('exit', stop);
const BASE = `http://127.0.0.1:${port}/bonnet/`;
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(BASE)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });

const DOT = `
(() => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;z-index:2147483647;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(255,255,255,.28);border:2px solid rgba(255,255,255,.85);pointer-events:none;display:none;box-shadow:0 0 12px rgba(0,0,0,.4)';
  const add = () => document.body && document.body.appendChild(d);
  document.addEventListener('DOMContentLoaded', add);
  const mv = (e) => { d.style.display = 'block'; d.style.left = e.clientX + 'px'; d.style.top = e.clientY + 'px'; };
  addEventListener('pointerdown', mv, true); addEventListener('pointermove', mv, true);
  const hide = () => { d.style.display = 'none'; };
  addEventListener('pointerup', hide, true); addEventListener('pointercancel', hide, true);
})();`;

async function session(name, query, body) {
  const tmp = path.join(os.tmpdir(), 'bonnet-vid-' + name);
  rmSync(tmp, { recursive: true, force: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: tmp, size: { width: 390, height: 844 } } });
  await ctx.addInitScript(DOT);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const T = {
    page,
    cdp,
    st: () => page.evaluate(() => window.__bonnet),
    async drag(x0, y0, steps, dt = 16) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
      for (const [dx, dy] of steps) {
        await sleep(dt);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + dx, y: y0 + dy }] });
      }
    },
    lift: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
    async until(fn, ms = 6000) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (fn(await T.st())) return;
        await sleep(30);
      }
    },
    async still(file) {
      const png = await page.screenshot();
      await sharp(png).webp({ quality: 82 }).toFile(path.join(out, file));
    },
  };
  await page.goto(BASE + query);
  await page.waitForFunction(() => window.__bonnet && window.__bonnet.gl === 'on');
  await sleep(1200);
  await body(T);
  await ctx.close();
  const f = readdirSync(tmp).find((n) => n.endsWith('.webm'));
  const raw = path.join(tmp, f);
  const dest = path.join(out, `worlds-${name}.webm`);
  // re-encode small: VP9, ~30 fps
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36', '-r', '30', '-an', dest]);
  if (r.status !== 0) renameSync(raw, dest);
  console.log(name, (statSync(dest).size / 1024).toFixed(0), 'KB');
}

const smooth = (n, total) => Array.from({ length: n }, (_, i) => [-Math.round((total * (i + 1)) / n), 0]);

if (!only || only === 'light') {
  await session('light-open', '?probe&world=light&set=bonnet', async (T) => {
    await sleep(800);
    await T.drag(195, 700, smooth(12, 70), 30); // spin, the slide under the finger follows
    await sleep(400);
    await T.lift();
    await sleep(900);
    await T.page.click('#prev', { force: true });
    await sleep(500);
    await T.page.click('#next', { force: true });
    await sleep(700);
    await T.still('worlds-light-browse.webp');
    await T.page.touchscreen.tap(195, 250);
    await sleep(330);
    await T.still('worlds-light-open-mid.webp');
    await T.until((s) => s.page === 'detail');
    await sleep(500);
    await T.still('worlds-light-detail.webp');
    await T.drag(195, 520, [[0, -60], [0, -140], [0, -260], [0, -380]], 16);
    await T.lift();
    await sleep(700);
    await T.page.click('#close');
    await T.until((s) => s.page === 'browse');
    await sleep(900);
  });
}
if (!only || only === 'water') {
  await session('water-sticky', '?probe&world=water&set=bonnet', async (T) => {
    await sleep(900);
    await T.still('worlds-water-browse.webp');
    // slow sticky drag: hold in the middle so the tilt, wake and the rising neighbour are visible
    await T.drag(195, 400, smooth(14, 130), 30);
    await sleep(500);
    await T.still('worlds-water-sticky-mid.webp');
    await T.lift(); // 130 px of 250: reverts
    await sleep(1100);
    // past half: commits
    await T.drag(195, 400, smooth(16, 190), 26);
    await sleep(300);
    await T.lift();
    await sleep(1100);
    // flick
    await T.drag(195, 400, smooth(3, 60), 8);
    await T.lift();
    await sleep(1100);
    await T.page.click('#prev');
    await sleep(500);
    await T.page.click('#prev');
    await sleep(900);
    await T.still('worlds-water-buttons.webp');
    await T.page.touchscreen.tap(195, 400);
    await sleep(700);
    await T.still('worlds-water-open-mid.webp');
    await T.until((s) => s.page === 'detail', 8000);
    await sleep(700);
    await T.page.click('#close');
    await T.until((s) => s.page === 'browse');
    await sleep(1000);
  });
}
if (!only || only === 'switch') {
  await session('switch', '?probe&world=light&set=bonnet', async (T) => {
    await sleep(900);
    await T.page.click('#next');
    await sleep(900);
    await T.page.tap('[data-w=water]');
    await sleep(300);
    await T.still('worlds-switch-mid.webp');
    await sleep(2600);
    await T.page.tap('[data-w=light]');
    await sleep(2200);
  });
}
await browser.close();
stop();
