// Hero at rest (shader clock frozen, tier high, DPR 2) -> PNG, for before/after comparisons of the SDF asset.
// usage: node scripts/hero/rest-shot.mjs <baseUrl> <out.png> [compare.png]   (with a 3rd arg: prints mean abs diff, 0-255)
import { chromium } from 'playwright';
import sharp from 'sharp';

const [base, out, cmp] = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.goto(`${base}/?tier=high&t=3`);
await p.waitForFunction(() => document.querySelector('[data-hero-poster].gl-done'), null, { timeout: 25000 });
await p.waitForTimeout(600);
const box = await p.locator('[data-hero-poster] .stage').boundingBox();
const png = await p.screenshot({ clip: box });
await sharp(png).toFile(out);
if (cmp) {
  const a = await sharp(png).greyscale().raw().toBuffer();
  const c = await sharp(cmp).greyscale().raw().toBuffer();
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - c[i]);
  console.log('mean abs diff', (s / a.length).toFixed(4), '/255');
}
await b.close();
