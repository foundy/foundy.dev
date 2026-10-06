// Phase 3 screenshots (viewport-size, compressed to <= 300 KB): rest, mid-drag, mobile rest, dark rest.
// usage: node scripts/hero/shots.mjs [baseUrl] [outDir]   (CHANNEL=chrome for the real GPU)
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const [base = 'http://127.0.0.1:4402', out = 'docs/screenshots/phase-3'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.CHANNEL ? { channel: process.env.CHANNEL } : {});

async function save(png, name) {
  let q = 90;
  let buf;
  for (;;) {
    buf = await sharp(png).png({ palette: true, quality: q, effort: 10, colours: 128 }).toBuffer();
    if (buf.length <= 300 * 1024 || q <= 40) break;
    q -= 10;
  }
  await sharp(buf).toFile(`${out}/${name}.png`);
  console.log(name, (buf.length / 1024).toFixed(0), 'KB');
}

async function open(opts, query) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(`${base}/${query}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => document.querySelector('[data-hero-poster].gl-done'), null, { timeout: 20000 });
  await page.waitForTimeout(500);
  return { ctx, page };
}

const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };

{
  const { ctx, page } = await open(desktop, '?t=3');
  await save(await page.screenshot(), 'rest-1440');
  const r = await page.locator('.hero-gl').boundingBox();
  // mid-drag: button down, sweep through "ou", stop while the ink is still moving
  await page.mouse.move(r.x + r.width * 0.2, r.y + r.height * 0.3);
  await page.mouse.down();
  const N = 36;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    await page.mouse.move(r.x + r.width * (0.2 + 0.5 * t), r.y + r.height * (0.3 + 0.35 * t + 0.1 * Math.sin(t * 8)), { steps: 1 });
    await page.waitForTimeout(14);
  }
  await page.waitForTimeout(60);
  await save(await page.screenshot(), 'drag-1440');
  await page.mouse.up();
  await ctx.close();
}
{
  const { ctx, page } = await open({ ...desktop, colorScheme: 'dark' }, '?t=3');
  await save(await page.screenshot(), 'rest-dark-1440');
  await ctx.close();
}
{
  const { ctx, page } = await open(
    { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
    '?t=3',
  );
  await save(await page.screenshot(), 'rest-mobile-390');
  await ctx.close();
}
await browser.close();
