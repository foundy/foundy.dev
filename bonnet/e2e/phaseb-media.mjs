// Records the Phase B media: node e2e/phaseb-media.mjs [--no-build] [--only=switch-l2w|switch-w2l|detail-slide|detail-close-light|detail-close-water|stills]
//   docs/media/phaseb-switch-l2w.webm        Light -> Water at real speed, then the same switch at 0.25x
//   docs/media/phaseb-switch-w2l.webm        Water -> Light, same
//   docs/media/phaseb-detail-slide.webm      sticky photo slide in Light and Water (a visible touch dot), release snap + revert
//   docs/media/phaseb-detail-close-light.webm / -water.webm   drag-down-to-close: partial snap back, then a full close
//   docs/media/phaseb-*.webp                 key stills
// Mobile viewport 390x844. A small dot is injected ONLY here to show where the finger is.
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
const HIDE_DBG = '#dbg{display:none!important}';

async function session(name, query, body) {
  const tmp = path.join(os.tmpdir(), 'bonnet-pb-' + name);
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
  await page.addStyleTag({ content: HIDE_DBG });
  await sleep(1200);
  await body(T);
  await ctx.close();
  const f = readdirSync(tmp).find((n) => n.endsWith('.webm'));
  const raw = path.join(tmp, f);
  const dest = path.join(out, `phaseb-${name}.webm`);
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '38', '-r', '30', '-an', dest]);
  if (r.status !== 0) renameSync(raw, dest);
  console.log(name, (statSync(dest).size / 1024).toFixed(0), 'KB');
}

const down = (n, total) => Array.from({ length: n }, (_, i) => [0, Math.round((total * (i + 1)) / n)]);
const left = (n, total) => Array.from({ length: n }, (_, i) => [-Math.round((total * (i + 1)) / n), 0]);

// --- the two switches: once at real speed, once at 0.25x (the second run is for frame review) ---
for (const [from, to] of [['light', 'water'], ['water', 'light']]) {
  const kind = `${from[0]}2${to[0]}`;
  if (only && only !== `switch-${kind}`) continue;
  await session(`switch-${kind}`, `?debug&world=${from}&set=bonnet&tscale=1`, async (T) => {
    await sleep(900);
    await T.page.click(`[data-w=${to}]`);
    await T.until((s) => s.sw === null && s.world === to, 5000);
    await sleep(1000);
    await T.page.click(`[data-w=${from}]`); // and back, for the other direction at real speed
    await T.until((s) => s.sw === null && s.world === from, 5000);
    await sleep(900);
    // reverse mid-way: continuous
    await T.page.click(`[data-w=${to}]`);
    await sleep(450);
    await T.page.click(`[data-w=${from}]`);
    await T.until((s) => s.sw === null, 5000);
    await sleep(800);
  });
  // slow replay as its own file: ?tscale
  await session(`switch-${kind}-slow`, `?debug&world=${from}&set=bonnet&tscale=0.25`, async (T) => {
    await sleep(900);
    await T.page.click(`[data-w=${to}]`);
    await T.until((s) => s.sw === null && s.world === to, 15000);
    await sleep(900);
  });
}

if (!only || only === 'detail-slide') {
  await session('detail-slide', '?debug&world=light&set=bonnet', async (T) => {
    for (const world of ['light', 'water']) {
      await T.page.click(`[data-w=${world}]`);
      await T.until((s) => s.sw === null && s.world === world, 5000);
      await sleep(900);
      await T.page.touchscreen.tap(195, world === 'light' ? 250 : 400);
      await T.until((s) => s.page === 'detail', 8000);
      await sleep(900);
      const hr = (await T.st()).heroRect;
      const x0 = hr.x + hr.w / 2 + 60, y = hr.y + hr.h / 2;
      // slow drag, held mid-way (the next photo is coupled), then reverts
      await T.drag(x0, y, left(14, 110), 36);
      await sleep(600);
      if (world === 'water') await T.still('phaseb-detail-slide-water-mid.webp');
      else await T.still('phaseb-detail-slide-light-mid.webp');
      await T.lift();
      await sleep(900);
      // past half: snaps to the next photo
      await T.drag(x0, y, left(14, 190), 30);
      await sleep(250);
      await T.lift();
      await sleep(1000);
      // a flick
      await T.drag(x0, y, left(3, 70), 8);
      await T.lift();
      await sleep(1000);
      await T.page.click('#close');
      await T.until((s) => s.page === 'browse', 8000);
      await sleep(900);
    }
  });
}

for (const world of ['light', 'water']) {
  if (only && only !== `detail-close-${world}`) continue;
  await session(`detail-close-${world}`, `?debug&world=${world}&set=bonnet`, async (T) => {
    await T.page.touchscreen.tap(195, world === 'light' ? 250 : 400);
    await T.until((s) => s.page === 'detail', 8000);
    await sleep(900);
    const hr = (await T.st()).heroRect;
    const x0 = hr.x + hr.w / 2, y = hr.y + 90;
    await T.still(`phaseb-detail-close-${world}-0.webp`);
    // partial, held, released: snaps back open
    await T.drag(x0, y, down(10, 120), 34);
    await sleep(500);
    await T.still(`phaseb-detail-close-${world}-partial.webp`);
    await T.lift();
    await T.until((s) => s.page === 'detail', 8000);
    await sleep(1000);
    // a long drag: held part-way (the world shows behind), then released into the close
    await T.drag(x0, y, down(16, 250), 28);
    await sleep(400);
    await T.still(`phaseb-detail-close-${world}-deep.webp`);
    await T.lift();
    await sleep(380);
    await T.still(`phaseb-detail-close-${world}-mid.webp`);
    await T.until((s) => s.page === 'browse', 8000);
    await sleep(1100);
    await T.still(`phaseb-detail-close-${world}-end.webp`);
    // and the button close, for the same animation without a finger
    await T.page.touchscreen.tap(195, world === 'light' ? 250 : 400);
    await T.until((s) => s.page === 'detail', 8000);
    await sleep(900);
    await T.page.click('#close');
    await T.until((s) => s.page === 'browse', 8000);
    await sleep(1000);
  });
}
await browser.close();
stop();
