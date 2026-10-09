// Size budget: JS <= 15 KB gzip (M0a). usage: node e2e/size.mjs [distDir]   (run `vite build` first)
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const dir = path.resolve(process.argv[2] ?? 'dist', 'assets');
let js = 0;
let css = 0;
for (const f of readdirSync(dir)) {
  const gz = gzipSync(readFileSync(path.join(dir, f))).length;
  if (f.endsWith('.js')) js += gz;
  if (f.endsWith('.css')) css += gz;
}
console.log(`js ${(js / 1024).toFixed(2)} KB gz (budget 15), css ${(css / 1024).toFixed(2)} KB gz`);
process.exit(js <= 15 * 1024 ? 0 : 1);
