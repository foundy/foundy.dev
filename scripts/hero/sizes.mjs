// Bundle report for the home page: node scripts/hero/sizes.mjs   (run after `npm run build`)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';

const kb = (n) => (n / 1024).toFixed(1);
const html = readFileSync('dist/index.html', 'utf8');
console.log('script tags in index.html:', [...html.matchAll(/<script[^>]*>/g)].map((m) => m[0]));
console.log('render-blocking scripts (non-module, non-async, non-defer):', [...html.matchAll(/<script(?![^>]*(type="module"|async|defer))[^>]*>/g)].length);
console.log('modulepreload links:', [...html.matchAll(/rel="modulepreload"[^>]*/g)].length);
console.log('stylesheets:', [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*>/g)].length);

console.log('\nfile                                                            raw KB   gzip KB  brotli KB');
for (const f of readdirSync('dist/_astro').filter((f) => f.endsWith('.js')).sort()) {
  const buf = readFileSync(`dist/_astro/${f}`);
  const gz = gzipSync(buf, { level: 9 }).length;
  const br = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
  const spike = /^(common|raw|three)\./.test(f) || /^(raw|three)\.astro/.test(f);
  console.log(`${f.padEnd(62)} ${kb(buf.length).padStart(7)} ${kb(gz).padStart(9)} ${kb(br).padStart(9)}${spike ? '   (spike pages only)' : ''}`);
}
const png = statSync('dist/gl/wordmark-sdf.webp').size;
console.log(`\nSDF (lossless WebP): ${kb(png)} KB (already compressed; fetched lazily with the hero chunk)`);
