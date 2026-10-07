// Build-time wordmark bake. Run with `npm run bake:sdf`; the outputs are committed, `npm run build` does not need this.
//
//   public/gl/wordmark-sdf.webp   8-bit grayscale signed distance field, lossless WebP (see ENCODING)
//   src/gl/hero/wordmark.json     metrics for the GL hero + the outline path the SVG poster draws
//
// Geometry is defined once, here, in the poster's SVG user units (viewBox 0 0 1200 372):
//   "foundy", Schibsted Grotesk wght 820, font-size 352, baseline y=278, x from 0,
//   kerning on, letter-spacing stretched so the run is exactly 1180 wide (what
//   `textLength=1180 lengthAdjust=spacing` does in Chromium: (1180 - natural) / (n - 1) between glyphs).
// HeroPoster.astro draws the same outline as a <path>, so poster and GL share identical geometry in every browser
// (SVG text gets different glyph positions in WebKit and Chromium, which would break the cross-fade).
//
// ENCODING (8-bit):  v = round(255 * clamp(0.5 + d / (2 * spread), 0, 1))
//   d = signed distance to the glyph outline in SVG user units, positive inside. So 128 ~ the edge,
//   255 = `spread` units inside, 0 = `spread` units outside. Decode: d = (v/255 - 0.5) * 2 * spread.
// The texture covers the box expanded by `pad` units on every side, at `scale` texels per unit.
// Row 0 is the top (image order); upload without flipY.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import * as fontkit from 'fontkit';
import wawoff2 from 'wawoff2';
import sharp from 'sharp';

const TEXT = 'foundy';
const WEIGHT = 820;
const FONT_SIZE = 352;
const BOX = [1200, 372];
const BASE_Y = 278;
const TEXT_LENGTH = 1180;
const SPREAD = 18; // units
const PAD = 18; // units
const SCALE = 1.5; // texels per unit
const SS = 3; // supersampling for the exact EDT

const t0 = Date.now();
const woff2 = readFileSync('node_modules/@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2');
// fontkit's variation support needs a plain TrueType table directory, so unwrap the woff2 first
const font = fontkit.create(Buffer.from(await wawoff2.decompress(woff2))).getVariation({ wght: WEIGHT });
const run = font.layout(TEXT);
const k = FONT_SIZE / font.unitsPerEm;
const natural = run.positions.reduce((a, p) => a + p.xAdvance * k, 0);
const extra = (TEXT_LENGTH - natural) / (run.glyphs.length - 1);

const r2 = (n) => Math.round(n * 100) / 100;
let x = 0;
let d = '';
run.glyphs.forEach((g, i) => {
  const ox = x + run.positions[i].xOffset * k;
  const X = (gx) => r2(ox + gx * k);
  const Y = (gy) => r2(BASE_Y - gy * k);
  for (const { command, args } of g.path.commands) {
    if (command === 'moveTo') d += `M${X(args[0])} ${Y(args[1])}`;
    else if (command === 'lineTo') d += `L${X(args[0])} ${Y(args[1])}`;
    else if (command === 'quadraticCurveTo') d += `Q${X(args[0])} ${Y(args[1])} ${X(args[2])} ${Y(args[3])}`;
    else if (command === 'bezierCurveTo') d += `C${X(args[0])} ${Y(args[1])} ${X(args[2])} ${Y(args[3])} ${X(args[4])} ${Y(args[5])}`;
    else if (command === 'closePath') d += 'Z';
  }
  x += run.positions[i].xAdvance * k + extra;
});

// --- rasterise at SCALE*SS, threshold, exact EDT ---
const TW = Math.ceil((BOX[0] + 2 * PAD) * SCALE);
const TH = Math.ceil((BOX[1] + 2 * PAD) * SCALE);
const HW = TW * SS;
const HH = TH * SS;
const hs = SCALE * SS; // hi-res px per unit
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${HW}" height="${HH}" viewBox="${-PAD} ${-PAD} ${TW / SCALE} ${TH / SCALE}"><rect x="${-PAD}" y="${-PAD}" width="${TW / SCALE}" height="${TH / SCALE}" fill="#000"/><path d="${d}" fill="#fff"/></svg>`;
const { data } = await sharp(Buffer.from(svg)).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
const N = HW * HH;
const INF = 1e12;
const inside = new Uint8Array(N);
for (let i = 0; i < N; i++) inside[i] = data[i] > 127 ? 1 : 0;

