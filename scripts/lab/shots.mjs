// Phase 6 screenshots -> docs/screenshots/phase-6/ (each <= 300 KB).
// usage: node scripts/lab/shots.mjs [baseUrl=http://127.0.0.1:4404] [outDir]
import { chromium } from 'playwright';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const [base = 'http://127.0.0.1:4404', out = join(here, '../../docs/screenshots/phase-6')] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name, clip) {
  const png = await page.screenshot({ ...(clip ? { clip } : {}) });
  const file = join(out, `${name}.png`);
  await sharp(png).png({ palette: true, quality: 85, compressionLevel: 9 }).toFile(file);
  console.log(name, Math.round(statSync(file).size / 1024) + ' KB');
}

async function open(w, h, mobile) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, ...(mobile ? { hasTouch: true, isMobile: true } : {}) });
  const page = await ctx.newPage();
  await page.goto(`${base}/lab/`);
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page };
}
const sec = (page, id) => page.locator(`[data-lab="${id}"]`);
async function ready(page, id) {
  await page.locator(`[data-lab="${id}"]`).scrollIntoViewIfNeeded();
  await page.waitForSelector(`[data-lab="${id}"][data-lab-ready="1"]`);
}
async function seek(page, id, ms) {
  await sec(page, id).locator('.lab-range').first().evaluate((el, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, ms);
}

{
  const { ctx, page } = await open(1440, 900);
  await ready(page, 'release-rule');
  await sleep(1800); // autoplay finishes: both sides at their final state
  await page.evaluate(() => scrollBy(0, 40));
  await shot(page, 'lab-overview-desktop');
  await sec(page, 'release-rule').locator('.lab-chip', { hasText: 'Short fast flick' }).click();
  await sleep(200);
  await page.evaluate(() => document.querySelector('[data-lab="release-rule"] .lab-ui').scrollIntoView({ block: 'start' }));
  await page.locator('[data-lab="release-rule"] .lab-play').click(); // pause
  await seek(page, 'release-rule', 200);
  await sleep(100);
  await shot(page, 'comparison-midreplay-desktop');
  await page.evaluate(() => document.querySelector('[data-lab="release-rule"] [data-tau]').scrollIntoView({ block: 'center' }));
  await page.locator('#tau-release-rule').evaluate((el) => {
    el.value = '40';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(200);
  await shot(page, 'tunable-tau-40-desktop');
  await ctx.close();
}
{
  const { ctx, page } = await open(390, 844, true);
  await ready(page, 'close-order');
  await sleep(300);
  await page.locator('[data-lab="close-order"] .lab-play').click();
  await seek(page, 'close-order', 880);
  await page.evaluate(() => document.querySelector('[data-lab="close-order"] [data-side="old"] [data-hit]').scrollIntoView({ block: 'center' }));
  await sleep(150);
  await shot(page, 'comparison-midreplay-mobile');
  await ctx.close();
}
await browser.close();
