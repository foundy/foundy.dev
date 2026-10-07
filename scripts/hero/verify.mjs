// Phase 3 verification matrix for the home hero.
// usage: node scripts/hero/verify.mjs [baseUrl] [browser=chromium|webkit|firefox]   (CHANNEL=chrome for the real GPU)
// Prints one JSON line per check plus a summary; exits 1 if any check fails.
import { chromium, webkit, firefox } from 'playwright';
import sharp from 'sharp';

const [base = 'http://127.0.0.1:4402', br = 'chromium'] = process.argv.slice(2);
const T = { chromium, webkit, firefox }[br];
const browser = await T.launch(br === 'chromium' && process.env.CHANNEL ? { channel: process.env.CHANNEL } : {});
const results = [];
const check = (name, ok, extra = {}) => {
  results.push({ name, ok, ...extra });
  console.log(JSON.stringify({ browser: br, name, ok, ...extra }));
};

const heroReady = (page) => page.waitForFunction(() => window.__hero, null, { timeout: 25000 });
const done = (page) => page.waitForFunction(() => document.querySelector('[data-hero-poster].gl-done'), null, { timeout: 25000 });
const frames = (page) => page.evaluate(() => window.__hero.stats().frames);

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, errors };
}

async function heroShot(page) {
  const r = await page.locator('.hero-gl').boundingBox();
  const png = await page.screenshot({ clip: { x: r.x, y: Math.max(0, r.y), width: r.width, height: Math.min(r.height, 900 - Math.max(0, r.y)) } });
  return { r, raw: await sharp(png).greyscale().raw().toBuffer() };
}
function meanDiff(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

for (const vp of [
  { w: 1440, h: 900, dpr: 1, mobile: false },
  { w: 390, h: 844, dpr: 3, mobile: true },
]) {
  const tag = `${vp.w}x${vp.h}`;
  const opts = { viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.dpr, ...(vp.mobile ? { hasTouch: true, isMobile: br !== 'firefox' } : {}) };

  // 1. poster first, then GL; crossfade; no console errors; time to ready
  {
    const { ctx, page, errors } = await newPage(opts);
    await page.goto(`${base}/?hud=1`, { waitUntil: 'domcontentloaded' });
    const early = await page.evaluate(() => ({
      canvas: !!document.querySelector('.hero-gl'),
      posterVisible: getComputedStyle(document.querySelector('[data-hero-poster] .glyphs')).visibility,
    }));
    check(`${tag} poster is there before GL`, !early.canvas && early.posterVisible === 'visible', early);
    await heroReady(page);
    const fadeStart = await page.evaluate(() => document.querySelector('[data-hero-poster]').classList.contains('gl-on'));
    await done(page);
    // the crossfade ends on an exact 1, but compositor timing can leave 0.99x for a frame: wait for it
    await page.waitForFunction(() => +getComputedStyle(document.querySelector('.hero-gl')).opacity >= 0.99, null, { timeout: 5000 });
    const t = await page.evaluate(() => {
      const m = (n) => performance.getEntriesByName(n)[0]?.startTime;
      const s = window.__hero.stats();
      const op = getComputedStyle(document.querySelector('.hero-gl')).opacity;
      return { chunkMs: m('hero:chunk'), readyMs: m('hero:ready'), mountMs: s.readyMs, tier: s.tier, canvas: s.canvas, op, gpu: s.gpu };
    });
    check(`${tag} GL ready + crossfade`, +t.op >= 0.99, { ...t, fadeAlreadyOnAtReady: fadeStart });
    const js = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /\.js(\?|$)/.test(e.name)).map((e) => [e.name.split('/').pop(), e.encodedBodySize]));
    check(`${tag} no console errors`, errors.length === 0, { errors: errors.slice(0, 3), js });
    await ctx.close();
  }

  // 2. drag changes the image (mouse on desktop; horizontal touch drag handled in the touch section)
  if (!vp.mobile) {
    const { ctx, page } = await newPage(opts);
    await page.goto(`${base}/?hud=1&t=3`);
    await heroReady(page);
    await done(page);
    await page.waitForTimeout(300);
    const before = await heroShot(page);
    const r = before.r;
    await page.mouse.move(r.x + r.width * 0.15, r.y + r.height * 0.35);
    await page.mouse.down();
    const f0 = await frames(page);
    for (let i = 0; i <= 30; i++) {
      await page.mouse.move(r.x + r.width * (0.15 + 0.5 * (i / 30)), r.y + r.height * (0.35 + 0.3 * (i / 30)));
      await page.waitForTimeout(14);
    }
    const mid = await heroShot(page);
    const f1 = await frames(page);
    await page.mouse.up();
    // hover only (no button): gentler
    await page.waitForTimeout(8000);
    const rested = await heroShot(page);
    const d = meanDiff(before.raw, mid.raw);
    const back = meanDiff(before.raw, rested.raw);
    const running = await page.evaluate(() => window.__hero.stats().running);
    check(`${tag} drag changes image, ink returns, loop sleeps`, d > 1 && back < d * 0.1 && !running, { meanDiffMidDrag: +d.toFixed(2), meanDiffAfter8s: +back.toFixed(3), framesDuringDrag: f1 - f0, loopIdleAfter: !running });
    await ctx.close();
  }

  // 3. ?gl=none and reduced motion
  {
    const { ctx, page, errors } = await newPage(opts);
    await page.goto(`${base}/?gl=none&hud=1`);
    await page.waitForTimeout(2500);
    const c = await page.evaluate(() => !!document.querySelector('.hero-gl'));
    check(`${tag} ?gl=none stays on poster`, !c && errors.length === 0);
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await newPage({ ...opts, reducedMotion: 'reduce' });
    await page.goto(`${base}/?hud=1`);
    await page.waitForTimeout(3000);
    const c = await page.evaluate(() => ({ canvas: !!document.querySelector('.hero-gl'), hero: !!window.__hero, glyphs: getComputedStyle(document.querySelector('.glyphs')).visibility }));
    check(`${tag} reduced-motion: no canvas, poster stays`, !c.canvas && !c.hero && c.glyphs === 'visible' && errors.length === 0, c);
    await ctx.close();
  }
}

