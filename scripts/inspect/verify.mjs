// Phase 4 verification for Inspect on the home hero.
// usage: node scripts/inspect/verify.mjs [baseUrl=http://127.0.0.1:4402] [browser=chromium|webkit|firefox]
// Run against `npm run build && npm run preview`. One JSON line per check; exits 1 if any fails.
import { chromium, webkit, firefox } from 'playwright';
import sharp from 'sharp';

const [base = 'http://127.0.0.1:4402', br = 'chromium'] = process.argv.slice(2);
const T = { chromium, webkit, firefox }[br];
const browser = await T.launch(br === 'chromium' && process.env.CHANNEL ? { channel: process.env.CHANNEL } : {});
const results = [];
const check = (name, ok, extra = {}) => {
  results.push({ name, ok });
  console.log(JSON.stringify({ browser: br, name, ok, ...extra }));
};

const STAGES = ['sdf', 'warp', 'flow', 'composite'];

async function open(vp, query, extra = {}) {
  const mobile = vp.w < 600;
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: mobile ? 2 : 1,
    ...(mobile ? { hasTouch: true, isMobile: br !== 'firefox' } : {}),
    ...extra,
  });
  const page = await ctx.newPage();
  const errors = [];
  const reqs = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => reqs.push(r.url()));
  await page.goto(`${base}/${query}`);
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page, errors, reqs };
}
const glDone = (page) => page.waitForFunction(() => document.querySelector('[data-hero-poster].gl-done'), null, { timeout: 25000 });
const stageShot = async (page) => {
  const png = await page.locator('[data-hero-poster] .stage').screenshot();
  return sharp(png).greyscale().raw().toBuffer();
};
const diff = (a, b) => {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
  return s / n;
};
const pressed = (page) => page.locator('[data-inspect-toggle]').getAttribute('aria-pressed');
const bodyState = (page) => page.evaluate(() => document.body.dataset.inspect);
const live = (page) => page.locator('.inspect-explain').innerText();
async function setStage(page, i) {
  const range = page.locator('.inspect-range');
  await range.evaluate((el) => el.focus({ preventScroll: true }));
  await page.keyboard.press('Home');
  for (let k = 0; k < i; k++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(600);
}

for (const vp of [
  { w: 1440, h: 900 },
  { w: 390, h: 844 },
]) {
  const tag = `${vp.w}x${vp.h}`;
  const mobile = vp.w < 600;

  /* ---- GL mode ---- */
  {
    const { ctx, page, errors, reqs } = await open(vp, '?hud=1&t=3&tier=high');
    await glDone(page);
    await page.waitForTimeout(400);
    const btn = page.locator('[data-inspect-toggle]');
    check(`${tag} toggle visible, aria-pressed=false, labelled "Inspect"`, (await btn.isVisible()) && (await pressed(page)) === 'false' && /Inspect/.test(await btn.innerText()));
    check(`${tag} inspect chunk NOT requested before activation`, !reqs.some((u) => /runtime\.[^/]*\.js/.test(u)), { n: reqs.length });
    check(`${tag} no stills requested before activation`, !reqs.some((u) => u.includes('/gl/stages/')));

    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await page.waitForSelector('.inspect-panel', { timeout: 8000 });
    check(`${tag} click -> pressed, data-inspect=on, panel`, (await pressed(page)) === 'true' && (await bodyState(page)) === 'on');
    check(`${tag} inspect chunk requested after activation`, reqs.some((u) => /runtime\.[^/]*\.js/.test(u)));
    check(`${tag} starts at stage 4 (Ink), explain text present`, /4 of 4/.test(await live(page)) && /ink/i.test(await live(page)), { text: (await live(page)).slice(0, 90) });

    // aria-live: exactly one region in the panel, and the details are outside it
    const al = await page.evaluate(() => ({
      regions: document.querySelectorAll('.inspect-panel [aria-live]').length,
      detailsInLive: !!document.querySelector('.inspect-details')?.closest('[aria-live]'),
      anyLiveInDl: !!document.querySelector('.inspect-dl [aria-live], .inspect-dl[aria-live]'),
    }));
    check(`${tag} exactly one aria-live region, details not inside it`, al.regions === 1 && !al.detailsInLive && !al.anyLiveInDl, al);

    // scrub through all four stages: rendered image differs
    const shots = [];
    const names = [];
    for (let i = 0; i < 4; i++) {
      await setStage(page, i);
      names.push((await live(page)).split('\n')[0]);
      shots.push(await stageShot(page));
    }
    const st = await page.evaluate(() => window.__hero.stats().stage);
    // after loop the last setStage(3) -> composite
    check(`${tag} hero.stage follows the slider`, st === 'composite', { st });
    let min = 1e9;
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) min = Math.min(min, diff(shots[i], shots[j]));
    check(`${tag} the four stages look different (min mean abs diff)`, min > 1.5, { min: +min.toFixed(2), names });

    // live region text changes on stage change
    await setStage(page, 1);
    check(`${tag} aria-live text updates on stage change`, /2 of 4/.test(await live(page)) && /Warp/.test(await live(page)));

    // prev / next buttons
    await page.locator('button[aria-label="Next stage"]').click();
    await page.waitForTimeout(300);
    const hs = await page.evaluate(() => window.__hero.stats().stage);
    check(`${tag} next button moves to flow`, hs === 'flow' && /3 of 4/.test(await live(page)), { hs });
    await page.locator('button[aria-label="Previous stage"]').click();
    await page.waitForTimeout(300);
    check(`${tag} prev button moves back to warp`, (await page.evaluate(() => window.__hero.stats().stage)) === 'warp');

    // details
    await setStage(page, 2);
    await page.locator('.inspect-details summary').click();
    await page.waitForTimeout(600);
    const rows = await page.locator('.inspect-dl > div').allInnerTexts();
    const txt = rows.join(' | ');
    check(`${tag} details show tier, sim grid, DPR, frame ms, formats, force`, /tier/i.test(txt) && /Sim grid/.test(txt) && /DPR/.test(txt) && /Frame time/.test(txt) && /RGBA16F/.test(txt) && /Pointer force/.test(txt), { rows: rows.length, txt: txt.slice(0, 260) });
    // throttled: count DOM mutations over 1s (<= ~5 refreshes)
    const muts = await page.evaluate(
      () =>
        new Promise((res) => {
          let n = 0;
          const stamp = new Set();
          const mo = new MutationObserver((l) => {
            for (const m of l) stamp.add(Math.round(performance.now() / 100));
            n += l.length;
          });
          mo.observe(document.querySelector('.inspect-dl'), { subtree: true, childList: true, characterData: true });
          setTimeout(() => (mo.disconnect(), res({ n, ticks: stamp.size })), 1000);
        }),
    );
    check(`${tag} details refresh <= 4/s`, muts.ticks <= 5, muts);

    // flow stage: dragging changes the image (arrows appear)
    if (!mobile) {
      await setStage(page, 2);
      const before = await stageShot(page);
      const c = await page.locator('.hero-gl').boundingBox();
      await page.mouse.move(c.x + c.width * 0.2, c.y + c.height * 0.4);
      await page.mouse.down();
      for (let i = 0; i <= 20; i++) {
        await page.mouse.move(c.x + c.width * (0.2 + 0.5 * (i / 20)), c.y + c.height * (0.4 + 0.1 * Math.sin(i / 3)));
        await page.waitForTimeout(14);
      }
      const during = await stageShot(page);
      const f = await page.evaluate(() => window.__hero.stats().force);
      await page.mouse.up();
      check(`${tag} flow: drag adds force and arrows (image changes)`, diff(before, during) > 0.3 && f > 0, { d: +diff(before, during).toFixed(2), force: f });
    }

    // keyboard: I toggles, ignored in input, Escape exits
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('i');
    await page.waitForTimeout(300);
    check(`${tag} "I" turns Inspect off`, (await pressed(page)) === 'false' && (await bodyState(page)) === 'off' && (await page.locator('.inspect-panel').count()) === 0);
    check(`${tag} off: hero back to composite`, (await page.evaluate(() => window.__hero.stats().stage)) === 'composite');
    await page.keyboard.press('i');
    await page.waitForSelector('.inspect-panel');
    check(`${tag} "I" turns Inspect on`, (await pressed(page)) === 'true');
    await page.evaluate(() => {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.id = 'test-input';
      document.body.append(inp);
      inp.focus();
    });
    await page.keyboard.type('iI');
    const v = await page.inputValue('#test-input');
    check(`${tag} "I" ignored while typing in an input`, v === 'iI' && (await pressed(page)) === 'true', { v });
    const ta = await page.evaluate(() => {
      const d = document.createElement('div');
      d.contentEditable = 'true';
      d.id = 'test-ce';
      document.body.append(d);
      d.focus();
    });
    await page.keyboard.type('i');
    check(`${tag} "I" ignored in contenteditable`, (await pressed(page)) === 'true');
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Control+i');
    await page.keyboard.press('Meta+i');
    check(`${tag} "I" with modifiers ignored`, (await pressed(page)) === 'true');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    check(`${tag} Escape exits`, (await pressed(page)) === 'false' && (await bodyState(page)) === 'off');
    check(`${tag} no console errors (GL mode)`, errors.length === 0, { errors: errors.slice(0, 3) });
    await ctx.close();
  }

  /* ---- window is clean without ?hud=1 ---- */
  {
    const { ctx, page } = await open(vp, '?t=3');
    await glDone(page);
    const w = await page.evaluate(() => Object.keys(window).filter((k) => /^__|hero|inspect/i.test(k)));
    check(`${tag} no globals exposed without ?hud=1`, w.length === 0, { w });
    await ctx.close();
  }

  /* ---- fallback modes: no GL, reduced motion ---- */
  for (const mode of ['gl=none', 'reduced']) {
    const { ctx, page, errors, reqs } = await open(vp, mode === 'gl=none' ? '?gl=none' : '', mode === 'reduced' ? { reducedMotion: 'reduce' } : {});
    await page.waitForTimeout(1500);
    check(`${tag} [${mode}] no canvas`, (await page.locator('.hero-gl').count()) === 0);
    const btn = page.locator('[data-inspect-toggle]');
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await page.waitForSelector('.inspect-panel', { timeout: 8000 });
    await page.waitForSelector('.inspect-still.in', { timeout: 8000 });
    const shots = [];
    const srcs = [];
    for (let i = 0; i < 4; i++) {
      await setStage(page, i);
      srcs.push(await page.evaluate(() => [...document.querySelectorAll('.inspect-still')].at(-1)?.getAttribute('src')));
      shots.push(await stageShot(page));
    }
    const loaded = await page.evaluate(() => [...document.querySelectorAll('.inspect-still')].every((i) => i.complete && i.naturalWidth > 0));
    check(`${tag} [${mode}] uses static images, all four loaded`, srcs.every((s, i) => s?.includes(`/gl/stages/${STAGES[i]}`)) && loaded && reqs.some((u) => u.includes('/gl/stages/sdf')), { srcs: srcs.map((s) => s?.split('/').pop()) });
    let min = 1e9;
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) min = Math.min(min, diff(shots[i], shots[j]));
    check(`${tag} [${mode}] stages differ in the fallback`, min > 1.5, { min: +min.toFixed(2) });
    check(`${tag} [${mode}] still count after scrubbing stays 1 (old ones removed)`, (await page.locator('.inspect-still').count()) <= 1);
    if (mode === 'reduced') {
      const tr = await page.evaluate(() => getComputedStyle(document.querySelector('.inspect-still')).transitionDuration);
      check(`${tag} [reduced] no transition between stages`, parseFloat(tr) < 0.001, { tr });
    }
    check(`${tag} [${mode}] explain text present`, /Ink/.test(await live(page)));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check(`${tag} [${mode}] exit removes still`, (await page.locator('.inspect-still').count()) === 0);
    check(`${tag} [${mode}] no console errors`, errors.length === 0, { errors: errors.slice(0, 3) });
    await ctx.close();
  }
}

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n${br}: ${results.length - bad.length}/${results.length} passed`);
if (bad.length) {
  console.log('FAILED:', bad.map((b) => b.name).join('\n  '));
  process.exit(1);
}
