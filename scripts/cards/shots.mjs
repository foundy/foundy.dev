// Phase 5 screenshots (viewport-size, <= 300 KB): node scripts/cards/shots.mjs [baseUrl] [outDir]
// Chromium only. Drags use CDP input with explicit timestamps so the recorded flick is reproducible.
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const [base = 'http://127.0.0.1:4402', out = 'docs/screenshots/phase-5'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.CHANNEL ? { channel: process.env.CHANNEL } : {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function open(vp) {
  const mobile = vp.w < 600;
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: mobile ? 2 : 1, ...(mobile ? { hasTouch: true, isMobile: true } : {}) });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(`${base}/?hud=0`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => document.querySelector('[data-hero-poster].gl-done'), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);
  return { ctx, page, mobile, cdp: await ctx.newCDPSession(page) };
}

async function drag(cdp, touch, x, y, moves, hold = false) {
  let t = Date.now() / 1000;
  let cy = y;
  const send = (type, yy) =>
    touch
      ? cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: yy }], timestamp: t })
      : cdp.send('Input.dispatchMouseEvent', { type, x, y: yy, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, timestamp: t });
  await send(touch ? 'touchStart' : 'mousePressed', cy);
  for (const [dy, dt] of moves) {
    cy += dy;
    t += dt / 1000;
    await send(touch ? 'touchMove' : 'mouseMoved', cy);
  }
  if (!hold) await send(touch ? 'touchEnd' : 'mouseReleased', cy);
}
const rep = (n, dy, dt) => Array.from({ length: n }, () => [dy, dt]);
const FLICK = [...rep(2, 6, 8), ...rep(4, 30, 6)];
const state = (page) => page.evaluate(() => document.documentElement.dataset.cardsState);
const waitState = (page, s) => page.waitForFunction((w) => document.documentElement.dataset.cardsState === w, s, { timeout: 5000 });
async function openSheet(page, mobile) {
  const t = page.locator('[data-card="card-study"] [data-card-title]');
  await t.scrollIntoViewIfNeeded();
  if (mobile) await t.tap();
  else await t.click();
  await waitState(page, 'open');
  await page.waitForTimeout(350);
}
const heroPt = async (page) => {
  const b = await page.locator('.sheet .sh-hero svg').boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

for (const vp of [
  { w: 1440, h: 900, tag: 'desktop' },
  { w: 390, h: 844, tag: 'mobile' },
]) {
  const { ctx, page, mobile, cdp } = await open(vp);
  const card = page.locator('[data-card="card-study"]');
  await card.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -40));
  await page.waitForTimeout(300);
  await save(await page.screenshot(), `cards-rest-${vp.tag}`);

  await openSheet(page, mobile);
  await save(await page.screenshot(), `sheet-open-${vp.tag}`);

  if (mobile) {
    const p = await heroPt(page);
    await drag(cdp, true, p.x, p.y, rep(30, 6, 16), true);
    await page.waitForTimeout(150);
    await save(await page.screenshot(), 'sheet-mid-drag-mobile');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await waitState(page, 'open'); // 180 px slow pull: snaps back
    await page.waitForTimeout(600);
  }

  // Inspect on, then a flick; the timeline stays after the sheet closes
  await page.locator('.sheet-bar [data-inspect-toggle]').click();
  await page.waitForSelector('[data-inspect-panel="cards"]', { timeout: 8000 });
  await page.waitForTimeout(500);
  const p = await heroPt(page);
  await drag(cdp, mobile, p.x, p.y, FLICK);
  await waitState(page, 'idle');
  await page.waitForSelector('.inspect-play', { timeout: 5000 });
  await page.waitForTimeout(600);
  await save(await page.screenshot(), `inspect-timeline-${vp.tag}`);
  // and half way through a replay
  await page.locator('.inspect-stop').nth(1).click();
  await page.waitForTimeout(300);
  await save(await page.screenshot(), `inspect-timeline-drag-${vp.tag}`);
  await ctx.close();
}
await browser.close();
