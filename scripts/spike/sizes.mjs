// Raw / gzip -9 / brotli sizes of every JS chunk in dist/_astro, and which spike page loads which.
import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { join } from 'node:path';

const dir = 'dist/_astro';
const kb = (n) => (n / 1024).toFixed(1);
const sizes = {};
for (const f of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  const buf = readFileSync(join(dir, f));
  sizes[f] = {
    raw: buf.length,
    gz: gzipSync(buf, { level: 9 }).length,
    br: brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
  };
}
for (const page of ['spike/raw', 'spike/three', 'index']) {
  const html = readFileSync(`dist/${page}/index.html`.replace('dist/index/', 'dist/'), 'utf8');
  const used = [...html.matchAll(/(?:src|href)="\/_astro\/([^"]+\.js)"/g)].map((m) => m[1]);
  let raw = 0, gz = 0, br = 0;
  for (const u of used) {
    // follow static imports one level (shared chunks)
    const deps = [u, ...[...readFileSync(join(dir, u), 'utf8').matchAll(/from"\.\/([^"]+\.js)"/g)].map((m) => m[1])];
    for (const d of new Set(deps)) {
      if (!sizes[d]) continue;
      raw += sizes[d].raw; gz += sizes[d].gz; br += sizes[d].br;
    }
  }
  console.log(`${page.padEnd(12)} scripts=${used.length}  raw ${kb(raw)} KB  gzip ${kb(gz)} KB  brotli ${kb(br)} KB`);
}
console.log(JSON.stringify(sizes, null, 1));
