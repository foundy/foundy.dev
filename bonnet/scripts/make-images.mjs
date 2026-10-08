// Generates the responsive WebP set used by the demo: public/assets/img/<id>-<angle>-<480|L>.webp
//   480  = small (1x phones), L = the source width capped at 960 (2x/3x). Run: npm run images
// The outputs are committed, so a normal build never needs this (sharp is only a dev dependency).
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, 'assets-src');
const out = path.join(root, 'public/assets/img');
await mkdir(out, { recursive: true });

const colors = { ivory: 'beige', moss: 'green', poppy: 'red', sky: 'skyblue', butter: 'yellow' };
const angles = ['front', 'right', 'back', 'left'];
let bytes = 0;
for (const [id, file] of Object.entries(colors)) {
  for (const a of angles) {
    const input = path.join(src, `bonnet-${file}-${a}.webp`);
    const meta = await sharp(input).metadata();
    const large = Math.min(meta.width, 960);
    for (const [name, w] of [['480', 480], ['L', large]]) {
      const info = await sharp(input).resize({ width: w, withoutEnlargement: true }).webp({ quality: 80, effort: 5 }).toFile(path.join(out, `${id}-${a}-${name}.webp`));
      bytes += info.size;
      console.log(`${id}-${a}-${name}`, info.width + 'x' + info.height, Math.round(info.size / 1024) + 'KB');
    }
  }
}
console.log('total', Math.round(bytes / 1024) + 'KB');
