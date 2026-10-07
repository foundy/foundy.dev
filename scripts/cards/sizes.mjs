// JS/CSS sizes (gzip) per chunk of a built site: node scripts/cards/sizes.mjs [distDir=dist]
// "eager" = the module script on the home page plus everything it statically imports.
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const dist = process.argv[2] ?? 'dist';
const dir = join(dist, '_astro');
const files = readdirSync(dir).filter((f) => /\.(js|css)$/.test(f));
const gz = (f) => gzipSync(readFileSync(join(dir, f)), { level: 9 }).length;
const src = (f) => readFileSync(join(dir, f), 'utf8');
const home = readFileSync(join(dist, 'index.html'), 'utf8');

const entry = /src="\/_astro\/([^"]+\.js)"/.exec(home)?.[1];
const staticImports = (f, seen = new Set()) => {
  if (seen.has(f)) return seen;
  seen.add(f);
  for (const m of src(f).matchAll(/(?:^|[;}\s])import\s*(?:[^'"()]*?from\s*)?["']\.\/([^"']+\.js)["']/g)) if (files.includes(m[1])) staticImports(m[1], seen);
  return seen;
};
const eager = entry ? staticImports(entry) : new Set();

let eagerTotal = 0;
for (const f of files.sort()) {
  const e = eager.has(f);
  if (e) eagerTotal += gz(f);
  const tag = e ? 'eager' : /index\.[^.]+\.js$/.test(f) && src(f).includes('work-sheet') ? 'cards' : '';
  console.log(`${String(gz(f)).padStart(7)} B gz ${String(src(f).length).padStart(8)} B raw  ${tag.padEnd(6)} ${f}`);
}
console.log(`eager JS on the home page: ${eagerTotal} B gz (${(eagerTotal / 1024).toFixed(2)} KB)`);
