// Drag-down-to-close tracking check against a running preview (does not start a server).
// usage: node e2e/dragclose-check.mjs --base=http://127.0.0.1:4791/bonnet/ --out=/tmp/dir [--strip=prefix]   (strip -> <prefix>-<world>.webp)
// For each world: open the detail, drag the hero down in steps and, at each step, compare what the GL actually drew under the finger rect
// (grayscale NCC of the screenshot inside the reported hero rect vs the same rect size of the untouched hero) -> ~1 when the photo is exactly
// where the finger put it, low when it lags behind. Then release part-way and sample the detail text opacity (--tp) every ~25 ms: the largest
// single step is reported (a step on snap-back means the text is not following one curve both ways).
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const BASE = arg('base', 'http://127.0.0.1:4791/bonnet/');
const out = arg('out', '/tmp/bonnet-drag');
const strip = arg('strip', '');
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 390, H = 844;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });

const crop = async (png, r) => {
  const left = Math.max(0, Math.round(r.x)), top = Math.max(0, Math.round(r.y));
  const width = Math.min(W - left, Math.round(r.w)), height = Math.min(H - top, Math.round(r.h));
  if (width < 8 || height < 8) return null;
  const { data } = await sharp(png).extract({ left, top, width, height }).resize(64, 80, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  return Float32Array.from(data);
};
const ncc = (a, b) => {
  let ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) (ma += a[i]), (mb += b[i]);
  ma /= a.length; mb /= a.length;
  let s = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { const p = a[i] - ma, q = b[i] - mb; s += p * q; x += p * p; y += q * q; }
  return s / Math.sqrt(x * y + 1e-9);
};

const report = {};
for (const world of ['light', 'water']) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`${BASE}?debug&world=${world}&set=bonnet`);
  await page.waitForFunction(() => window.__bonnet && window.__bonnet.gl === 'on');
  await page.addStyleTag({ content: '#dbg{display:none!important}' });
  await sleep(1200);
  const st = () => page.evaluate(() => window.__bonnet);
  const tp = () => page.evaluate(() => +getComputedStyle(document.documentElement).getPropertyValue('--tp'));
  await page.touchscreen.tap(195, world === 'light' ? 250 : 400);
  for (let i = 0; i < 200 && (await st()).page !== 'detail'; i++) await sleep(40);
  await sleep(1000);
  const hr0 = (await st()).heroRect;
  const refPng = await page.screenshot();
  const x0 = hr0.x + hr0.w / 2, y0 = hr0.y + 90;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  const tiles = [refPng];
  const rows = [];
  let cur = 0;
  for (const dy of [30, 70, 120, 180, 240]) {
    // move there in small steps at ~60 Hz, then let it sit (a scrub holds p; nothing else moves)
    for (let y = cur + 10; y < dy; y += 10) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + dy * 0.08, y: y0 + y }] });
      await sleep(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + dy * 0.08, y: y0 + dy }] });
    cur = dy;
    await sleep(120);
    const s = await st();
    const png = await page.screenshot();
    const a = await crop(png, s.heroRect), b = await crop(refPng, { x: hr0.x, y: hr0.y, w: hr0.w, h: hr0.h });
    rows.push({ dy, heroRect: s.heroRect, ncc: a && b ? +ncc(a, b).toFixed(3) : null, tp: +(await tp()).toFixed(3) });
    tiles.push(png);
  }
  // release part-way (snaps back): sample the text opacity
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + 12, y: y0 + 90 }] });
  await sleep(100);
  const tps = [await tp()];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const t0 = Date.now();
  while (Date.now() - t0 < 900) {
    tps.push(await tp());
    await sleep(20);
  }
  let maxStep = 0;
  for (let i = 1; i < tps.length; i++) maxStep = Math.max(maxStep, Math.abs(tps[i] - tps[i - 1]));
  report[world] = { rows, tpMaxStepOnSnapBack: +maxStep.toFixed(3), tpSeries: tps.map((v) => +v.toFixed(2)).join(' '), minNcc: Math.min(...rows.map((r) => r.ncc ?? 1)), errors: errs };
  console.log(world, 'ncc', rows.map((r) => `${r.dy}:${r.ncc}`).join(' '), '| tp max step on snap-back', report[world].tpMaxStepOnSnapBack);
  console.log('  tp series', report[world].tpSeries);
  if (strip) {
    const tw = 195, th = 422;
    const comps = await Promise.all(tiles.map(async (t, i) => ({ input: await sharp(t).resize(tw, th).toBuffer(), left: i * tw, top: 0 })));
    await sharp({ create: { width: tw * tiles.length, height: th, channels: 3, background: '#111' } }).composite(comps).webp({ quality: 82 }).toFile(`${strip}-${world}.webp`);
  }
  await ctx.close();
}
await browser.close();
