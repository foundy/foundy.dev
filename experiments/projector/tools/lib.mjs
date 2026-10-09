// Shared Playwright helpers (dev only). Chromium is launched with the ANGLE/Metal GPU path when available.
import { chromium } from 'playwright';
export const URL_BASE = process.env.PJ_URL || 'http://127.0.0.1:5199/experiments/projector/';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function launch() {
  return chromium.launch({ executablePath: process.env.PJ_CHROME || '/Users/foundy/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
}
export async function open(browser, set = 'bonnet', opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: opts.dsf ?? 2, hasTouch: true, isMobile: true, ...(opts.video ? { recordVideo: { dir: opts.video, size: { width: 390, height: 844 } } } : {}), ...(opts.ctx || {}) });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
  await page.goto(`${URL_BASE}?set=${set}${opts.debug ? '&debug' : ''}`);
  await page.waitForFunction(() => window.__pj && window.__pj.ready >= 1, null, { timeout: 15000 });
  await sleep(opts.settle ?? 2600);
  return { ctx, page, logs };
}
export const shot = (page, path) => page.screenshot({ path, type: 'jpeg', quality: 84 });
// synthesize touch drag via CDP-free pointer events (Playwright touchscreen has no move, use mouse in non-touch ctx) -> dispatch PointerEvents directly
export async function drag(page, x0, y0, x1, y1, ms = 300, steps = 12) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  await send('touchStart', x0, y0);
  for (let i = 1; i <= steps; i++) { await sleep(ms / steps); await send('touchMove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps); }
  return { end: () => send('touchEnd', x1, y1).then(() => cdp.detach()), cdp, send };
}
