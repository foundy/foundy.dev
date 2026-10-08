// Shared helpers for the Playwright scripts: contexts, real-time pointer gestures, state readers.
import { chromium, webkit, firefox } from 'playwright';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const launch = (br) => ({ chromium, webkit, firefox })[br].launch();

export async function newPage(browser, br, kind, extra = {}) {
  const mobile = kind === 'mobile';
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: mobile ? 2 : 1,
    ...(mobile ? { hasTouch: true, isMobile: br !== 'firefox' } : {}),
    ...extra,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  // touch gestures need CDP (Chromium only); everywhere else a mouse drag exercises the same pointer pipeline
  const cdp = mobile && br === 'chromium' ? await ctx.newCDPSession(page) : null;
  return { ctx, page, errors, cdp, mobile };
}

export const state = (page) => page.evaluate(() => ({ mode: __bonnet.mode, p: __bonnet.p, pos: __bonnet.pos, cur: __bonnet.cur, angle: __bonnet.angle, hash: location.hash }));
export const waitMode = (page, mode, timeout = 4000) => page.waitForFunction((m) => __bonnet.mode === m, mode, { timeout });

/** a real-time drag along waypoints [[x,y,ms],...] (ms = time to reach it); optional hold before release */
export async function drag(h, pts, { hold = 0, onHold, paced = false } = {}) {
  const { page, cdp } = h;
  const segs = [];
  let [x, y] = pts[0];
  segs.push([x, y]);
  for (const [nx, ny, ms] of pts.slice(1)) {
    const n = Math.max(1, Math.round(ms / 16));
    for (let i = 1; i <= n; i++) segs.push([x + ((nx - x) * i) / n, y + ((ny - y) * i) / n]);
    x = nx;
    y = ny;
  }
  const pace = 16;
  if (cdp) {
    // explicit virtual timestamps: the browser sees a clean 16 ms cadence however slow the CDP round trips are
    const t0 = Date.now() / 1000;
    let k = 0;
    const wall = performance.now();
    const ts = () => t0 + (k++ * pace) / 1000;
    const wait = async () => {
      if (!paced) return;
      const due = wall + k * pace - performance.now();
      if (due > 0) await sleep(due);
    };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: segs[0][0], y: segs[0][1] }], timestamp: ts() });
    for (const [px, py] of segs.slice(1)) {
      await wait();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: px, y: py }], timestamp: ts() });
    }
    if (hold) {
      await sleep(hold);
      k += Math.round(hold / pace);
    }
    if (onHold) await onHold();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: ts() });
  } else {
    await page.mouse.move(segs[0][0], segs[0][1]);
    await page.mouse.down();
    for (const [px, py] of segs.slice(1)) {
      await sleep(pace);
      await page.mouse.move(px, py);
    }
    if (hold) await sleep(hold);
    if (onHold) await onHold();
    await page.mouse.up();
  }
}

/** records hero + card rects every frame so continuity can be asserted */
export const startRecording = (page) =>
  page.evaluate(() => {
    window.__rec = [];
    const hero = document.querySelector('.hero');
    const loop = (t) => {
      const r = hero.getBoundingClientRect();
      window.__rec.push({ t, mode: __bonnet.mode, p: __bonnet.p, x: r.left, y: r.top, w: r.width, h: r.height });
      window.__recId = requestAnimationFrame(loop);
    };
    window.__recId = requestAnimationFrame(loop);
  });
export const stopRecording = (page) =>
  page.evaluate(() => {
    cancelAnimationFrame(window.__recId);
    return window.__rec;
  });
export const maxStep = (rec) => {
  let m = 0;
  for (let i = 1; i < rec.length; i++) {
    if (rec[i].mode === 'closed' || rec[i - 1].mode === 'closed') continue;
    m = Math.max(m, Math.abs(rec[i].x - rec[i - 1].x), Math.abs(rec[i].y - rec[i - 1].y), Math.abs(rec[i].w - rec[i - 1].w));
  }
  return m;
};
export const cardRect = (page, i) =>
  page.evaluate((k) => {
    const r = document.querySelectorAll('.slide .face')[k].getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }, i);

export const tapAt = (h, x, y) => (h.mobile && h.page.touchscreen ? h.page.touchscreen.tap(x, y) : h.page.mouse.click(x, y));
