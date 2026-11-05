// World-switch frames + pixel metrics, against a running preview (does not start a server).
// usage: node e2e/switch-metrics.mjs --base=http://127.0.0.1:4791/bonnet/ --out=/tmp/dir [--dir=l2w|w2l|both] [--set=bonnet|mixed] [--n=40] [--sheet=file.webp]
// Per frame: the maximum luminance (0..255) and the share of clipped pixels (any channel >= 250 AND luma >= 245) inside the product's
// CENTRAL 55% (of its width and height), and a distortion score = 1 - NCC of that region (grayscale) against the settled picture
// (the last frame for l2w, the first frame for w2l), compared only while the picture sits at its final geometry.
// Where the product is: l2w u<0.3 the wall picture (carried toward the pool by the bend), u>=0.3 the water card; w2l u<0.65 the water card,
// u>=0.45 also the wall picture of the Light world.
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const BASE = arg('base', 'http://127.0.0.1:4791/bonnet/');
const out = arg('out', '/tmp/bonnet-metrics');
const which = arg('dir', 'both');
const set = arg('set', 'bonnet');
const N = +arg('n', 44);
const sheetOut = arg('sheet', '');
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 390, H = 844;
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** product rect (central 55%) in css px for kind/u, as a list of rects */
function regions(kind, u, an) {
  const c55 = (cx, cy, w, h) => ({ x: cx - w * 0.275, y: cy - h * 0.275, w: w * 0.55, h: h * 0.55 });
  const wa = an.water, wl = an.wall;
  const R = [];
  if (kind === 'l2w') {
    if (u < 0.3) {
      // the wall picture carried down the beam and sucked toward the pool (see switch.ts): uv y-up
      const bend = sm(0, 0.3, u), suck = sm(0.16, 0.44, u), S = 1 + 2.8 * suck * suck;
      const uP = { x: wa.x / W, y: 1 - wa.y / H }, uW = { x: wl.x / W, y: 1 - wl.y / H };
      const dy = uW.y - uP.y;
      const lensY = 1 - (wl.lens?.y ?? H * 0.7) / H;
      const kf = (y) => sm(lensY, uW.y, y);
      const aprex = uP.x + (uW.x - uP.x) / S, aprey = uP.y + (uW.y - uP.y) / S;
      let cy = aprey;
      for (let i = 0; i < 40; i++) cy = aprey - dy * bend * kf(cy); // the shift depends on where the picture ends up
      const dk = (kf(cy + 1e-3) - kf(cy - 1e-3)) / 2e-3;
      R.push(c55(aprex * W, (1 - cy) * H, wl.w / S, wl.h / S / (1 + dy * bend * dk)));
    } else R.push(c55(wa.x, wa.y, wa.w, wa.h));
  } else {
    if (u < 0.65) R.push(c55(wa.x, wa.y, wa.w, wa.h));
    if (u >= 0.45) R.push(c55(wl.x, wl.y, wl.w, wl.h));
  }
  return R;
}
const clampR = (r) => {
  const x0 = Math.max(0, Math.round(r.x)), y0 = Math.max(0, Math.round(r.y));
  const x1 = Math.min(W, Math.round(r.x + r.w)), y1 = Math.min(H, Math.round(r.y + r.h));
  return x1 - x0 > 4 && y1 - y0 > 4 ? { left: x0, top: y0, width: x1 - x0, height: y1 - y0 } : null;
};
const gray = (buf) => {
  const g = new Float32Array(buf.length / 3);
  for (let i = 0; i < g.length; i++) g[i] = 0.299 * buf[i * 3] + 0.587 * buf[i * 3 + 1] + 0.114 * buf[i * 3 + 2];
  return g;
};
const ncc = (a, b) => {
  let ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) (ma += a[i]), (mb += b[i]);
  ma /= a.length; mb /= a.length;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return sab / Math.sqrt(saa * sbb + 1e-9);
};