function edt(f, w, h) {
  // Felzenszwalb squared EDT, in place on f (Float32), separable
  const n = Math.max(w, h);
  const col = new Float64Array(n);
  const out = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const pass = (len) => {
    let kk = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s;
      for (;;) {
        s = (col[q] + q * q - (col[v[kk]] + v[kk] * v[kk])) / (2 * q - 2 * v[kk]);
        if (s <= z[kk]) kk--;
        else break;
      }
      kk++;
      v[kk] = q;
      z[kk] = s;
      z[kk + 1] = INF;
    }
    kk = 0;
    for (let q = 0; q < len; q++) {
      while (z[kk + 1] < q) kk++;
      out[q] = (q - v[kk]) * (q - v[kk]) + col[v[kk]];
    }
  };
  for (let xx = 0; xx < w; xx++) {
    for (let y = 0; y < h; y++) col[y] = f[y * w + xx];
    pass(h);
    for (let y = 0; y < h; y++) f[y * w + xx] = out[y];
  }
  for (let y = 0; y < h; y++) {
    for (let xx = 0; xx < w; xx++) col[xx] = f[y * w + xx];
    pass(w);
    for (let xx = 0; xx < w; xx++) f[y * w + xx] = out[xx];
  }
}
// squared distance (hi-res px) to the nearest inside pixel (for outside pixels) / nearest outside pixel (for inside)
const toIn = new Float32Array(N);
const toOut = new Float32Array(N);
for (let i = 0; i < N; i++) {
  toIn[i] = inside[i] ? 0 : INF;
  toOut[i] = inside[i] ? INF : 0;
}
edt(toIn, HW, HH);
edt(toOut, HW, HH);

const out = new Uint8Array(TW * TH);
let min = 1e9;
let max = -1e9;
for (let ty = 0; ty < TH; ty++) {
  for (let tx = 0; tx < TW; tx++) {
    let s = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const i = (ty * SS + sy) * HW + tx * SS + sx;
        // -0.5 puts the zero crossing on the pixel edge rather than the pixel centre
        s += inside[i] ? Math.sqrt(toOut[i]) - 0.5 : -(Math.sqrt(toIn[i]) - 0.5);
      }
    }
    const dist = s / (SS * SS) / hs; // units, + inside
    min = Math.min(min, dist);
    max = Math.max(max, dist);
    out[ty * TW + tx] = Math.round(255 * Math.min(1, Math.max(0, 0.5 + dist / (2 * SPREAD))));
  }
}

mkdirSync('public/gl', { recursive: true });
await sharp(out, { raw: { width: TW, height: TH, channels: 1 } })
  .webp({ lossless: true, effort: 6 }) // exact: same texels as the PNG it replaced (158 KB -> ~56 KB)
  .toFile('public/gl/wordmark-sdf.webp');

const meta = {
  text: TEXT,
  font: { family: 'Schibsted Grotesk', weight: WEIGHT, size: FONT_SIZE, baselineY: BASE_Y, textLength: TEXT_LENGTH },
  box: BOX,
  sdf: {
    width: TW,
    height: TH,
    pad: PAD,
    spread: SPREAD,
    scale: SCALE,
    encoding: 'v = round(255*clamp(0.5 + d/(2*spread), 0, 1)); d = signed distance in box units, positive inside; row 0 = top',
  },
  path: d,
};
writeFileSync('src/gl/hero/wordmark.json', JSON.stringify(meta, null, 1) + '\n');
console.log(
  `baked ${TW}x${TH} sdf in ${Date.now() - t0} ms; dist range ${min.toFixed(1)}..${max.toFixed(1)} units; natural ${natural.toFixed(2)} extra/gap ${extra.toFixed(2)}; path ${d.length} chars`,
);
