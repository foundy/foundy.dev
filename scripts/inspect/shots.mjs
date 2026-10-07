// Phase 4 screenshots (viewport-size, <= 300 KB): node scripts/inspect/shots.mjs [baseUrl] [outDir]
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const [base = 'http://127.0.0.1:4402', out = 'docs/screenshots/phase-4'] = process.argv.slice(2);
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

async function open(opts, query, waitGl = true) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(`${base}/${query}`);
  await page.evaluate(() => document.fonts.ready);
  if (waitGl) await page.waitForFunction(() => document.querySelector('[data-hero-poster].gl-done'), null, { timeout: 20000 });
  await page.waitForTimeout(400);
  return { ctx, page };
}
async function stage(page, i) {
  await page.evaluate(() => document.querySelector('.inspect-range').focus({ preventScroll: true }));
  await page.keyboard.press('Home');
  for (let k = 0; k < i; k++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(700);
}
async function on(page) {
  await page.locator('.inspect[data-inspect-toggle]').click();
  await page.waitForSelector('.inspect-panel');
  await page.mouse.move(2, 2);
  await page.evaluate(() => document.activeElement?.blur?.());
}

const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
{
  const { ctx, page } = await open(desktop, '?t=3');
  await on(page);
  for (const [i, n] of [[0, 'sdf'], [1, 'warp'], [2, 'flow'], [3, 'ink']]) {
    await stage(page, i);
    if (i === 0) {
      await page.locator('.inspect-details summary').click();
      await page.waitForTimeout(400);
    }
    await save(await page.screenshot(), `desktop-${i + 1}-${n}`);
  }
  // flow stage, mid-drag
  await stage(page, 2);
  const c = await page.locator('.hero-gl').boundingBox();
  await page.mouse.move(c.x + c.width * 0.15, c.y + c.height * 0.35);
  await page.mouse.down();
  for (let i = 0; i <= 34; i++) {
    const t = i / 34;
    await page.mouse.move(c.x + c.width * (0.15 + 0.55 * t), c.y + c.height * (0.35 + 0.3 * t + 0.1 * Math.sin(t * 8)));
    await page.waitForTimeout(14);
  }
  await page.waitForTimeout(50);
  await save(await page.screenshot(), 'desktop-flow-drag');
  await page.mouse.up();
  await ctx.close();
}
{
  const { ctx, page } = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }, '?t=3');
  await page.locator('.inspect[data-inspect-toggle]').scrollIntoViewIfNeeded();
  await on(page);
  await stage(page, 2);
  await page.locator('.inspect-panel').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.querySelector('[data-hero-poster]').getBoundingClientRect().top + scrollY - 70));
  await page.waitForTimeout(300);
  await save(await page.screenshot(), 'mobile-inspect-flow');
  await ctx.close();
}
{
  const { ctx, page } = await open(desktop, '?gl=none', false);
  await page.waitForTimeout(800);
  await on(page);
  await stage(page, 1);
  await save(await page.screenshot(), 'fallback-warp-gl-none');
  await ctx.close();
}
{
  const { ctx, page } = await open({ ...desktop, colorScheme: 'dark' }, '?t=3');
  await on(page);
  await stage(page, 0);
  await save(await page.screenshot(), 'desktop-dark-sdf');
  await ctx.close();
}
await browser.close();