const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const result = {};
for (const kind of which === 'both' ? ['l2w', 'w2l'] : [which]) {
  const from = kind === 'l2w' ? 'light' : 'water';
  const to = kind === 'l2w' ? 'water' : 'light';
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await page.goto(`${BASE}?debug&set=${set}&world=${from}&tscale=0.2`);
  await page.waitForFunction(() => window.__bonnet && window.__bonnet.gl === 'on', null, { timeout: 15000 });
  await page.addStyleTag({ content: '#dbg{display:none!important}' });
  await sleep(2500);
  const an = await page.evaluate(() => window.__bonnet.anchors);
  await page.click(`[data-w=${to}]`);
  const frames = [];
  for (let i = 0; i < N; i++) {
    const s0 = await page.evaluate(() => window.__bonnet.swU);
    if (s0 === null && i > 2) break;
    const f = path.join(out, `${kind}-${String(i).padStart(2, '0')}.png`);
    await page.screenshot({ path: f });
    const s1 = await page.evaluate(() => window.__bonnet.swU);
    frames.push({ f, u: s0 === null ? 1 : s1 === null ? (s0 + 1) / 2 : (s0 + s1) / 2 });
    await sleep(40);
  }
  // refs
  const rawOf = async (f, r) => (await sharp(f).extract(r).removeAlpha().raw().toBuffer());
  const m = [];
  let refFull = null;
  const refFrame = kind === 'l2w' ? frames[frames.length - 1] : frames[0];
  for (const { f, u } of frames) {
    const regs = regions(kind, u, an).map(clampR).filter(Boolean);
    let maxL = 0, clip = 0, dist = null;
    for (const [ri, r] of regs.entries()) {
      const buf = await rawOf(f, r);
      const g = gray(buf);
      let n = 0, c = 0;
      for (let i = 0; i < g.length; i++) {
        if (g[i] > maxL) maxL = g[i];
        n++;
        if (g[i] >= 245 && buf[i * 3] >= 250 && buf[i * 3 + 1] >= 250 && buf[i * 3 + 2] >= 250) c++;
      }
      clip = Math.max(clip, c / n);
      // distortion only where the picture sits at its final place
      const settledGeom = kind === 'l2w' ? u >= 0.44 : u <= 0.5 && ri === 0;
      if (settledGeom) {
        // l2w: the picture settles from a 4.5% zoom (intentional), so the settled frame is sampled with that zoom before comparing
        const z = kind === 'l2w' ? 1 + 0.045 * (1 - sm(0.3, 0.97, u)) : 1;
        if (!refFull) refFull = { g: gray(await sharp(refFrame.f).removeAlpha().raw().toBuffer()) };
        const gr = new Float32Array(g.length);
        for (let yy = 0; yy < r.height; yy++)
          for (let xx = 0; xx < r.width; xx++) {
            const sx = W / 2 + (r.left + xx + 0.5 - W / 2) / z - 0.5, sy = H / 2 + (r.top + yy + 0.5 - H / 2) / z - 0.5;
            const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
            const at = (X, Y) => refFull.g[Math.min(H - 1, Math.max(0, Y)) * W + Math.min(W - 1, Math.max(0, X))];
            gr[yy * r.width + xx] = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
          }
        dist = Math.max(dist ?? 0, 1 - ncc(g, gr));
      }
    }
    m.push({ u: +u.toFixed(3), maxLuma: Math.round(maxL), clipFrac: +clip.toFixed(4), distortion: dist === null ? null : +dist.toFixed(4) });
  }
  const mx = (k) => Math.max(...m.map((x) => x[k] ?? 0));
  result[kind] = { frames: m, max: { maxLuma: mx('maxLuma'), clipFrac: mx('clipFrac'), distortion: mx('distortion') }, errors: errs };
  console.log(kind, 'frames', frames.length, 'max', JSON.stringify(result[kind].max), errs.length ? 'ERR ' + errs.join('|') : 'no errors');
  console.log(m.map((x) => `${x.u.toFixed(2)}:${x.maxLuma}${x.distortion == null ? '' : '/' + x.distortion.toFixed(3)}`).join(' '));
  // 0.25x contact sheet
  const cols = 8, w = Math.round(W * 0.5 / 1), h = Math.round(H * 0.5);
  const tw = 98, th = 211; // 0.25x of 390x844 -> ~98x211
  const rows = Math.ceil(frames.length / cols);
  const comps = await Promise.all(frames.map(async ({ f }, i) => ({ input: await sharp(f).resize(tw, th).toBuffer(), left: (i % cols) * tw, top: Math.floor(i / cols) * th })));
  const sheet = path.join(out, `${kind}-sheet.png`);
  await sharp({ create: { width: cols * tw, height: rows * th, channels: 3, background: '#222' } }).composite(comps).png().toFile(sheet);
  if (sheetOut) await sharp(sheet).webp({ quality: 82 }).toFile(sheetOut.replace('%k', kind));
  void w; void h;
  await ctx.close();
}
writeFileSync(path.join(out, 'metrics.json'), JSON.stringify(result, null, 1));
await browser.close();
