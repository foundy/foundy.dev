// Pre-renders the four hero stages to stills for the no-GL / reduced-motion Inspect path.
// usage: node scripts/hero/render-stages.mjs [baseUrl=http://127.0.0.1:4402] [outDir=public/gl/stages]   (CHANNEL=chrome for a real GPU)
// Output: {sdf,warp,flow,composite}.webp (light) and {...}-dark.webp, each <= 60 KB. Rendered from the live hero with
// ?stage=<id>&tier=high&t=3 (clock frozen), clipped to the poster's .stage box so the stills drop onto it 1:1.
// Run against `npm run build && npm run preview`. The flow still is captured right after a short drag so the arrows show.
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';

const [base = 'http://127.0.0.1:4402', out = 'public/gl/stages'] = process.argv.slice(2);
const MAX = 60 * 1024;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.CHANNEL ? { channel: process.env.CHANNEL } : {});

async function encode(png) {
  for (let q = 84; q >= 30; q -= 6) {
    const buf = await sharp(png).webp({ quality: q, effort: 6, smartSubsample: true }).toBuffer();
    if (buf.length <= MAX) return { buf, q };
  }
  throw new Error('cannot get under 60 KB');
}

for (const scheme of ['light', 'dark']) {
  for (const stage of ['sdf', 'warp', 'flow', 'composite']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: scheme });
    const page = await ctx.newPage();
    await page.goto(`${base}/?stage=${stage}&tier=high&t=3`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => document.querySelector('[data-hero-poster].gl-done'), null, { timeout: 25000 });
    await page.waitForTimeout(400);
    const box = await page.locator('[data-hero-poster] .stage').boundingBox();
    if (stage === 'flow') {
      const c = await page.locator('.hero-gl').boundingBox();
      await page.mouse.move(c.x + c.width * 0.12, c.y + c.height * 0.35);
      await page.mouse.down();
      for (let i = 0; i <= 30; i++) {
        const t = i / 30;
        await page.mouse.move(c.x + c.width * (0.12 + 0.62 * t), c.y + c.height * (0.4 + 0.2 * Math.sin(t * 7)));
        await page.waitForTimeout(12);
      }
      await page.mouse.up();
    }
    const png = await page.screenshot({ clip: box });
    const { buf, q } = await encode(png);
    const name = `${stage}${scheme === 'dark' ? '-dark' : ''}.webp`;
    writeFileSync(`${out}/${name}`, buf);
    console.log(name, `${Math.round(box.width)}x${Math.round(box.height)}`, `${(buf.length / 1024).toFixed(1)} KB (q${q})`);
    await ctx.close();
  }
}
await browser.close();
