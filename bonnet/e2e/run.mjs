// Playwright checks for bonnet "one product, two worlds".
// usage: node e2e/run.mjs [--browsers=chromium,webkit,firefox] [--no-build] [--only=substring]
// Chromium: real touch via CDP Input.dispatchTouchEvent (touchStart/Move/End with real delays), GPU path (ANGLE/Metal) when available.
// WebKit / Firefox: no CDP touch; drags use mouse pointer events, taps use click. When a browser has no WebGL2 the GL-only checks are
// reported as skipped and the DOM fallback is verified instead.
// This is EMULATION. It is not proof of iPhone behaviour; see docs/worlds-iphone-check.md.
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const names = arg('browsers', 'chromium,webkit,firefox').split(',');
const only = arg('only', '');
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
let skipped = 0;

for (const bname of names) {
  const browser = await engines[bname].launch(bname === 'chromium' ? { args: ['--use-angle=metal', '--ignore-gpu-blocklist'] } : {});
  const ctxOpts = { viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2 };
  if (bname !== 'firefox') ctxOpts.isMobile = true;
  const touch = bname === 'chromium';

  const fresh = async (query = '', opts = {}) => {
    const context = await browser.newContext({ ...ctxOpts, ...opts });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    const cdp = touch ? await context.newCDPSession(page) : null;
    await page.goto(`${BASE}?debug${query ? '&' + query : ''}`);
    await page.waitForFunction(() => window.__bonnet);
    // wait for the boot decision (GL up or DOM fallback)
    await page.waitForFunction(() => window.__bonnet.gl !== 'boot', null, { timeout: 8000 });
    const T = {
      page,
      context,
      cdp,
      errors,
      st: () => page.evaluate(() => window.__bonnet),
      async until(fn, ms = 6000, what = 'condition') {
        const t0 = Date.now();
        let s;
        while (Date.now() - t0 < ms) {
          s = await T.st();
          if (fn(s)) return s;
          await sleep(25);
        }
        throw new Error(`timeout waiting for ${what}; state ${JSON.stringify(s)}`);
      },
      async rest(ms = 6000) {
        return T.until((s) => s.page === 'browse' && !s.sw && s.p === 0 && s.near === s.index && s.settled, ms, 'browse rest');
      },
      /** tap the stage where this world opens the detail */
      async tapOpen() {
        const s = await T.st();
        const y = s.world === 'light' ? 250 : 400;
        if (touch) await page.touchscreen.tap(195, y);
        else await page.mouse.click(195, y);
      },
      async drag(x0, y0, steps, { dt = 16, release = true } = {}) {
        if (touch) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
          for (const [dx, dy] of steps) {
            await sleep(dt);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + dx, y: y0 + dy }] });
          }
          if (release) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else {
          await page.mouse.move(x0, y0);
          await page.mouse.down();
          for (const [dx, dy] of steps) {
            await sleep(dt);
            await page.mouse.move(x0 + dx, y0 + dy);
          }
          if (release) await page.mouse.up();
        }
      },
      async lift() {
        if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        else await page.mouse.up();
      },
      async close() {
        await context.close();
      },
    };
    return T;
  };

  const check = async (name, fn) => {
    if (only && !name.includes(only)) return;
    total++;
    const t0 = Date.now();
    try {
      const r = await fn();
      if (r === 'skip') {
        skipped++;
        console.log(`  - [${bname}] ${name} (skipped)`);
      } else console.log(`  ok [${bname}] ${name} (${Date.now() - t0} ms)`);
    } catch (e) {
      failed++;
      console.log(`  FAIL [${bname}] ${name}\n       ${String(e.message ?? e).split('\n')[0].slice(0, 500)}`);
    }
  };
  const assert = (c, m) => {
    if (!c) throw new Error(m);
  };
  const near = (a, b, tol, m) => assert(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`);
  const withApp = async (query, fn, opts) => {
    const T = await fresh(query, opts);
    try {
      return await fn(T);
    } finally {
      await T.close();
    }
  };

  console.log(`\n== ${bname} ==`);
  const probe = await fresh();
  const hasGl = (await probe.st()).gl === 'on';
  await probe.close();
  console.log(`   webgl2: ${hasGl ? 'yes' : 'NO (DOM fallback only)'}`);

  for (const world of ['light', 'water']) {
    await check(`${world}: boots without errors, shows the product`, () =>
      withApp(`world=${world}`, async (T) => {
        const s = await T.st();
        assert(s.world === world, 'world');
        assert(s.page === 'browse', 'page');
        assert(s.index === 1, 'start index is the 2nd product');
        assert(hasGl ? s.gl === 'on' : s.gl === 'off', `gl mode ${s.gl}`);
        await sleep(600);
        assert(T.errors.length === 0, 'console errors: ' + T.errors.join(' | '));
      }),
    );

    await check(`${world}: tap opens the shared detail (#id), close returns to the same product`, () =>
      withApp(`world=${world}`, async (T) => {
        await T.rest();
        await T.tapOpen();
        const s = await T.until((x) => x.page === 'detail', 7000, 'detail');
        assert(s.index === 1, 'index');
        assert((await T.page.evaluate(() => location.hash)) === '#moss', 'hash #moss');
        assert((await T.page.locator('#dtitle').textContent()) === 'Moss bonnet', 'detail title');
        await T.page.click('#close');
        const b = await T.until((x) => x.page === 'browse', 7000, 'browse');
        assert(b.index === 1 && b.world === world, 'same product and world after close');
        assert((await T.page.evaluate(() => location.hash)) === '', 'hash cleared');
        assert(T.errors.length === 0, 'console errors: ' + T.errors.join(' | '));
      }),
    );

    await check(`${world}: Back / Forward alternate browse and detail`, () =>
      withApp(`world=${world}`, async (T) => {
        await T.rest();
        await T.tapOpen();
        await T.until((x) => x.page === 'detail', 7000, 'detail');
        await T.page.goBack();
        await T.until((x) => x.page === 'browse', 7000, 'browse after back');
        await T.page.goForward();
        await T.until((x) => x.page === 'detail', 7000, 'detail after forward');
        await T.page.goBack();
        await T.until((x) => x.page === 'browse', 7000, 'browse after 2nd back');
        assert((await T.st()).index === 1, 'index kept');
        const n = await T.page.evaluate(() => history.length);
        assert(n <= 4, `no duplicated history entries (${n})`);
      }),
    );

    await check(`${world}: prev / next buttons land one product per tap, 4 rapid taps all register, ends disable`, () =>
      withApp(`world=${world}`, async (T) => {
        await T.rest();
        await T.page.click('#next');
        let s = await T.st();
        assert(s.index === 2, 'next -> 2');
        await T.page.click('#next');
        await T.page.click('#next');
        s = await T.st();
        assert(s.index === 4, 'rapid next x3 -> 4 (no dead taps)');
        assert((await T.page.getAttribute('#next', 'aria-disabled')) === 'true', 'next disabled at the end');
        await T.page.click('#next', { force: true });
        assert((await T.st()).index === 4, 'stays at the end');
        for (let i = 0; i < 4; i++) await T.page.click('#prev');
        assert((await T.st()).index === 0, 'rapid prev x4 -> 0');
        if (hasGl) {
          const r = await T.rest();
          assert(r.near === 0, 'settles on the last target');
        }
        assert(T.errors.length === 0, 'console errors: ' + T.errors.join(' | '));
      }),
    );

    await check(`${world}: keyboard arrows step, Escape closes the detail`, () =>
      withApp(`world=${world}`, async (T) => {
        await T.rest();
        await T.page.keyboard.press('ArrowRight');
        assert((await T.st()).index === 2, 'ArrowRight');
        await T.page.keyboard.press('ArrowLeft');
        assert((await T.st()).index === 1, 'ArrowLeft');
        await T.page.focus('#open');
        await T.page.keyboard.press('Enter');
        await T.until((x) => x.page === 'detail', 7000, 'detail by Enter');
        await T.page.keyboard.press('Escape');
        await T.until((x) => x.page === 'browse', 7000, 'browse by Escape');
      }),
    );

    await check(`${world}: a button works immediately after a drag (no swallowed click)`, () =>
      withApp(`world=${world}`, async (T) => {
        if (!hasGl) return 'skip';
        await T.rest();
        const y = world === 'light' ? 700 : 400;
        await T.drag(195, y, [[-10, 0], [-20, 0], [-30, 0], [-40, 0]]);
        const i0 = (await T.st()).index;
        await sleep(60);
        await T.page.click('#next');
        const s = await T.until((x) => x.index === Math.min(4, i0 + 1) || x.index === 4, 2000, 'next tap after drag');
        assert(s.index >= i0, 'tap counted');
        // and the tap on the stage right after a drag still opens
        assert(T.errors.length === 0, 'console errors: ' + T.errors.join(' | '));
      }),
    );

    await check(`${world}: sticky drag follows the finger within 2 px from the first pixel`, () =>
      withApp(`world=${world}`, async (T) => {
        if (!hasGl || !touch) return 'skip';
        await T.rest();
        const s0 = await T.st();
        const x0 = s0.probe.x;
        const y = world === 'light' ? 700 : 400;
        const worst = [];
        await T.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
        // 3 px first move, then steady: nothing may be swallowed by a slop
        const dxs = [-3, -7, -12, -20, -30, -44, -60, -78, -96, -110];
        for (const dx of dxs) {
          await sleep(20);
          await T.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + dx, y }] });
          await sleep(30);
          const s = await T.st();
          worst.push(Math.abs(s.probe.x - x0 - dx));
        }
        await T.lift();
        assert(Math.max(...worst) <= 2, `tracking error px: ${worst.map((v) => v.toFixed(2)).join(',')}`);
        assert(worst[0] <= 1, 'first 3 px already followed');
        await T.rest();
      }),
    );

    await check(`${world}: release commits past half / on a flick, reverts when short and slow, reversal cancels`, () =>
      withApp(`world=${world}`, async (T) => {
        if (!hasGl) return 'skip';
        await T.rest();
        const y = world === 'light' ? 700 : 400;
        const px = (await T.st()).slotPx;
        // slow, past half a slot -> next
        const half = Math.round(px * 0.62);
        await T.drag(195, y, Array.from({ length: 12 }, (_, i) => [-Math.round((half * (i + 1)) / 12), 0]), { dt: 40 });
        await sleep(450); // finger rested before release: no fling
        let s = await T.rest();
        assert(s.index === 2, `slow 62% drag commits one product (got ${s.index})`);
        // short and slow -> back
        await T.drag(195, y, Array.from({ length: 8 }, (_, i) => [-Math.round((px * 0.25 * (i + 1)) / 8), 0]), { dt: 40 });
        await sleep(300);
        s = await T.rest();
        assert(s.index === 2, `slow 25% drag reverts (got ${s.index})`);
        // flick: tiny but fast
        await T.drag(195, y, [[-12, 0], [-28, 0], [-50, 0]], { dt: 8 });
        s = await T.rest();
        assert(s.index === 3, `a flick is never ignored (got ${s.index})`);
        // reversal beats position: drag 0.8 slot left, then flick back right and release while still past half
        const far = Math.round(px * 0.8);
        await T.drag(195, y, [[-Math.round(far * 0.3), 0], [-Math.round(far * 0.6), 0], [-far, 0], [-far, 0], [-far + 6, 0], [-far + 18, 0], [-far + 34, 0]], { dt: 14 });
        s = await T.rest();
        assert(s.index === 3, `fast reversal cancels (got ${s.index})`);
        // never leaves the list
        for (let i = 0; i < 3; i++) await T.page.click('#next', { force: true });
        await T.rest();
        await T.drag(195, y, [[-30, 0], [-90, 0], [-200, 0], [-300, 0]], { dt: 8 });
        s = await T.rest();
        assert(s.index === 4, `end of the list holds (got ${s.index})`);
        assert(T.errors.length === 0, 'console errors: ' + T.errors.join(' | '));
      }),
    );

    await check(`${world}: a vertical drag does not change the product, and a diagonal micro move then tap still opens`, () =>
      withApp(`world=${world}`, async (T) => {
        if (!hasGl) return 'skip';
        await T.rest();
        const y = world === 'light' ? 700 : 400;
        await T.drag(195, y, [[0, -20], [1, -50], [2, -90], [2, -140]], { dt: 16 });
        const s = await T.rest();
        assert(s.index === 1, 'vertical drag leaves the product');
        const ty = world === 'light' ? 250 : 400;
        await T.drag(195, ty, [[2, 2], [3, 3], [4, 3]], { dt: 16 });
        await T.until((x) => x.page !== 'browse', 3000, 'a tap with a 5 px diagonal slide opens the detail');
      }),
    );

    await check(`${world}: detail scrolls natively right after the tap (during the opening), by finger`, () =>
      withApp(`world=${world}`, async (T) => {
        if (!touch) return 'skip';
        await T.rest();
        await T.tapOpen();
        await T.until((x) => x.page !== 'browse', 3000, 'opening');
        await sleep(90);
        const y0 = hasGl ? 560 : 600;
        await T.drag(195, y0, [[0, -40], [0, -90], [0, -160], [0, -240], [0, -320]], { dt: 16 });
        await sleep(250);
        const s = await T.st();
        assert(s.scrollY > 60, `native scroll started during the opening (scrollY ${s.scrollY})`);
        await T.until((x) => x.page === 'detail', 7000, 'detail');
        assert((await T.st()).scrollY > 60, 'scroll kept after the hand-off');
        await T.drag(195, 400, [[0, -40], [0, -120], [0, -260], [0, -400]], { dt: 16 });
        await sleep(300);
        assert((await T.st()).scrollY > 200, 'detail scrolls from the body too');
        // scrolled away from the hero: close crossfades back
        await T.page.click('#close');
        await T.until((x) => x.page === 'browse', 4000, 'browse after scrolled close');
        assert(T.errors.length === 0, 'console errors: ' + T.errors.join(' | '));
      }),
    );

    await check(`${world}: open then close during the opening (interrupt) ends in browse on the same product`, () =>
      withApp(`world=${world}`, async (T) => {
        await T.rest();
        await T.tapOpen();
        await T.until((x) => x.page === 'opening' || x.page === 'detail', 3000, 'opening');
        await sleep(150);
        await T.page.click('#close');
        const s = await T.until((x) => x.page === 'browse', 7000, 'browse');
        assert(s.index === 1, 'index');
        assert((await T.page.evaluate(() => location.hash)) === '', 'hash cleared');
        assert(T.errors.length === 0, 'console errors: ' + T.errors.join(' | '));
      }),
    );
  }

  await check('world switch both ways keeps the product and the URL/localStorage follow', () =>
    withApp('world=light', async (T) => {
      await T.rest();
      await T.page.click('#next');
      await T.rest();
      await T.page.tap('[data-w=water]').catch(() => T.page.click('[data-w=water]'));
      let s = await T.until((x) => x.world === 'water', 2000, 'water');
      assert(s.index === 2, 'product kept');
      if (hasGl) await T.until((x) => x.sw === null, 3000, 'switch done');
      assert((await T.page.evaluate(() => location.search)).includes('world=water'), 'URL ?world=water');
      assert((await T.page.evaluate(() => localStorage.getItem('bonnet.world.bonnet'))) === 'water', 'localStorage');
      assert((await T.page.getAttribute('[data-w=water]', 'aria-pressed')) === 'true', 'pressed state');
      await T.page.click('[data-w=light]');
      s = await T.until((x) => x.world === 'light', 2000, 'light');
      assert(s.index === 2, 'product kept going back');
      if (hasGl) await T.until((x) => x.sw === null, 3000, 'switch done 2');
      assert((await T.page.evaluate(() => location.search)).includes('world=light'), 'URL ?world=light');
      assert(T.errors.length === 0, 'console errors: ' + T.errors.join(' | '));
    }),
  );

  await check('world switch is the ~1.1 s signature transition, can be reversed mid-way, and works with the keyboard', () =>
    withApp('world=light', async (T) => {
      if (!hasGl) return 'skip';
      await T.rest();
      const t0 = Date.now();
      await T.page.click('[data-w=water]');
      const mid = await T.until((x) => x.sw !== null && x.sw > 0.05, 1000, 'switch running');
      assert(mid.world === 'water', 'target world');
      await T.until((x) => x.sw === null, 2500, 'switch done');
      const ms = Date.now() - t0;
      assert(ms > 900 && ms < 2200, `transition duration ${ms} ms`);
      // reverse mid-way
      await T.page.click('[data-w=light]');
      await sleep(250);
      await T.page.click('[data-w=water]');
      await T.until((x) => x.sw === null, 2500, 'reversed switch done');
      assert((await T.st()).world === 'water', 'ended on water');
      // keyboard: focus the Light button, activate with Space
      await T.page.focus('[data-w=light]');
      await T.page.keyboard.press('Space');
      await T.until((x) => x.world === 'light', 1500, 'keyboard switch');
      assert(T.errors.length === 0, 'console errors: ' + T.errors.join(' | '));
    }),
  );

  await check('default world per catalogue; ?world= wins; a switch click is remembered per catalogue (a ?world= visit is not)', () =>
    withApp('', async (T) => {
      const page = T.page;
      const go = async (q) => {
        await page.goto('about:blank');
        await page.goto(`${BASE}?debug${q}`);
        await page.waitForFunction(() => window.__bonnet && window.__bonnet.gl !== 'boot');
        return T.st();
      };
      assert((await go('')).world === 'light', 'bonnet defaults to light');
      assert((await go('&set=bonnet')).world === 'light', 'set=bonnet defaults to light');
      assert((await go('&set=mixed')).world === 'water', 'set=mixed defaults to water');
      assert((await go('&set=mixed&world=light')).world === 'light', 'explicit ?world= overrides the default');
      assert((await go('&set=mixed')).world === 'water', 'a ?world= visit is not remembered');
      // a real choice on the mixed catalogue is remembered there only
      await page.click('[data-w=light]');
      assert((await go('&set=mixed')).world === 'light', 'remembered for mixed');
      assert((await go('&set=bonnet')).world === 'light', 'bonnet untouched (default)');
      await go('&set=bonnet');
      await page.click('[data-w=water]');
      assert((await go('&set=bonnet')).world === 'water', 'remembered for bonnet');
      assert((await go('&set=mixed')).world === 'light', 'mixed keeps its own choice');
      assert((await go('&set=mixed&world=water')).world === 'water', 'param over storage');
      // the catalogue links do not force the current world on the other catalogue
      assert(!(await page.getAttribute('[data-set=bonnet]', 'href')).includes('world='), 'catalogue link carries no world');
    }),
  );

  await check('deep link #moss opens the detail at once; close goes to browse in the chosen world', () =>
    withApp('world=water', async (T) => {
      await T.page.goto('about:blank');
      await T.page.goto(`${BASE}?debug&world=water#moss`);
      await T.page.waitForFunction(() => window.__bonnet);
      const s = await T.st();
      assert(s.page === 'detail' && s.index === 1, `deep link state ${JSON.stringify(s)}`);
      assert(await T.page.isVisible('#dtitle'), 'detail visible');
      await T.page.click('#close');
      const b = await T.until((x) => x.page === 'browse', 5000, 'browse');
      assert(b.world === 'water', 'world kept');
      assert(T.errors.length === 0, 'console errors: ' + T.errors.join(' | '));
    }),
  );

  for (const set of ['bonnet', 'mixed']) {
    for (const world of ['light', 'water']) {
      await check(`catalogue ${set} x ${world}: every product opens and closes`, () =>
        withApp(`set=${set}&world=${world}`, async (T) => {
          await T.rest();
          const n = await T.page.locator('[data-set]').count();
          assert(n === 2, 'catalogue links');
          for (const dir of ['#prev', '#next', '#next']) {
            await T.page.click(dir);
            await T.rest(5000);
            await T.tapOpen();
            await T.until((x) => x.page === 'detail', 8000, 'detail');
            await T.page.click('#close');
            await T.until((x) => x.page === 'browse', 8000, 'browse');
          }
          assert(T.errors.length === 0, 'console errors: ' + T.errors.join(' | '));
        }),
      );
    }
  }

  for (const [from, to] of [['light', 'water'], ['water', 'light']]) {
    await check(`signature switch ${from} -> ${to}: same product throughout, ~1.1 s, reverse mid-way returns, no errors`, () =>
      withApp(`world=${from}`, async (T) => {
        if (!hasGl) return 'skip';
        await T.rest();
        await T.page.click('#next');
        await T.rest();
        const t0 = Date.now();
        await T.page.click(`[data-w=${to}]`);
        const kind = `${from[0]}2${to[0]}`;
        let s = await T.until((x) => x.sw !== null && x.sw > 0.05, 1000, 'running');
        assert(s.swKind === kind, `kind ${s.swKind}`);
        const seen = new Set();
        while ((s = await T.st()).sw !== null) {
          seen.add(s.index);
          await sleep(40);
        }
        const ms = Date.now() - t0;
        assert(seen.size === 1 && [...seen][0] === 2, 'product stays the same during the whole transition');
        assert(ms > 900 && ms < 2200, `duration ${ms} ms`);
        assert(s.world === to && s.index === 2, 'ended on the target world, same product');
        // reverse in the middle: ends on the original world
        await T.page.click(`[data-w=${from}]`);
        await T.until((x) => x.sw !== null && x.sw > 0.3 && x.sw < 0.7, 1500, 'middle');
        await T.page.click(`[data-w=${to}]`);
        await sleep(150);
        await T.page.click(`[data-w=${from}]`);
        s = await T.until((x) => x.sw === null, 3000, 'settled after reversals');
        assert(s.world === from && s.index === 2, `reversals end on ${from}, same product (${s.world})`);
        assert(T.errors.length === 0, 'console errors: ' + T.errors.join(' | '));
      }),
    );
  }

  // ---- detail: photo slide and drag-down-to-close ------------------------------------------------
  const openDetailFor = async (T) => {
    await T.rest();
    await T.tapOpen();
    await T.until((x) => x.page === 'detail', 8000, 'detail');
    await sleep(120);
    return T.st();
  };
  for (const world of ['light', 'water']) {
    await check(`${world}: detail photo slide sticks to the finger (<= 2 px), snaps on release, reverts when short`, () =>
      withApp(`world=${world}`, async (T) => {
        if (!touch) return 'skip';
        await openDetailFor(T);
        const hr = (await T.st()).heroRect;
        const x0 = hr.x + hr.w / 2 + 40, y = hr.y + hr.h / 2;
        await T.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
        const worst = [];
        for (const dx of [-3, -7, -14, -26, -44, -70, -100, -128]) {
          await sleep(22);
          await T.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + dx, y: y + 1 }] });
          await sleep(35);
          const d = (await T.st()).det;
          worst.push(Math.abs(d.curX - dx));
        }
        const mid = (await T.st()).det;
        assert(mid.incX !== null && Math.abs(mid.incX - (mid.curX + hr.w)) <= 2, 'the next photo is coupled to the current one');
        await T.lift();
        await sleep(900);
        let d = (await T.st()).det;
        assert(Math.max(...worst) <= 2, `tracking error px: ${worst.map((v) => v.toFixed(2)).join(',')}`);
        assert(d.cur === 1 && d.x === 0 && !d.anim, `snapped to the next photo (cur ${d.cur})`);
        assert((await T.st()).page === 'detail', 'still on the detail');
        // short and slow -> reverts
        await T.drag(x0, y, Array.from({ length: 6 }, (_, i) => [-Math.round((30 * (i + 1)) / 6), 0]), { dt: 40 });
        await sleep(300);
        d = (await T.st()).det;
        await sleep(500);
        d = (await T.st()).det;
        assert(d.cur === 1 && d.x === 0, `short slow drag reverts (cur ${d.cur})`);
        // buttons, dots and keys use the same path
        await T.page.click('#anext');
        await sleep(700);
        assert((await T.st()).det.cur === 2, 'arrow button');
        await T.page.click('.dot[data-a="0"]');
        await sleep(700);
        assert((await T.st()).det.cur === 0, 'dot');
        await T.page.keyboard.press('ArrowLeft');
        await sleep(700);
        assert((await T.st()).det.cur === 3, 'key (wraps)');
        assert(T.errors.length === 0, 'console errors: ' + T.errors.join(' | '));
      }),
    );

    await check(`${world}: drag-down from the hero scrubs the close: partial snaps back, long drag / flick closes, up does nothing`, () =>
      withApp(`world=${world}`, async (T) => {
        if (!hasGl) return 'skip';
        await openDetailFor(T);
        const hr = (await T.st()).heroRect;
        const x0 = hr.x + hr.w / 2, y = hr.y + 80;
        // upward on the hero: nothing at all
        await T.drag(x0, y, [[0, -20], [0, -50], [0, -90]], { dt: 16 });
        await sleep(200);
        let s = await T.st();
        assert(s.page === 'detail' && s.scrollY === 0 && !s.scrubbing, 'upward drag on the hero does nothing');
        // partial, slow, held -> snaps back open
        await T.drag(x0, y, Array.from({ length: 8 }, (_, i) => [Math.round((i + 1) * 1.5), Math.round((70 * (i + 1)) / 8)]), { dt: 40, release: false });
        await sleep(250);
        s = await T.st();
        assert(s.scrubbing && s.page === 'closing', 'scrubbing while the finger is down');
        assert(s.heroRect.y > hr.y + 40 && s.heroRect.w < hr.w - 4, `hero follows the finger and shrinks (y ${s.heroRect.y.toFixed(1)} vs ${hr.y.toFixed(1)}, w ${s.heroRect.w.toFixed(1)})`);
        await T.lift();
        s = await T.until((x) => x.page === 'detail', 8000, 'snapped back open');
        assert(s.scrollY === 0 && !s.scrubbing, 'back on the detail');
        await sleep(300);
        // long drag -> closes
        await T.drag(x0, y, Array.from({ length: 10 }, (_, i) => [0, Math.round((260 * (i + 1)) / 10)]), { dt: 30 });
        s = await T.until((x) => x.page === 'browse', 8000, 'closed by a long drag');
        assert(s.index === 1 && s.world === world, 'same product and world');
        assert((await T.page.evaluate(() => location.hash)) === '', 'hash cleared');
        // flick -> closes
        await T.rest();
        await T.tapOpen();
        await T.until((x) => x.page === 'detail', 8000, 'detail again');
        await sleep(120);
        await T.drag(x0, y, [[0, 14], [0, 40], [0, 80], [0, 130]], { dt: 8 });
        await T.until((x) => x.page === 'browse', 8000, 'closed by a flick');
        assert(T.errors.length === 0, 'console errors: ' + T.errors.join(' | '));
      }),
    );

    await check(`${world}: the body text area scrolls natively and never closes; a drag down on a scrolled hero does not close`, () =>
      withApp(`world=${world}`, async (T) => {
        if (!touch) return 'skip';
        await openDetailFor(T);
        // vertical swipe starting on the body text (below the hero), downward and upward
        await T.drag(195, 700, [[0, -40], [0, -120], [0, -260], [0, -420]], { dt: 16 });
        await sleep(400);
        let s = await T.st();
        assert(s.scrollY > 150 && s.page === 'detail', `body scrolls natively (scrollY ${s.scrollY})`);
        await T.drag(195, 300, [[0, 30], [0, 100], [0, 220], [0, 400]], { dt: 16 });
        await sleep(500);
        s = await T.st();
        assert(s.page === 'detail', 'a downward swipe on the body never closes');
        await T.page.evaluate(() => scrollTo(0, 0));
        await sleep(200);
        // a partly scrolled hero: the drag scrolls instead (the hero is a scroll start area again), still no close
        await T.page.evaluate(() => scrollTo(0, 60));
        await sleep(200);
        await T.drag(195, 300, [[0, 40], [0, 120], [0, 240]], { dt: 16 });
        await sleep(400);
        s = await T.st();
        assert(s.page === 'detail' && !s.scrubbing, 'no close from a scrolled hero');
        assert(T.errors.length === 0, 'console errors: ' + T.errors.join(' | '));
      }),
    );
  }

  await check('reduced motion: no GL, DOM fallback, buttons + open/close work instantly in both worlds', () =>
    withApp('world=light', async (T) => {
      const s = await T.st();
      assert(s.gl === 'off', `gl off (${s.gl})`);
      assert(await T.page.isVisible('.fbc img'), 'fallback image visible');
      await T.page.click('#next');
      assert((await T.st()).index === 2, 'next');
      await T.page.click('[data-w=water]');
      assert((await T.st()).world === 'water', 'switch');
      await T.page.click('#open');
      let b = await T.st();
      assert(b.page === 'detail', 'instant detail');
      assert(await T.page.isVisible('#dtitle'), 'title');
      await T.page.click('#close');
      b = await T.st();
      assert(b.page === 'browse' && b.index === 2 && b.world === 'water', 'instant close');
      assert(T.errors.length === 0, 'console errors: ' + T.errors.join(' | '));
    }, { reducedMotion: 'reduce' }),
  );

  await check('no WebGL: DOM fallback keeps navigation, Back and scrolling working', () =>
    withApp('nogl', async (T) => {
      const s = await T.st();
      assert(s.gl === 'off', 'gl off');
      await T.page.click('#next');
      await T.page.click('#open');
      await T.until((x) => x.page === 'detail', 2000, 'detail');
      await T.page.goBack();
      await T.until((x) => x.page === 'browse', 2000, 'back');
      assert(T.errors.length === 0, 'console errors: ' + T.errors.join(' | '));
    }),
  );

  await check('context loss falls back to the DOM and navigation keeps working', () =>
    withApp('world=water', async (T) => {
      if (!hasGl) return 'skip';
      await T.rest();
      await T.page.evaluate(() => document.getElementById('gl').getContext('webgl2').getExtension('WEBGL_lose_context')?.loseContext());
      await T.until((x) => x.gl === 'off', 3000, 'fallback after context loss');
      await T.page.click('#next');
      assert((await T.st()).index === 2, 'next after loss');
      await T.page.click('#open');
      await T.until((x) => x.page === 'detail', 2000, 'detail after loss');
      await T.page.click('#close');
      await T.until((x) => x.page === 'browse', 2000, 'browse after loss');
    }),
  );

  await check('textures: every product uploaded once (<= 1 per frame), shared by both worlds', () =>
    withApp('world=light', async (T) => {
      if (!hasGl) return 'skip';
      await T.rest();
      await sleep(1500);
      const a = await T.st();
      assert(a.uploads === 5, `5 uploads for 5 products (${a.uploads})`);
      await T.page.click('[data-w=water]');
      await T.until((x) => x.sw === null && x.world === 'water', 3000, 'switched');
      await sleep(500);
      assert((await T.st()).uploads === 5, 'switching worlds uploads nothing again');
    }),
  );

  await browser.close();
}

console.log(`\n${total - failed - skipped}/${total} passed${skipped ? `, ${skipped} skipped` : ''}${failed ? `, ${failed} FAILED` : ''}`);
stop();
process.exit(failed ? 1 : 0);
