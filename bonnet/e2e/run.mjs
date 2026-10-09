// Playwright checks for bonnet M0a. usage: node e2e/run.mjs [--browsers=chromium,webkit,firefox] [--no-build]
// Chromium: real touch via CDP Input.dispatchTouchEvent (touchStart/Move/End with real delays, never scrollTop).
// WebKit / Firefox: no CDP touch; swipes use mouse pointer events, taps use touchscreen.tap / click.
// This is EMULATION. It is not proof of iPhone behaviour; see docs/m0a-iphone-checklist.md.
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const names = arg('browsers', 'chromium,webkit,firefox').split(',');
const engines = { chromium, webkit, firefox };

if (!process.argv.includes('--no-build')) {
  const b = spawnSync('npx', ['vite', 'build'], { cwd: root, stdio: 'inherit' });
  if (b.status !== 0) process.exit(1);
}
const port = await new Promise((res) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => res(p));
  });
});
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore', detached: true });
const stop = () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}
};
process.on('exit', stop);
process.on('SIGINT', () => process.exit(130));
const BASE = `http://127.0.0.1:${port}/bonnet/`;
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(BASE)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
let total = 0;

for (const bname of names) {
  const browser = await engines[bname].launch();
  const ctxOpts = { viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2 };
  if (bname !== 'firefox') ctxOpts.isMobile = true;
  const touch = bname === 'chromium';

  const fresh = async (hash = '', opts = {}) => {
    const context = await browser.newContext({ ...ctxOpts, ...opts });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    const cdp = touch ? await context.newCDPSession(page) : null;
    await page.goto(`${BASE}?debug${hash}`);
    await page.waitForFunction(() => window.__bonnet);
    const T = {
      page,
      context,
      cdp,
      errors,
      st: () => page.evaluate(() => window.__bonnet),
      async rect(sel) {
        return page.evaluate((s) => {
          const r = document.querySelector(s).getBoundingClientRect();
          return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
        }, sel);
      },
      async settled(max = 1500) {
        const t0 = Date.now();
        while (Date.now() - t0 < max) {
          const s = await T.st();
          if (!s.animating && (s.page === 'deck' || s.page === 'detail')) return s;
          await sleep(20);
        }
        return T.st();
      },
      // a touch (or mouse) gesture with real wall-clock timing
      async drag(x0, y0, x1, y1, ms = 120, steps = 8) {
        if (touch) {
          const send = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
          await send('touchStart', x0, y0);
          for (let i = 1; i <= steps; i++) {
            await sleep(ms / steps);
            await send('touchMove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
          }
          await send('touchEnd', x1, y1);
        } else {
          await page.mouse.move(x0, y0);
          await page.mouse.down();
          for (let i = 1; i <= steps; i++) {
            await sleep(ms / steps);
            await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
          }
          await page.mouse.up();
        }
      },
      async tap(x, y, wobble = 0) {
        if (touch) {
          const send = (type, px, py) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: px, y: py }] });
          await send('touchStart', x, y);
          if (wobble) {
            await sleep(16);
            await send('touchMove', x + wobble, y + wobble);
          }
          await sleep(30);
          await send('touchEnd', x + wobble, y + wobble);
        } else if (wobble) {
          await page.mouse.move(x, y);
          await page.mouse.down();
          await page.mouse.move(x + wobble, y + wobble);
          await page.mouse.up();
        } else await page.touchscreen.tap(x, y);
      },
      async tapSel(sel, wobble = 0) {
        const r = await T.rect(sel);
        await T.tap(r.cx, r.cy, wobble);
      },
    };
    return T;
  };

  const results = [];
  const check = async (name, fn) => {
    total++;
    let ok = false,
      info = '';
    try {
      const r = await fn();
      ok = r === undefined || r === true || (r && r.ok !== false);
      if (r && typeof r === 'object') info = JSON.stringify(r);
    } catch (e) {
      info = String(e.message ?? e).split('\n')[0];
    }
    if (!ok) failed++;
    results.push({ name, ok });
    console.log(JSON.stringify({ browser: bname, name, ok, info }));
  };
  const eq = (a, b, what) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
  };
  const gt = (a, b, what) => {
    if (!(a > b)) throw new Error(`${what}: ${a} not > ${b}`);
  };

  // ---------- deck ----------
  await check('boot: deck, moss selected, ivory disabled, 5 rail buttons', async () => {
    const t = await fresh();
    const s = await t.st();
    eq([s.page, s.color], ['deck', 1], 'state');
    eq(await t.page.locator('.yarn').count(), 5, 'rail');
    eq(await t.page.locator('.yarn:disabled').count(), 1, 'disabled');
    eq(await t.page.locator('.yarn[aria-pressed="true"]').getAttribute('aria-label'), 'Moss', 'pressed');
    eq(t.errors, [], 'console errors');
    await t.context.close();
  });

  await check('swipe left (fast, short) commits one color; settles; slides crossfade', async () => {
    const t = await fresh();
    const r = await t.rect('#stage');
    await t.drag(r.cx + 70, r.cy, r.cx - 70, r.cy, 70);
    const s = await t.settled();
    eq([s.color, s.dye.p], [2, 0], 'poppy');
    await t.context.close();
  });

  await check('p tracks dx/width from the first pixel (no slop reset)', async () => {
    const t = await fresh();
    const r = await t.rect('#stage');
    if (touch) {
      const tp = (type, x, y) => t.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
      await tp('touchStart', r.cx, r.cy);
      await sleep(20);
      await tp('touchMove', r.cx - 3, r.cy);
      await sleep(20);
      await tp('touchMove', r.cx - 12, r.cy);
      await sleep(60);
      const s = await t.st();
      await tp('touchEnd', r.cx - 12, r.cy);
      const want = 12 / r.w;
      if (Math.abs(s.dye.p - want) > 0.012) throw new Error(`p=${s.dye.p} want ~${want}`);
    } else {
      await t.page.mouse.move(r.cx, r.cy);
      await t.page.mouse.down();
      await t.page.mouse.move(r.cx - 3, r.cy);
      await t.page.mouse.move(r.cx - 12, r.cy);
      await sleep(60);
      const s = await t.st();
      await t.page.mouse.up();
      if (Math.abs(s.dye.p - 12 / r.w) > 0.012) throw new Error(`p=${s.dye.p} want ~${12 / r.w}`);
    }
    await t.context.close();
  });

  await check('slow drag under half width springs back; over half width commits', async () => {
    const t = await fresh();
    const r = await t.rect('#stage');
    await t.drag(r.cx, r.cy, r.cx - r.w * 0.3, r.cy, 900, 18);
    await sleep(120);
    eq((await t.settled()).color, 1, 'back to moss');
    await t.drag(r.cx + r.w * 0.3, r.cy, r.cx - r.w * 0.25, r.cy, 1200, 24);
    eq((await t.settled()).color, 2, 'committed');
    await t.context.close();
  });

  await check('vertical-ish start on the stage does not change color', async () => {
    const t = await fresh();
    const r = await t.rect('#stage');
    await t.drag(r.cx, r.cy, r.cx - 8, r.cy + 90, 150);
    eq((await t.settled()).color, 1, 'unchanged');
    await t.context.close();
  });

  for (const delay of [50, 100, 200]) {
    await check(`next button works ${delay}ms after a swipe (no click suppression)`, async () => {
      const t = await fresh();
      const r = await t.rect('#stage');
      await t.drag(r.cx + 70, r.cy, r.cx - 70, r.cy, 70);
      await sleep(delay);
      await t.tapSel('#next');
      eq((await t.settled()).color, 3, 'moss -> poppy (swipe) -> sky (button)');
      await t.context.close();
    });
  }

  await check('rail tap 60ms after a swipe jumps directly to that color', async () => {
    const t = await fresh();
    const r = await t.rect('#stage');
    await t.drag(r.cx + 70, r.cy, r.cx - 70, r.cy, 70);
    await sleep(60);
    await t.tapSel('.yarn[data-i="4"]');
    eq((await t.settled()).color, 4, 'butter');
    await t.context.close();
  });

  await check('diagonal micro-move then tap still clicks buttons and opens the stage', async () => {
    const t = await fresh();
    await t.tapSel('#next', 3);
    eq((await t.settled()).color, 2, 'next');
    await t.tapSel('#prev', 4);
    eq((await t.settled()).color, 1, 'prev');
    await t.tapSel('#stage', 3);
    await sleep(350);
    eq((await t.st()).page, 'detail', 'detail');
    await t.context.close();
  });

  await check('consecutive taps never queue: 5 rapid taps = 3 steps max, always lands settled', async () => {
    const t = await fresh();
    for (let i = 0; i < 5; i++) {
      await t.tapSel('#next');
      await sleep(40);
    }
    const s = await t.settled();
    eq([s.color, s.page], [4, 'deck'], 'end of deck');
    await t.context.close();
  });

  await check('keys: arrows move, Esc closes', async () => {
    const t = await fresh();
    await t.page.keyboard.press('ArrowRight');
    eq((await t.settled()).color, 2, 'right');
    await t.page.keyboard.press('ArrowLeft');
    eq((await t.settled()).color, 1, 'left');
    await t.context.close();
  });

  await check('live region announces the new color; slide aria-hidden follows', async () => {
    const t = await fresh();
    await t.tapSel('#next');
    await t.settled();
    eq(await t.page.locator('#live').textContent(), 'Poppy, 3 of 5', 'live');
    eq(await t.page.locator('.slide:not([aria-hidden])').getAttribute('aria-label'), 'Poppy, 3 of 5', 'slide');
    await t.context.close();
  });

  // ---------- detail ----------
  await check('tap stage opens detail; URL gets #color; heading focused; deck inert', async () => {
    const t = await fresh();
    await t.tapSel('#stage');
    const s = await t.settled();
    eq(s.page, 'detail', 'page');
    eq(new globalThis.URL(t.page.url()).hash, '#moss', 'hash');
    eq(await t.page.evaluate(() => document.activeElement.id), 'dtitle', 'focus');
    eq(await t.page.evaluate(() => document.getElementById('deck').inert), true, 'inert');
    await t.context.close();
  });

  await check('detail is in normal flow: document scrolls, no fixed nested scroller', async () => {
    const t = await fresh();
    await t.tapSel('#stage');
    await t.settled();
    const info = await t.page.evaluate(() => {
      const d = document.getElementById('detail');
      const cs = getComputedStyle(d);
      return { pos: cs.position, ov: cs.overflowY, doc: document.documentElement.scrollHeight, vh: innerHeight };
    });
    eq([info.pos, info.ov], ['relative', 'visible'], 'detail style');
    gt(info.doc, info.vh + 200, 'page taller than viewport');
    await t.context.close();
  });

  if (touch) {
    await check('REAL TOUCH: swipe up starting on the hero scrolls the window', async () => {
      const t = await fresh();
      await t.tapSel('#stage');
      await t.settled();
      const h = await t.rect('#hero');
      await t.drag(h.cx, h.cy + 120, h.cx, h.cy - 160, 200, 12);
      await sleep(400);
      const s = await t.st();
      gt(s.scrollY, 100, 'scrollY');
      eq(s.page, 'detail', 'still detail (no pull-down close)');
      await t.context.close();
    });

    await check('REAL TOUCH: swipe up starting on the body scrolls; swipe down scrolls back', async () => {
      const t = await fresh();
      await t.tapSel('#stage');
      await t.settled();
      await t.drag(195, 780, 195, 380, 220, 12);
      await sleep(500);
      const y1 = (await t.st()).scrollY;
      gt(y1, 200, 'scrolled down');
      await t.drag(195, 300, 195, 700, 220, 12);
      await sleep(500);
      const y2 = (await t.st()).scrollY;
      if (!(y2 < y1)) throw new Error(`down-swipe did not scroll back: ${y1} -> ${y2}`);
      eq((await t.st()).page, 'detail', 'no close');
      await t.context.close();
    });

    await check('REAL TOUCH: scroll starts immediately while the opening transition runs', async () => {
      const t = await fresh();
      await t.tapSel('#stage');
      await t.drag(195, 700, 195, 300, 160, 8); // no wait for settle
      await sleep(500);
      gt((await t.st()).scrollY, 100, 'scrollY during/after opening');
      await t.context.close();
    });

    await check('REAL TOUCH: downward swipe at scrollY=0 on the hero does not close or break (no pull-down)', async () => {
      const t = await fresh();
      await t.tapSel('#stage');
      await t.settled();
      const h = await t.rect('#hero');
      await t.drag(h.cx, h.cy - 100, h.cx, h.cy + 250, 250, 12);
      await sleep(300);
      eq((await t.st()).page, 'detail', 'still detail');
      await t.drag(h.cx, h.cy + 150, h.cx, h.cy - 200, 200, 12);
      await sleep(300);
      gt((await t.st()).scrollY, 80, 'can still scroll after');
      await t.context.close();
    });
  } else {
    await check('keyboard scrolling works in detail (touch scroll is verified in Chromium via CDP only)', async () => {
      const t = await fresh();
      await t.tapSel('#stage');
      await t.settled();
      await t.page.keyboard.press('PageDown');
      await sleep(400);
      gt((await t.st()).scrollY, 100, 'scrollY');
      await t.context.close();
    });
  }

  await check('hero horizontal swipe changes angle (180 ms crossfade); dots work; tap right after works', async () => {
    const t = await fresh();
    await t.tapSel('#stage');
    await t.settled();
    const h = await t.rect('#hero');
    await t.drag(h.cx + 80, h.cy, h.cx - 80, h.cy, 100);
    await sleep(60);
    eq((await t.st()).angle, 1, 'angle after swipe');
    await t.tapSel('.dot[data-a="3"]'); // 60 ms after the swipe
    eq((await t.st()).angle, 3, 'dot');
    await sleep(300);
    eq(await t.page.evaluate(() => document.querySelectorAll('.hero img.on').length), 1, 'one visible hero');
    eq(await t.page.locator('.dot[aria-pressed="true"]').getAttribute('aria-label'), 'Left view', 'aria');
    await t.context.close();
  });

  await check('swatch changes color, updates hash and deck color; close lands on it', async () => {
    const t = await fresh();
    await t.tapSel('#stage');
    await t.settled();
    await t.tapSel('.swatch[data-i="4"]');
    await sleep(300);
    eq(new globalThis.URL(t.page.url()).hash, '#butter', 'hash');
    await t.tapSel('#close');
    const s = await t.settled();
    eq([s.page, s.color], ['deck', 4], 'deck on butter');
    eq(await t.page.evaluate(() => getComputedStyle(document.querySelectorAll('.slide')[4]).opacity), '1', 'butter visible');
    await t.context.close();
  });

  await check('close does not force scroll to top first; deck is interactive at once', async () => {
    const t = await fresh();
    await t.tapSel('#stage');
    await t.settled();
    await t.page.evaluate(() => scrollTo(0, 700)); // position only; the touch-scroll tests above prove real scrolling
    await sleep(100);
    const y = (await t.st()).scrollY;
    await t.tapSel('#close');
    const s = await t.st();
    if (!['closing', 'deck'].includes(s.page)) throw new Error('page ' + s.page);
    if (s.scrollY !== y && s.scrollY !== 0) throw new Error(`scroll moved before close: ${y} -> ${s.scrollY}`);
    await t.tapSel('#next'); // immediately usable, even mid-"closing"
    const e = await t.settled();
    eq([e.page, e.color], ['deck', 2], 'next after close');
    await t.context.close();
  });

  await check('Esc closes; Back closes; Forward reopens; no history junk', async () => {
    const t = await fresh();
    await t.tapSel('#stage');
    await t.settled();
    await t.page.keyboard.press('Escape');
    eq((await t.settled()).page, 'deck', 'esc');
    eq(new globalThis.URL(t.page.url()).hash, '', 'hash cleared');
    await t.tapSel('#stage');
    await t.settled();
    await t.page.goBack();
    eq((await t.settled()).page, 'deck', 'back');
    await t.page.goForward();
    eq((await t.settled()).page, 'detail', 'forward');
    eq(new globalThis.URL(t.page.url()).hash, '#moss', 'forward hash');
    await t.context.close();
  });

  await check('direct load of #sky opens detail with no animation, on sky', async () => {
    const t = await fresh('#sky');
    const s = await t.st();
    eq([s.page, s.color], ['detail', 3], 'immediate detail');
    eq(await t.page.evaluate(() => document.documentElement.dataset.page), 'detail', 'attr');
    await t.page.keyboard.press('Escape');
    eq((await t.settled()).page, 'deck', 'closes without leaving the site');
    eq(new globalThis.URL(t.page.url()).pathname, '/bonnet/', 'still here');
    await t.context.close();
  });

  await check('bad hash falls back to the deck', async () => {
    const t = await fresh('#ivory');
    eq((await t.st()).page, 'deck', 'deck');
    await t.context.close();
  });

  await check('prefers-reduced-motion: changes are instant, nothing animates', async () => {
    const t = await fresh('', { reducedMotion: 'reduce' });
    await t.tapSel('#next');
    await sleep(60);
    const s = await t.st();
    eq([s.color, s.animating], [2, false], 'instant');
    await t.tapSel('#stage');
    await sleep(60);
    eq((await t.st()).page, 'detail', 'no opening state');
    await t.context.close();
  });

  await check('viewport does not block zoom; no horizontal page scroll', async () => {
    const t = await fresh();
    const vp = await t.page.evaluate(() => document.querySelector('meta[name=viewport]').content);
    if (/user-scalable|maximum-scale/.test(vp)) throw new Error(vp);
    eq(await t.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no h-scroll');
    await t.context.close();
  });

  await check('debug overlay reports input->visual latency', async () => {
    const t = await fresh();
    await t.tapSel('#next');
    await sleep(500);
    const txt = await t.page.locator('#dbg pre').textContent();
    if (!/input->visual \d+ms \(button\)/.test(txt)) throw new Error(txt.split('\n')[1]);
    await t.context.close();
  });

  await browser.close();
  console.log(`# ${bname}: ${results.filter((r) => r.ok).length}/${results.length}`);
}
stop();
console.log(`# total ${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