// 3b. hover (no button) pushes ink gently; live colour-scheme switch re-themes the canvas
{
  const { ctx, page, errors } = await newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`${base}/?hud=1&t=3`);
  await heroReady(page);
  await done(page);
  await page.waitForTimeout(300);
  const rest = await heroShot(page);
  const r = rest.r;
  const sweepMouse = async (down) => {
    await page.mouse.move(r.x + r.width * 0.2, r.y + r.height * 0.4);
    if (down) await page.mouse.down();
    for (let i = 0; i <= 24; i++) {
      await page.mouse.move(r.x + r.width * (0.2 + 0.4 * (i / 24)), r.y + r.height * (0.4 + 0.1 * Math.sin(i / 3)));
      await page.waitForTimeout(14);
    }
  };
  await sweepMouse(false);
  const hover = await heroShot(page);
  await page.waitForTimeout(8000);
  await sweepMouse(true);
  const drag = await heroShot(page);
  await page.mouse.up();
  const dh = meanDiff(rest.raw, hover.raw);
  const dd = meanDiff(rest.raw, drag.raw);
  check('hover adds a gentle force, drag a strong one', dh > 0.05 && dd > dh * 1.5, { hoverMeanDiff: +dh.toFixed(3), dragMeanDiff: +dd.toFixed(3) });
  await page.waitForTimeout(8000);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(700);
  const dark = await heroShot(page);
  const mean = (b) => b.reduce((a, v) => a + v, 0) / b.length;
  check('colour scheme switch re-themes the canvas live', mean(dark.raw) < mean(rest.raw) - 20 || Math.abs(mean(dark.raw) - mean(rest.raw)) > 20, { meanLight: +mean(rest.raw).toFixed(1), meanDark: +mean(dark.raw).toFixed(1), errors: errors.slice(0, 2) });
  await ctx.close();
}

