// Records the sketch media: node e2e/sketch-media.mjs [--no-build]
// per transition x catalogue: a short mobile video (open -> scroll -> close), mid-transition screenshots at p~0.3 / 0.6
// (debug scrub hook), and the hand-off frame pair (last GL frame vs first DOM frame) with the mean absolute difference.
// Chromium is launched with the ANGLE/Metal GPU path when available (falls back to software GL elsewhere).
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs/media');
mkdirSync(out, { recursive: true });
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
const results = {};

const waitFor = async (page, fn, ms = 3000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(fn)) return true;
    await sleep(25);
  }
  return false;
};
const diff = async (a, b, clipH) => {
  const ra = await sharp(a).extract({ left: 0, top: 0, width: 390, height: clipH }).removeAlpha().raw().toBuffer();
  const rb = await sharp(b).extract({ left: 0, top: 0, width: 390, height: clipH }).removeAlpha().raw().toBuffer();
  let s = 0;
  let max = 0;
  for (let i = 0; i < ra.length; i++) {
    const d = Math.abs(ra[i] - rb[i]);
    s += d;
    if (d > max) max = d;
  }
  return { mean: +(s / ra.length).toFixed(3), max };
};

for (const set of ['bonnet', 'mixed']) {
  for (const t of ['lift', 'optic', 'tunnel']) {
    const key = `${t}-${set}`;
    const url = `${BASE}?debug&t=${t}&set=${set}`;
    // ---- video ----
    const vdir = path.join(out, '_v');
    rmSync(vdir, { recursive: true, force: true });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
    const page = await ctx.newPage();
    await page.goto(url.replace('?debug&', '?'));
    await sleep(1200);
    for (let k = 0; k < 2; k++) {
      await page.touchscreen.tap(195, 380);
      await waitFor(page, () => document.documentElement.dataset.page === 'detail', 2500);
      await sleep(500);
      await page.mouse.wheel(0, 0);
      await page.evaluate(() => scrollTo({ top: 260 }));
      await sleep(350);
      await page.evaluate(() => scrollTo({ top: 0 }));
      await sleep(200);
      await page.tap('#close');
      await waitFor(page, () => document.documentElement.dataset.page === 'deck', 2500);
      await sleep(600);
    }
    await ctx.close();
    const raw = readdirSync(vdir).find((f) => f.endsWith('.webm'));
    const dst = path.join(out, `sketch-${key}.webm`);
    let src = path.join(vdir, raw);
    if (statSync(src).size > 1.8 * 1024 * 1024) {
      spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '38', '-an', dst]);
    } else renameSync(src, dst);
    rmSync(vdir, { recursive: true, force: true });

    // ---- scrub screenshots + hand-off pair ----
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    const p2 = await c2.newPage();
    await p2.goto(url);
    await sleep(1200);
    await p2.addStyleTag({ content: '#dbg{display:none!important}' });
    await p2.evaluate(() => window.__gl.hold(true));
    await p2.touchscreen.tap(160, 330);
    await sleep(200);
    for (const pv of [0.3, 0.6]) {
      await p2.evaluate((v) => window.__gl.scrub(v, true), pv);
      await sleep(80);
      const png = await p2.screenshot();
      await sharp(png).webp({ quality: 78 }).toFile(path.join(out, `sketch-${key}-p${Math.round(pv * 100)}.webp`));
    }
    await sleep(500); // let the sheet's rise animation finish so only the hero is compared
    await p2.evaluate(() => window.__gl.scrub(1, true));
    await sleep(80);
    const a = await p2.screenshot();
    await p2.evaluate(() => window.__gl.handoff());
    await waitFor(p2, () => document.documentElement.dataset.gl === 'detail', 1500);
    await sleep(250);
    const b = await p2.screenshot();
    const heroH = await p2.evaluate(() => Math.round(document.getElementById('hero').getBoundingClientRect().bottom));
    results[key] = { heroH, hero: await diff(a, b, heroH), full: await diff(a, b, 844) };
    await sharp(a).webp({ quality: 80 }).toFile(path.join(out, `handoff-${key}-gl.webp`));
    await sharp(b).webp({ quality: 80 }).toFile(path.join(out, `handoff-${key}-dom.webp`));
    // ---- close-time frame stats on the real GPU (not a phone) ----
    const c3 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const p3 = await c3.newPage();
    await p3.goto(url);
    await sleep(1200);
    await p3.evaluate(() => document.querySelector('#dbg [data-r]').click());
    for (let k = 0; k < 3; k++) {
      await p3.touchscreen.tap(195, 380);
      await waitFor(p3, () => document.documentElement.dataset.page === 'detail', 2500);
      await sleep(300);
      await p3.tap('#close');
      await waitFor(p3, () => document.documentElement.dataset.page === 'deck', 2500);
      await sleep(400);
    }
    const txt = await p3.locator('#dbg pre').textContent();
    results[key].frames = (/gl frame ([^\n]*)/.exec(txt) ?? [])[1];
    await c2.close();
    await c3.close();
    console.log(key, JSON.stringify(results[key]));
  }
}
writeFileSync(path.join(out, 'sketch-results.json'), JSON.stringify(results, null, 1));
await browser.close();
stop();
for (const f of readdirSync(out)) console.log(f, (statSync(path.join(out, f)).size / 1024).toFixed(0) + ' KB');
