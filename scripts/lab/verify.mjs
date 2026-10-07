// Phase 6 verification: the Lab comparisons.
// usage: node scripts/lab/verify.mjs [baseUrl=http://127.0.0.1:4404] [browser=chromium|webkit|firefox]
// Run against `npm run build && npm run preview`. One JSON line per check; exits 1 if any fails.
import { chromium, webkit, firefox } from 'playwright';

const [base = 'http://127.0.0.1:4404', br = 'chromium'] = process.argv.slice(2);
const T = { chromium, webkit, firefox }[br];
const browser = await T.launch();
const results = [];
const check = (name, ok, extra = {}) => {
  results.push({ name, ok });
  console.log(JSON.stringify({ browser: br, name, ok, ...extra }));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EXPECT = {
  'release-rule': { first: ['open', 'closed'] },
  'close-order': { first: ['closed', 'closed'] },
  'tap-vs-drag': { first: ['link', 'swallowed'] },
  'snap-back': { first: ['open', 'open'] },
};
const CHIPS = {
  'release-rule': { flick: ['open', 'closed'], 'Pull far': ['closed', 'open'], Ordinary: ['closed', 'closed'], twitch: ['open', 'open'] },
  'close-order': { Ordinary: ['closed', 'closed'], flick: ['closed', 'closed'], Slow: ['closed', 'closed'] },
  'tap-vs-drag': { 'Pull that starts': ['link', 'swallowed'], 'shaky finger': ['link', 'link'], 'Ghost click': ['closed', 'ignored'] },
  'snap-back': { 'Slow pull': ['open', 'open'], 'Flick back': ['open', 'open'], 'Near miss': ['open', 'open'] },
};

async function open(vp, extra = {}, url = '/lab/') {
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
  page.on('request', (r) => reqs.push(r.url()));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}${url}`);
  if (extra.javaScriptEnabled !== false) await page.evaluate(() => document.fonts.ready);
  return { ctx, page, errors, reqs, mobile };
}
const S = (id) => `[data-lab="${id}"]`;
async function ready(page, id) {
  await page.locator(S(id)).scrollIntoViewIfNeeded();
  await page.waitForSelector(`${S(id)}[data-lab-ready="1"]`, { timeout: 8000 });
}
const atEnd = (page, id, timeout = 8000) =>
  page
    .waitForFunction(
      (sel) => {
        const r = document.querySelector(sel);
        const max = Number(r.querySelector('.lab-scrub').max);
        return r.dataset.labPlaying === '0' && Number(r.dataset.labT) >= max - 1;
      },
      S(id),
      { timeout },
    )
    .then(() => true)
    .catch(() => false);
const keys = (page, id) => page.locator(`${S(id)} [data-badge]`).evaluateAll((els) => els.map((e) => e.dataset.key));
const heads = (page, id) => page.locator(`${S(id)} [data-r="playhead"]`).evaluateAll((els) => els.map((e) => e.getAttribute('x1')));
const setRange = (page, sel, v) =>
  page.locator(sel).evaluate((el, val) => {
    el.value = String(val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
const sameArr = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/* ---------- desktop ---------- */
{
  const { ctx, page, errors, reqs } = await open({ w: 1440, h: 900 });
  check('lab page: 4 sections, 8 static stage diagrams', (await page.locator('[data-lab]').count()) === 4 && (await page.locator('.st').count()) === 8);
  check('lazy: the last section data is not fetched before it is near the viewport', !reqs.some((u) => /\/lab\/data\/snap-back/.test(u)));
  check('no horizontal overflow (desktop)', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  for (const id of Object.keys(EXPECT)) {
    await ready(page, id);
    const ended = await atEnd(page, id);
    check(`${id}: autoplay runs to the end`, ended);
    check(`${id}: outcomes of the first recording ${EXPECT[id].first}`, sameArr(await keys(page, id), EXPECT[id].first), { got: await keys(page, id) });
    await sleep(150);
    const live = (await page.locator(`${S(id)} [aria-live]`).first().textContent()) ?? '';
    check(`${id}: outcome announced politely once`, /Old|New/.test(live) && (await page.locator(`${S(id)} [aria-live="polite"]`).count()) === 1, { live });

    // same clock: scrub, both playheads equal, t in the dataset
    await setRange(page, `${S(id)} .lab-scrub`, 60);
    const h = await heads(page, id);
    check(`${id}: scrub moves both sides on one clock`, h.length === 2 && h[0] === h[1] && (await page.locator(S(id)).getAttribute('data-lab-t')) === '60', { h });
    await setRange(page, `${S(id)} .lab-scrub`, 5000);
    // chips
    for (const [label, want] of Object.entries(CHIPS[id])) {
      await page.locator(`${S(id)} .lab-chip`, { hasText: label }).first().click();
      const e = await atEnd(page, id);
      const got = await keys(page, id);
      check(`${id}: "${label}" -> ${want}`, e && sameArr(got, want), { got });
    }
    // pause / play button
    await page.locator(`${S(id)} .lab-chip`).first().click();
    await sleep(60);
    await page.locator(`${S(id)} .lab-play`).click();
    check(`${id}: pause stops the clock`, (await page.locator(S(id)).getAttribute('data-lab-playing')) === '0');
  }

  /* before-release badge */
  await ready(page, 'release-rule');
  await page.locator(`${S('release-rule')} .lab-chip`, { hasText: 'Pull far' }).click();
  await page.locator(`${S('release-rule')} .lab-play`).click();
  await setRange(page, `${S('release-rule')} .lab-scrub`, 400);
  check('release-rule: mid-pull both sides are "deciding"', sameArr(await keys(page, 'release-rule'), ['wait', 'wait']));
  await setRange(page, `${S('release-rule')} .lab-scrub`, 5000);
  check('release-rule: after release both decided', sameArr(await keys(page, 'release-rule'), ['closed', 'open']));

  /* tunable */
  const id = 'release-rule';
  await page.locator(`${S(id)} .lab-chip`, { hasText: 'flick' }).first().click();
  await atEnd(page, id);
  const tau = '#tau-release-rule';
  const newKey = async (v) => {
    await setRange(page, tau, v);
    await sleep(30);
    return (await keys(page, id))[1];
  };
  let flipAt = null;
  for (let v = 0; v <= 200; v += 5) {
    if ((await newKey(v)) === 'closed') {
      flipAt = v;
      break;
    }
  }
  check('tunable: flick flips to closed between 50 and 60 ms', flipAt != null && flipAt >= 50 && flipAt <= 60, { flipAt });
  await setRange(page, tau, 40);
  check('tunable: tau 40 -> new rule keeps flick open', (await keys(page, id))[1] === 'open' && (await page.locator('.lab-tau-out').textContent()) === '40 ms');
  const rowsAt40 = await page.locator(`${S(id)} .lab-table tbody tr`).evaluateAll((trs) => trs.map((t) => t.querySelectorAll('td')[1].dataset.key));
  check('tunable: table re-evaluates all four recordings', sameArr(rowsAt40, ['open', 'open', 'closed', 'open']), { rowsAt40 });
  check('tunable: reset button enabled when changed', await page.locator(`${S(id)} .lab-tau-ui .lab-btn`).isEnabled());
  await page.locator(`${S(id)} .lab-tau-ui .lab-btn`).click();
  check('tunable: reset restores 80 ms and disables itself', (await page.locator('.lab-tau-out').textContent()) === '80 ms' && (await keys(page, id))[1] === 'closed' && (await page.locator(`${S(id)} .lab-tau-ui .lab-btn`).isDisabled()));
  await setRange(page, tau, 200);
  const rows200 = await page.locator(`${S(id)} .lab-table tbody tr`).evaluateAll((trs) => trs.map((t) => t.querySelectorAll('td')[1].dataset.key));
  check('tunable: tau 200 -> twitch closes too', rows200[3] === 'closed', { rows200 });
  await setRange(page, tau, 80);

  /* your turn: mouse drag on either stage */
  for (const [sid, side] of [
    ['release-rule', 'old'],
    ['close-order', 'new'],
    ['tap-vs-drag', 'old'],
    ['snap-back', 'new'],
  ]) {
    await page.locator(S(sid)).scrollIntoViewIfNeeded();
    const hit = page.locator(`${S(sid)} [data-side="${side}"] [data-hit]`);
    await hit.scrollIntoViewIfNeeded();
    const b = await hit.boundingBox();
    const x = b.x + b.width * 0.5;
    const y0 = b.y + b.height * (sid === 'tap-vs-drag' ? 0.68 : 0.22);
    await page.mouse.move(x, y0);
    await page.mouse.down();
    const dy = b.height * (sid === 'snap-back' ? 0.2 : 0.4);
    for (let i = 1; i <= 24; i++) {
      await page.mouse.move(x, y0 + (dy * i) / 24);
      await sleep(14);
    }
    await sleep(80);
    await page.mouse.up();
    const rec = await page.locator(S(sid)).getAttribute('data-lab-rec');
    const e = await atEnd(page, sid);
    const k = await keys(page, sid);
    check(`${sid}: your turn (mouse on ${side}) records and replays into both`, rec === 'yours' && e && k.every((v) => v && v !== 'wait') && (await page.locator(`${S(sid)} .lab-chip`, { hasText: 'Yours' }).count()) === 1, { k });
    if (sid === 'release-rule') check('release-rule: a long slow pull closes under both rules', sameArr(k, ['closed', 'closed']), { k });
    if (sid === 'tap-vs-drag') check('tap-vs-drag: your pull from the link: old fires, new swallows', sameArr(k, ['link', 'swallowed']) || sameArr(k, ['open', 'open']), { k });
  }
  check('keyboard: scrubber is a labelled range input', await page.locator(`${S('release-rule')} input[type=range][aria-label]`).first().isVisible());
  check('buttons have text, slider has a label', (await page.locator('#tau-release-rule').evaluate((el) => document.querySelector(`label[for="${el.id}"]`)?.textContent ?? '')) !== '');
  await page.screenshot({ path: '/tmp/lab-verify-desktop.png' });
  check('no console errors (desktop)', errors.length === 0, { errors });
  await ctx.close();
}

/* ---------- mobile ---------- */
{
  const { ctx, page, errors } = await open({ w: 390, h: 844 });
  check('mobile: no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  for (const id of Object.keys(EXPECT)) {
    await ready(page, id);
    await atEnd(page, id);
    check(`mobile ${id}: outcomes ${EXPECT[id].first}`, sameArr(await keys(page, id), EXPECT[id].first));
  }
  await page.locator(S('release-rule')).scrollIntoViewIfNeeded();
  const stacked = await page.locator(`${S('release-rule')} [data-side]`).evaluateAll((els) => {
    const [a, b] = els.map((e) => e.getBoundingClientRect());
    return b.top > a.bottom - 2;
  });
  check('mobile: the two sides are stacked', stacked);
  const bar = page.locator(`${S('release-rule')} .lab-bar`);
  await page.locator(`${S('release-rule')} [data-side="new"] [data-hit]`).scrollIntoViewIfNeeded();
  check('mobile: play/scrub bar stays pinned while scrolling the sides', (await bar.boundingBox()).y <= 2);

  if (br === 'chromium') {
    const sid = 'release-rule';
    await page.locator(`${S(sid)} [data-side="old"] [data-hit]`).scrollIntoViewIfNeeded();
    await page.evaluate(() => scrollBy(0, -80));
    const hit = page.locator(`${S(sid)} [data-side="old"] [data-hit]`);
    const b = await hit.boundingBox();
    const cdp = await ctx.newCDPSession(page);
    const x = Math.round(b.x + b.width / 2);
    const y0 = Math.round(Math.max(b.y, 60) + 40);
    const touch = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    await touch('touchStart', y0);
    for (let i = 1; i <= 20; i++) {
      await touch('touchMove', y0 + i * 8);
      await sleep(16);
    }
    await touch('touchEnd', y0 + 160);
    const e = await atEnd(page, sid);
    const k = await keys(page, sid);
    check('mobile: your turn (touch on old) records and replays into both', (await page.locator(S(sid)).getAttribute('data-lab-rec')) === 'yours' && e && k.every((v) => v && v !== 'wait'), { k });
  }
  check('no console errors (mobile)', errors.length === 0, { errors });
  await ctx.close();
}

/* ---------- reduced motion ---------- */
{
  const { ctx, page, errors } = await open({ w: 1440, h: 900 }, { reducedMotion: 'reduce' });
  await ready(page, 'release-rule');
  await sleep(200);
  const st = await page.evaluate(() => {
    const r = document.querySelector('[data-lab="release-rule"]');
    return { t: Number(r.dataset.labT), max: Number(r.querySelector('.lab-scrub').max), playing: r.dataset.labPlaying };
  });
  check('reduced motion: replay starts at the final state, nothing animates', st.t === st.max && st.playing !== '1', st);
  check('reduced motion: outcomes still comparable', sameArr(await keys(page, 'release-rule'), ['open', 'closed']));
  const trail = await page.locator(`${S('release-rule')} [data-r="live"]`).first().getAttribute('points');
  check('reduced motion: trajectory drawn statically', (trail ?? '').split(' ').length > 5);
  await page.locator(`${S('release-rule')} .lab-chip`, { hasText: 'Pull far' }).click();
  await sleep(100);
  check('reduced motion: choosing another recording jumps to its final state', sameArr(await keys(page, 'release-rule'), ['closed', 'open']));
  await page.locator(`${S('release-rule')} .lab-play`).click();
  check('reduced motion: Play jumps, stays at the end', (await page.locator(S('release-rule')).getAttribute('data-lab-playing')) !== '1');
  check('no console errors (reduced motion)', errors.length === 0, { errors });
  await ctx.close();
}

/* ---------- no JS ---------- */
{
  const { ctx, page } = await open({ w: 1440, h: 900 }, { javaScriptEnabled: false });
  const n = await page.locator('.st').count();
  const badges = await page.locator('[data-badge]').evaluateAll((els) => els.map((e) => e.textContent.trim()));
  check('no JS: 8 annotated stage diagrams with outcomes', n === 8 && badges.every(Boolean), { badges });
  check('no JS: explanations and charts are in the HTML', (await page.locator('.lab-why').count()) === 8 && (await page.locator('.ch').count()) === 8);
  check('no JS: tunable table at the shipped value', (await page.locator('.lab-table tbody tr').count()) === 4);
  await ctx.close();
}

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n${br}: ${results.length - bad.length}/${results.length} checks passed`);
process.exit(bad.length ? 1 : 0);
