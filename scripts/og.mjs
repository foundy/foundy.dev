// Generates 1200x630 OG images into public/og/ (default + one per case study).
// Run: node scripts/og.mjs
// Text is converted to vector paths with fontkit from the static @fontsource
// .woff files (devDependencies), so rendering does not depend on system fonts.
// Outputs are committed.
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as fontkit from 'fontkit';
import sharp from 'sharp';

const W = 1200;
const H = 630;
const root = new URL('..', import.meta.url).pathname;
const cache = new Map();
/** Returns a loader: weight -> fontkit font (snapped to the nearest 100). */
const family = (pkg, slug) => (wght) => {
  const w = Math.round(wght / 100) * 100;
  const file = join(root, 'node_modules/@fontsource', pkg, 'files', `${slug}-latin-${w}-normal.woff`);
  if (!cache.has(file)) cache.set(file, fontkit.openSync(file));
  return cache.get(file);
};
const sans = family('schibsted-grotesk', 'schibsted-grotesk');
const mono = family('jetbrains-mono', 'jetbrains-mono');

const INK = '#16140f';
const PAPER = '#f4f0e8';
const MUTED = '#5c574c';
const ACCENT = '#b83a1e';
const BP = '#2447a8';

/** Text as an SVG path. Returns { d, width }. Origin is the baseline-left. */
function textPath(family, wght, str, size, x, y, tracking = 0) {
  const font = family(wght);
  const scale = size / font.unitsPerEm;
  const run = font.layout(str);
  let pen = 0;
  let d = '';
  run.glyphs.forEach((g, i) => {
    // fontkit paths are y-up: flip around the baseline.
    d += g.path.transform(scale, 0, 0, -scale, x + pen * scale, y).toSVG();
    pen += run.positions[i].xAdvance + tracking * font.unitsPerEm;
  });
  return { d, width: pen * scale };
}

function wrap(font, wght, str, size, maxWidth) {
  const words = str.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (textPath(font, wght, t, size, 0, 0).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function frame(inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="2"/>
      <feColorMatrix values="0 0 0 0 .35  0 0 0 0 .3  0 0 0 0 .22  0 0 0 .1 0"/>
    </filter>
    <filter id="ink" x="-5%" y="-10%" width="110%" height="120%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.012 0.016" numOctaves="2" seed="7" result="w"/>
      <feDisplacementMap in="SourceGraphic" in2="w" scale="4" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="${PAPER}"/>
  <rect width="${W}" height="${H}" filter="url(#grain)"/>
  ${inner}
</svg>`;
}

function chrome(label, right) {
  const l = textPath(mono, 450, label.toUpperCase(), 18, 64, 78, 0.06);
  const r = textPath(mono, 450, right, 18, 0, 0);
  const rp = textPath(mono, 450, right, 18, W - 64 - r.width, H - 52);
  return `
  <path d="${l.d}" fill="${MUTED}"/>
  <path d="${rp.d}" fill="${MUTED}"/>
  <path d="M64 ${H - 76}H${W - 64}" stroke="${INK}" stroke-opacity=".25"/>
  <g stroke="${MUTED}" fill="none"><path d="M40 44h14M47 37v14"/><path d="M${W - 54} 44h14M${W - 47} 37v14"/><path d="M40 ${H - 44}h14M47 ${H - 51}v14"/><path d="M${W - 54} ${H - 44}h14M${W - 47} ${H - 51}v14"/></g>`;
}

function defaultCard() {
  const word = textPath(sans, 820, 'foundy', 400, 56, 430, -0.0);
  // Scale the wordmark to fit the width.
  const target = W - 128;
  const size = (400 * target) / word.width;
  const w2 = textPath(sans, 820, 'foundy', size, 64, 430);
  const sub = textPath(sans, 560, 'Graphics, shaders and interaction.', 40, 64, 520);
  const dashed = textPath(sans, 820, 'foundy', size, 74, 440);
  return frame(`
  ${chrome('foundy.dev', 'Portfolio')}
  <path d="${dashed.d}" fill="none" stroke="${BP}" stroke-width="1.2" stroke-dasharray="2 6" opacity=".7"/>
  <path d="${w2.d}" fill="${INK}" filter="url(#ink)"/>
  <path d="${sub.d}" fill="${INK}"/>`);
}

function caseCard(title, summary, year, n) {
  const size = 124;
  const lines = wrap(sans, 760, title, size, W - 128);
  let y = 268;
  let paths = '';
  for (const line of lines) {
    paths += `<path d="${textPath(sans, 760, line, size, 64, y).d}" fill="${INK}" filter="url(#ink)"/>`;
    y += size * 1.02;
  }
  const sumLines = wrap(sans, 450, summary, 30, 880).slice(0, 3);
  let sy = 530 - (sumLines.length - 1) * 42;
  let sumPaths = '';
  for (const line of sumLines) {
    sumPaths += `<path d="${textPath(sans, 450, line, 30, 64, sy).d}" fill="#3b372e"/>`;
    sy += 42;
  }
  const tag = textPath(mono, 450, 'CASE STUDY', 16, 64, 118, 0.08);
  return frame(`
  ${chrome(`foundy / work / ${n}`, `${year}`)}
  <rect x="64" y="96" width="${tag.width + 24}" height="30" fill="none" stroke="${ACCENT}" stroke-dasharray="4 3"/>
  <path d="${textPath(mono, 450, 'CASE STUDY', 16, 76, 117, 0.08).d}" fill="${ACCENT}"/>
  ${paths}
  ${sumPaths}`);
}

function parseFrontmatter(src) {
  const m = /^---\n([\s\S]*?)\n---/.exec(src);
  const out = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const outDir = join(root, 'public/og');
mkdirSync(outDir, { recursive: true });

const jobs = [['default', defaultCard()]];
const dir = join(root, 'src/content/work');
for (const f of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
  const fm = parseFrontmatter(readFileSync(join(dir, f), 'utf8'));
  jobs.push([
    f.replace(/\.md$/, ''),
    caseCard(fm.title, fm.summary, fm.year, String(fm.order).padStart(2, '0')),
  ]);
}

for (const [name, svg] of jobs) {
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: false }).toFile(join(outDir, `${name}.png`));
  console.log('wrote', `public/og/${name}.png`);
}
