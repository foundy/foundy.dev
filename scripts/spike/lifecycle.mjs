// Lifecycle checks per page/backend: reduced motion, offscreen pause, hidden tab pause, resize, dispose.
// Needs the preview server on :4401.   usage: node scripts/spike/lifecycle.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:4401';
const cases = [
  ['raw', '/spike/raw/?hud=1'],
  ['three', '/spike/three/?hud=1'],
  ['three-gl2', '/spike/three/?hud=1&gl=webgl2'],
];
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu'] });
const res = [];

for (const [id, url] of cases) {
  const r = { case: id };
  const errors = [];

  // 1. reduced motion: no loop, one static frame (canvas not blank)
  {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(BASE + url);
    await p.waitForSelector('#gl[data-ready="1"]');
    await p.waitForTimeout(600);
    r.reducedMotion = await p.evaluate(() => ({ running: window.__spike.isRunning(), frames: window.__spike.stats().frames }));
    await p.screenshot({ path: `/tmp/rm-${id}.png` });
    // resize while static must redraw (not go blank)
    await p.setViewportSize({ width: 700, height: 600 });
    await p.waitForTimeout(400);
    r.reducedMotion.afterResizePx = await p.evaluate(() => window.__spike.info.canvasPx);
    await p.screenshot({ path: `/tmp/rm-${id}-resized.png` });
    await ctx.close();
  }

  // 2-5. normal motion
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await p.goto(BASE + url);
  await p.waitForSelector('#gl[data-ready="1"]');
  await p.waitForTimeout(500);
  r.runningInitially = await p.evaluate(() => window.__spike.isRunning());

  // offscreen pause: push canvas out of the viewport and scroll away
  await p.evaluate(() => {
    const s = document.createElement('div');
    s.style.height = '4000px';
    document.body.prepend(s);
    window.scrollTo(0, 3900);
  });
  await p.waitForTimeout(400);
  r.onscreenAfterScrollRunning = await p.evaluate(() => window.__spike.isRunning());
  await p.evaluate(() => window.scrollTo(0, 0)); // canvas now ~4000px below the viewport
  await p.waitForTimeout(400);
  r.offscreenRunning = await p.evaluate(() => window.__spike.isRunning());
  await p.evaluate(() => window.scrollTo(0, 3900));
  await p.waitForTimeout(300);
  r.backOnscreenRunning = await p.evaluate(() => window.__spike.isRunning());

  // hidden tab pause (simulated visibility)
  await p.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await p.waitForTimeout(200);
  r.hiddenRunning = await p.evaluate(() => window.__spike.isRunning());
  await p.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await p.waitForTimeout(200);
  r.visibleAgainRunning = await p.evaluate(() => window.__spike.isRunning());

  // resize
  const before = await p.evaluate(() => window.__spike.info.canvasPx);
  await p.setViewportSize({ width: 600, height: 700 });
  await p.waitForTimeout(400);
  const after = await p.evaluate(() => window.__spike.info.canvasPx);
  r.resize = { before, after };

  // dispose
  await p.evaluate(() => window.__spike.dispose());
  await p.waitForTimeout(300);
  r.dispose = await p.evaluate(() => ({ disposed: window.__spike.disposed, running: window.__spike.isRunning() }));
  r.errors = errors.slice(0, 5);
  await ctx.close();
  res.push(r);
}
await browser.close();
console.log(JSON.stringify(res, null, 1));