// 4. frame times during a 5 s drag (desktop)
{
  const { ctx, page } = await newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(`${base}/?hud=1`);
  await heroReady(page);
  await done(page);
  await page.evaluate(() => {
    window.__dts = [];
    let last = performance.now();
    const f = (n) => {
      window.__dts.push(n - last);
      last = n;
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  const r = await page.locator('.hero-gl').boundingBox();
  await page.mouse.move(r.x + r.width * 0.5, r.y + r.height * 0.5);
  await page.mouse.down();
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < 5000) {
    i++;
    await page.mouse.move(r.x + r.width * (0.5 + 0.38 * Math.sin(i * 0.11)), r.y + r.height * (0.5 + 0.32 * Math.sin(i * 0.17 + 1)));
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  const s = await page.evaluate(() => {
    const d = window.__dts.slice(2).sort((a, b) => a - b);
    const p = (q) => d[Math.min(d.length - 1, Math.floor(d.length * q))];
    return { n: d.length, p50: p(0.5), p95: p(0.95), max: d[d.length - 1], over20: d.filter((x) => x > 20).length, hero: window.__hero.stats() };
  });
  check('desktop 1440x900@2 frame time during 5s drag', true, { n: s.n, medianMs: +s.p50.toFixed(2), p95Ms: +s.p95.toFixed(2), maxMs: +s.max.toFixed(1), over20ms: s.over20, tier: s.hero.tier, canvas: s.hero.canvas, tierChanges: s.hero.tierChanges });
  await ctx.close();
}

// 5. pause behaviour: off-screen and hidden tab stop the frame counter
{
  const { ctx, page } = await newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/?hud=1`);
  await heroReady(page);
  await done(page);
  const r = await page.locator('.hero-gl').boundingBox();
  await page.mouse.move(r.x + 200, r.y + 100);
  await page.mouse.down();
  const sweep = async (ms) => {
    const t0 = Date.now();
    let i = 0;
    while (Date.now() - t0 < ms) {
      i++;
      await page.mouse.move(r.x + 200 + 300 * Math.sin(i * 0.2), r.y + 150 + 100 * Math.cos(i * 0.2)).catch(() => {});
      await page.waitForTimeout(16);
    }
  };
  await sweep(400);
  const running1 = await page.evaluate(() => window.__hero.stats().running);
  const fA = await frames(page);
  await page.waitForTimeout(300);
  const fB = await frames(page);
  // off-screen
  await page.mouse.up();
  await page.evaluate(() => window.scrollTo(0, 2500));
  await page.waitForTimeout(400);
  const fC = await frames(page);
  await page.waitForTimeout(600);
  const fD = await frames(page);
  const offscreenRunning = await page.evaluate(() => window.__hero.stats().running);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  // hidden tab (emulated: the handler is what is under test)
  await page.mouse.move(r.x + 300, r.y + 150);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hiddenRunning = await page.evaluate(() => window.__hero.stats().running);
  const fE = await frames(page);
  await page.mouse.move(r.x + 400, r.y + 200);
  await page.waitForTimeout(500);
  const fF = await frames(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.mouse.move(r.x + 450, r.y + 220);
  await page.waitForTimeout(300);
  const fG = await frames(page);
  check('pauses off-screen and when hidden, resumes', running1 && fB > fA && fD === fC && !offscreenRunning && !hiddenRunning && fF === fE && fG > fF, { runningDuringDrag: running1, framesAdvancingWhileVisible: [fA, fB], framesOffscreen: [fC, fD], framesHidden: [fE, fF], framesAfterShow: fG });
  await ctx.close();
}

// 6. context loss and restore
{
  const { ctx, page, errors } = await newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/?hud=1&t=3`);
  await heroReady(page);
  await done(page);
  await page.waitForTimeout(300);
  const before = await heroShot(page);
  await page.evaluate(() => {
    const gl = document.querySelector('.hero-gl').getContext('webgl2');
    const e = gl.getExtension('WEBGL_lose_context');
    window.__lose = e;
    e.loseContext();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__lose.restoreContext());
  await page.waitForTimeout(800);
  const after = await heroShot(page);
  const st = await page.evaluate(() => window.__hero.stats());
  check('context lost + restored: image recovers', st.contextLosses === 1 && meanDiff(before.raw, after.raw) < 0.5, { losses: st.contextLosses, meanDiff: +meanDiff(before.raw, after.raw).toFixed(3), errors: errors.slice(0, 2) });
  await ctx.close();
}

// 7. ?stage= and ?tier= flags
for (const stage of ['sdf', 'warp', 'flow', 'composite']) {
  const { ctx, page, errors } = await newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/?hud=1&stage=${stage}&tier=low`);
  await heroReady(page);
  await page.waitForTimeout(400);
  const s = await page.evaluate(() => window.__hero.stats());
  const shot = await heroShot(page);
  let ink = 0;
  for (const v of shot.raw) if (v < 200) ink++;
  check(`?stage=${stage}&tier=low renders`, s.stage === stage && s.tier === 'low' && s.tierPinned && errors.length === 0 && ink > 100, { stage: s.stage, tier: s.tier, sim: s.sim, errors: errors.slice(0, 2) });
  await ctx.close();
}

// 8. touch (Chromium only: CDP touch events)
if (br === 'chromium') {
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  await page.goto(`${base}/?hud=1&t=3`);
  await heroReady(page);
  await done(page);
  await page.waitForTimeout(300);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const r = await page.locator('.hero-gl').boundingBox();
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const scrollY = () => page.evaluate(() => window.scrollY);

  // (a) vertical swipe over the hero scrolls the page
  const y0 = await scrollY();
  await touch('touchStart', cx, cy + 40);
  for (let i = 1; i <= 12; i++) {
    await touch('touchMove', cx, cy + 40 - i * 14);
    await page.waitForTimeout(16);
  }
  await touch('touchEnd');
  await page.waitForTimeout(500);
  const y1 = await scrollY();
  check('mobile: vertical touch swipe over the hero scrolls the page', y1 - y0 > 40, { scrollY: [y0, y1] });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);

  // (b) horizontal drag pushes ink, does not scroll
  const r2 = await page.locator('.hero-gl').boundingBox();
  const a = await heroShot(page);
  await touch('touchStart', r2.x + 30, r2.y + r2.height * 0.55);
  for (let i = 1; i <= 16; i++) {
    await touch('touchMove', r2.x + 30 + i * 14, r2.y + r2.height * 0.55 + Math.sin(i / 2) * 3);
    await page.waitForTimeout(16);
  }
  const b = await heroShot(page);
  await touch('touchEnd');
  const y2 = await scrollY();
  check('mobile: horizontal drag pushes ink and does not scroll', meanDiff(a.raw, b.raw) > 0.3 && y2 === 0, { meanDiff: +meanDiff(a.raw, b.raw).toFixed(3), scrollY: y2 });
  await page.waitForTimeout(7500);

  // (c) long press (300 ms hold), then a vertical move: pushes ink and does not scroll
  const r3 = await page.locator('.hero-gl').boundingBox();
  const c0 = await heroShot(page);
  await touch('touchStart', r3.x + r3.width * 0.4, r3.y + r3.height * 0.3);
  await page.waitForTimeout(450);
  for (let i = 1; i <= 14; i++) {
    await touch('touchMove', r3.x + r3.width * 0.4, r3.y + r3.height * 0.3 + i * 5);
    await page.waitForTimeout(16);
  }
  const c1 = await heroShot(page);
  await touch('touchEnd');
  await page.waitForTimeout(300);
  const y3 = await scrollY();
  check('mobile: long-press then move pushes ink without scrolling', meanDiff(c0.raw, c1.raw) > 0.3 && y3 === 0, { meanDiff: +meanDiff(c0.raw, c1.raw).toFixed(3), scrollY: y3 });
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${br}: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
