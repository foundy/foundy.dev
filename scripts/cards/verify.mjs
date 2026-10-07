// Phase 5 verification: work cards, preview sheet, pull-down close, card Inspect.
// usage: node scripts/cards/verify.mjs [baseUrl=http://127.0.0.1:4402] [browser=chromium|webkit|firefox]
// Run against `npm run build && npm run preview`. One JSON line per check; exits 1 if any fails.
// Touch drags use CDP (Chromium only); WebKit/Firefox get mouse drags and touchscreen taps.
import { chromium, webkit, firefox } from 'playwright';

const [base = 'http://127.0.0.1:4402', br = 'chromium'] = process.argv.slice(2);
const T = { chromium, webkit, firefox }[br];
const browser = await T.launch(br === 'chromium' && process.env.CHANNEL ? { channel: process.env.CHANNEL } : {});
const results = [];
const check = (name, ok, extra = {}) => {
  results.push({ name, ok });
  console.log(JSON.stringify({ browser: br, name, ok, ...extra }));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SLUG = 'card-study';

async function open(vp, query = '', extra = {}) {
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
  await page.goto(`${base}/${query}`);
  if (extra.javaScriptEnabled !== false) await page.evaluate(() => document.fonts.ready); // evaluate hangs in Firefox without JS
  return { ctx, page, errors, mobile, reqs };
}

const state = (page) => page.evaluate(() => document.documentElement.dataset.cardsState ?? 'none');
async function waitState(page, want, timeout = 4000) {
  try {
    await page.waitForFunction((w) => document.documentElement.dataset.cardsState === w, want, { timeout });
    return true;
  } catch {
    return false;
  }
}
const hash = (page) => page.evaluate(() => location.hash);
const trigger = (page) => page.locator(`[data-card="${SLUG}"] [data-card-title]`);
const scroller = (page) => page.locator('.sheet-scroll');

async function cardActivate(page, mobile) {
  const t = trigger(page);
  await t.scrollIntoViewIfNeeded();
  if (mobile) await t.tap();
  else await t.click();
}
async function openSheet(page, mobile) {
  if (['idle', 'none'].includes(await state(page))) await cardActivate(page, mobile);
  return waitState(page, 'open');
}

/** everything that must agree once things have settled */
async function invariants(page) {
  return page.evaluate((slug) => {
    const st = document.documentElement.dataset.cardsState;
    const dlg = document.getElementById('work-sheet');
    const t = document.querySelector(`[data-card="${slug}"] [data-card-title]`);
    const kids = Array.from(document.body.children).filter((e) => e.id !== 'cards-layer' && e.tagName !== 'SCRIPT');
    const inert = kids.every((e) => e.hasAttribute('inert'));
    const none = kids.every((e) => !e.hasAttribute('inert'));
    const visual = document.querySelector(`[data-card="${slug}"] .visual`);
    const wrapT = document.querySelector('.sheet')?.style.transform ?? '';
    const base = { st, hidden: dlg.hidden, expanded: t.getAttribute('aria-expanded'), hash: location.hash, cardsOpen: document.documentElement.classList.contains('cards-open'), wrapT };
    if (st === 'idle')
      return { ...base, ok: dlg.hidden && none && !base.cardsOpen && base.expanded === 'false' && base.hash === '' && getComputedStyle(visual).visibility === 'visible' && !document.querySelector('.sh-ghost') };
    if (st === 'open')
      return { ...base, ok: !dlg.hidden && inert && base.cardsOpen && base.expanded === 'true' && base.hash === `#work/${slug}` && wrapT === '' };
    return { ...base, ok: false };
  }, SLUG);
}

/* ---- input helpers ----
   Chromium: CDP input with explicit timestamps, so release velocity is exact and independent of test-runner latency.
   WebKit / Firefox: real mouse events paced in real time (touch drags are not available there). */
const rep = (n, dy, dt) => Array.from({ length: n }, () => [dy, dt]);
const PROFILES = {
  slow: rep(64, 6, 16), // ~380 px over ~1 s
  flick: [...rep(2, 6, 8), ...rep(4, 30, 6)], // ~130 px, ~5 px/ms at release
  small: rep(10, 5, 16), // 50 px, slow
};
const REAL_FLICK = rep(8, 28, 0); // WebKit/Firefox: as fast as the runner can send, 224 px
async function cdpDrag(cdp, touch, x, y, moves, hold = false) {
  let t = Date.now() / 1000;
  let cy = y;
  const send = (type, yy, extra = {}) =>
    touch
      ? cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: yy }], timestamp: t })
      : cdp.send('Input.dispatchMouseEvent', { type, x, y: yy, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, timestamp: t, ...extra });
  await send(touch ? 'touchStart' : 'mousePressed', cy);
  for (const [dy, dt] of moves) {
    cy += dy;
    t += dt / 1000;
    await send(touch ? 'touchMove' : 'mouseMoved', cy);
  }
  if (!hold) await send(touch ? 'touchEnd' : 'mouseReleased', cy);
}
async function realMouseDrag(page, x, y, moves) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  let cy = y;
  for (const [dy, wait] of moves) {
    cy += dy;
    await page.mouse.move(x, cy);
    if (wait) await sleep(wait);
  }
  await page.mouse.up();
}
const mouseDrag = realMouseDrag;

async function heroPoint(page) {
  const b = await page.locator('.sheet .sh-hero svg').boundingBox();
  return { x: b.x + b.width * 0.5, y: b.y + b.height * 0.5 };
}

for (const vp of [
  { w: 1440, h: 900 },
  { w: 390, h: 844 },
]) {
  const tag = `${vp.w}x${vp.h}`;
  const mobile = vp.w < 600;
  const useTouch = mobile && br === 'chromium';

  /* ---------- 1. open / close routes, a11y, focus, inert, hash ---------- */
  {
    const { ctx, page, errors, reqs } = await open(vp, '?hud=1');
    await page.waitForTimeout(500);
    const t = trigger(page);
    check(`${tag} card title is a link to the case study (progressive enhancement)`, (await t.getAttribute('href')) === `/work/${SLUG}` && (await page.locator(`[data-card="${SLUG}"] .more`).getAttribute('href')) === `/work/${SLUG}`);
    check(`${tag} trigger: aria-expanded=false, aria-controls=work-sheet, aria-haspopup=dialog`, (await t.getAttribute('aria-expanded')) === 'false' && (await t.getAttribute('aria-controls')) === 'work-sheet' && (await t.getAttribute('aria-haspopup')) === 'dialog');
    const before = await page.evaluate(() => document.querySelector('main').getBoundingClientRect().left);

    check(`${tag} open by ${mobile ? 'tap' : 'click'}`, await openSheet(page, mobile));
    check(`${tag} cards chunk requested; Inspect chunk not requested by opening a sheet`, reqs.some((u) => /\/cards\.[^/]*\.js/.test(u)) && !reqs.some((u) => /runtime\.[^/]*\.js/.test(u)), { n: reqs.length });
    const a = await page.evaluate(() => {
      const d = document.getElementById('work-sheet');
      const lab = document.getElementById(d.getAttribute('aria-labelledby'));
      return {
        role: d.getAttribute('role'),
        modal: d.getAttribute('aria-modal'),
        title: lab?.textContent.trim(),
        focusIn: d.contains(document.activeElement),
        inertMain: document.querySelector('main').hasAttribute('inert'),
        inertHeader: document.querySelector('header').hasAttribute('inert'),
        inertFooter: document.querySelector('footer').hasAttribute('inert'),
        locked: getComputedStyle(document.documentElement).overflow === 'hidden',
        closeVisible: !!document.querySelector('[data-sheet-close]')?.getBoundingClientRect().width,
        hidden: getComputedStyle(document.querySelector('[data-card="card-study"] .visual')).visibility,
        left: document.querySelector('main').getBoundingClientRect().left,
      };
    });
    check(`${tag} dialog role/aria-modal/labelled by the title`, a.role === 'dialog' && a.modal === 'true' && /Card Interaction Study/.test(a.title ?? ''), a);
    check(`${tag} focus moved into the sheet`, a.focusIn);
    check(`${tag} background inert (header, main, footer)`, a.inertMain && a.inertHeader && a.inertFooter);
    check(`${tag} scroll locked, no layout shift`, a.locked && Math.abs(a.left - before) < 0.5, { before, after: a.left });
    check(`${tag} close button visible; card picture hidden under the sheet`, a.closeVisible && a.hidden === 'hidden');
    check(`${tag} url is #work/${SLUG}, aria-expanded=true`, (await hash(page)) === `#work/${SLUG}` && (await t.getAttribute('aria-expanded')) === 'true');
    check(`${tag} invariants (open)`, (await invariants(page)).ok, await invariants(page));

    // Escape
    await page.keyboard.press('Escape');
    check(`${tag} Escape closes`, await waitState(page, 'idle'));
    const f = await page.evaluate(() => document.activeElement?.getAttribute('data-card-title'));
    check(`${tag} focus restored to the card title`, f !== null);
    await page.waitForTimeout(300);
    check(`${tag} invariants (idle after Escape)`, (await invariants(page)).ok, await invariants(page));

    // close button
    await openSheet(page, mobile);
    await page.waitForTimeout(300);
    await page.locator('[data-sheet-close]').click();
    check(`${tag} close button closes`, await waitState(page, 'idle'));

    // scrim
    await openSheet(page, mobile);
    await page.waitForTimeout(400);
    const vpz = page.viewportSize();
    if (mobile) await page.touchscreen.tap(vpz.width / 2, 8);
    else await page.mouse.click(8, vpz.height / 2);
    check(`${tag} scrim tap closes${mobile ? ' (strip above the sheet)' : ''}`, await waitState(page, 'idle'));
    await page.waitForTimeout(300);
    check(`${tag} scrim tap right after opening is ignored (ghost click guard)`, await (async () => {
      await cardActivate(page, mobile);
      await page.waitForTimeout(40);
      if (mobile) await page.touchscreen.tap(vpz.width / 2, 8);
      else await page.mouse.click(8, vpz.height / 2);
      return waitState(page, 'open');
    })());
    await page.keyboard.press('Escape');
    await waitState(page, 'idle');

    // Back / Forward
    await openSheet(page, mobile);
    await page.waitForTimeout(300);
    await page.goBack();
    check(`${tag} browser Back closes (hash gone)`, (await waitState(page, 'idle')) && (await hash(page)) === '');
    await page.goForward();
    check(`${tag} browser Forward reopens`, await waitState(page, 'open'));
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    check(`${tag} UI close after Forward pops the entry`, (await waitState(page, 'idle')) && (await (async () => { await page.waitForTimeout(400); return (await hash(page)) === ''; })()));
    check(`${tag} invariants (idle after history round trip)`, (await invariants(page)).ok, await invariants(page));

    // reversal: close during opening, reopen during closing
    await cardActivate(page, mobile);
    await page.waitForTimeout(90);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(70);
    await page.evaluate(() => document.querySelector('[data-card="card-study"] [data-card-title]').click());
    check(`${tag} reversal (open -> close -> open mid-flight) ends open`, await waitState(page, 'open'));
    await page.waitForTimeout(500);
    check(`${tag} invariants (after reversal)`, (await invariants(page)).ok, await invariants(page));
    await page.keyboard.press('Escape');
    await waitState(page, 'idle');
    await page.waitForTimeout(300);

    check(`${tag} no console errors`, errors.length === 0, { errors: errors.slice(0, 3) });
    await ctx.close();
  }

  /* ---------- 2. pull-down: slow, flick, small, scrolled ---------- */
  {
    const { ctx, page, errors } = await open(vp, '?hud=1');
    const cdp = br === 'chromium' ? await ctx.newCDPSession(page) : null;
    await page.waitForTimeout(500);
    const pull = async (profile, hold = false) => {
      const p = await heroPoint(page);
      if (cdp) await cdpDrag(cdp, useTouch, p.x, p.y, PROFILES[profile], hold);
      else await mouseDrag(page, p.x, p.y, profile === 'flick' ? REAL_FLICK : PROFILES[profile]);
    };
    const kind = useTouch ? 'touch' : 'mouse';

    await openSheet(page, mobile);
    await page.waitForTimeout(300);
    await pull('slow');
    check(`${tag} ${kind}: slow long pull closes`, await waitState(page, 'idle', 3000), { st: await state(page), log: (await page.evaluate(() => window.__cards.handle.log())).slice(-4), rec: await page.evaluate(() => window.__cards.handle.recording()?.decision) });
    check(`${tag} ${kind}: invariants after slow close`, (await invariants(page)).ok, await invariants(page));
    const rec1 = await page.evaluate(() => window.__cards?.handle.recording()?.decision);
    check(`${tag} ${kind}: recorded decision = close`, rec1?.close === true, { rec1 });

    await page.waitForTimeout(300);
    await openSheet(page, mobile);
    await page.waitForTimeout(300);
    await pull('flick');
    check(`${tag} ${kind}: short fast flick closes`, await waitState(page, 'idle', 3000));
    const rec2 = await page.evaluate(() => window.__cards?.handle.recording()?.decision);
    check(`${tag} ${kind}: flick decided by projection (distance < line, projected > line)`, rec2 && rec2.close && rec2.distance < rec2.threshold && rec2.projected > rec2.threshold, { rec2 });

    await page.waitForTimeout(300);
    await openSheet(page, mobile);
    await page.waitForTimeout(300);
    await pull('small');
    await page.waitForTimeout(900);
    check(`${tag} ${kind}: small slow drag snaps back open`, (await state(page)) === 'open' && (await invariants(page)).ok, await invariants(page));
    const rec3 = await page.evaluate(() => window.__cards?.handle.recording()?.decision);
    check(`${tag} ${kind}: recorded decision = stay`, rec3?.close === false, { rec3 });

    // a mouse drag that starts on text must not pull (text selection stays native)
    if (!useTouch) {
      const tb = await page.locator('.sheet .sh-summary').boundingBox();
      const logBefore = await page.evaluate(() => window.__cards.handle.log().length);
      await mouseDrag(page, tb.x + 20, tb.y + 10, rep(20, 12, 8));
      const sel = await page.evaluate(() => String(getSelection()).length);
      check(`${tag} mouse drag on text selects text, does not pull`, (await state(page)) === 'open' && sel > 0, { sel, newLog: await page.evaluate((n) => window.__cards.handle.log().slice(n), logBefore) });
      await page.evaluate(() => getSelection().removeAllRanges());
    }

    // scrolled content: a drag scrolls the content, it does not pull
    const scrollable = await scroller(page).evaluate((el) => el.scrollHeight - el.clientHeight);
    if (scrollable > 120) {
      await scroller(page).evaluate((el) => (el.scrollTop = 200));
      const logN = await page.evaluate(() => window.__cards.handle.log().length);
      let st;
      if (useTouch) {
        const p = await heroPoint(page);
        await cdpDrag(cdp, true, p.x, 420, rep(12, 12, 12));
        await page.waitForTimeout(500);
        st = await scroller(page).evaluate((el) => el.scrollTop);
      } else {
        // no touch here: a mouse drag over the scrolled sheet must not pull it
        const p = await heroPoint(page);
        await mouseDrag(page, p.x, 300, rep(10, 20, 8));
        await page.waitForTimeout(300);
        st = await scroller(page).evaluate((el) => el.scrollTop);
      }
      const newLog = await page.evaluate((n) => window.__cards.handle.log().slice(n), logN);
      check(`${tag} ${kind}: scrolled sheet: ${useTouch ? 'drag scrolls content' : 'drag does not pull'}, no pull`, (await state(page)) === 'open' && (useTouch ? st < 200 : st === 200) && !newLog.some((l) => /drag/.test(l)), { scrollTop: st, newLog });
      await scroller(page).evaluate((el) => (el.scrollTop = 0));
    } else check(`${tag} sheet content does not scroll here (scrolled-drag check skipped)`, true, { scrollable });

    // Escape with scrolled content: closes cleanly
    if (scrollable > 120) {
      await scroller(page).evaluate((el) => (el.scrollTop = 150));
      await page.keyboard.press('Escape');
      check(`${tag} Escape from a scrolled sheet closes cleanly`, (await waitState(page, 'idle')) && (await invariants(page)).ok);
    } else {
      await page.keyboard.press('Escape');
      await waitState(page, 'idle');
    }
    await page.waitForTimeout(200);

    // links still work: tap "Read the full case study"
    await openSheet(page, mobile);
    await page.waitForTimeout(300);
    const read = page.locator('[data-sheet-read]');
    await read.scrollIntoViewIfNeeded();
    if (mobile) await read.tap();
    else await read.click();
    await page.waitForURL(`**/work/${SLUG}`, { timeout: 5000 }).then(
      () => check(`${tag} "Read the full case study" navigates`, true),
      () => check(`${tag} "Read the full case study" navigates`, false, { url: page.url() }),
    );
    await page.goBack();
    await page.waitForTimeout(800);
    check(`${tag} Back from the case study returns to the open sheet`, (await state(page)) === 'open' && (await hash(page)) === `#work/${SLUG}`, { st: await state(page), h: await hash(page) });

    check(`${tag} no console errors`, errors.length === 0, { errors: errors.slice(0, 3) });
    await ctx.close();
  }

  /* ---------- 3. spam, direct load, reduced motion, no-JS ---------- */
  {
    const { ctx, page, errors } = await open(vp, '?hud=1');
    await page.waitForTimeout(500);
    const t = trigger(page);
    await t.scrollIntoViewIfNeeded();
    const b = await page.locator(`[data-card="${SLUG}"] .entry-visual`).boundingBox();
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    const t0 = Date.now();
    for (let i = 0; i < 20; i++) {
      if (mobile) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      await sleep(25);
    }
    const spent = Date.now() - t0;
    await page.waitForTimeout(1500);
    const inv = await invariants(page);
    check(`${tag} 20 taps in ${spent} ms end in a consistent state (${inv.st})`, inv.ok, inv);
    if (inv.st === 'open') {
      await page.keyboard.press('Escape');
      await waitState(page, 'idle');
      await page.waitForTimeout(500);
    }
    check(`${tag} after spam: still opens and closes normally`, (await openSheet(page, mobile)) && (await (async () => { await page.keyboard.press('Escape'); return waitState(page, 'idle'); })()));
    // spam on keyboard: Enter on the focused title, Escape, ...
    await t.focus();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Enter');
      await sleep(30);
      await page.keyboard.press('Escape');
      await sleep(30);
    }
    await page.waitForTimeout(1500);
    const inv2 = await invariants(page);
    check(`${tag} 12 Enter/Escape pairs end in a consistent state (${inv2.st})`, inv2.ok, inv2);
    check(`${tag} no console errors`, errors.length === 0, { errors: errors.slice(0, 3) });
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open(vp, `?hud=1#work/${SLUG}`);
    const ok = await waitState(page, 'open', 6000);
    const log = await page.evaluate(() => window.__cards?.handle.log());
    check(`${tag} direct load /#work/${SLUG} opens the sheet without animation`, ok && log?.length === 2 && /opening --settled--> open/.test(log[1]), { log });
    const ready = await page.evaluate(() => ({ t: document.querySelector('.sheet')?.style.transform, op: document.querySelector('.sheet')?.style.opacity }));
    check(`${tag} direct load: settled pose, no inline transform`, ready.t === '' && ready.op === '', ready);
    check(`${tag} direct load: hash kept, inert applied`, (await hash(page)) === `#work/${SLUG}` && (await page.evaluate(() => document.querySelector('main').hasAttribute('inert'))));
    await page.keyboard.press('Escape');
    check(`${tag} direct load: Escape closes and clears the hash`, (await waitState(page, 'idle')) && (await hash(page)) === '');
    check(`${tag} no console errors`, errors.length === 0, { errors: errors.slice(0, 3) });
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open(vp, '?hud=1', { reducedMotion: 'reduce' });
    await page.waitForTimeout(400);
    const t0 = Date.now();
    const ok = await openSheet(page, mobile);
    const dt = Date.now() - t0;
    check(`${tag} reduced motion: opens (${dt} ms incl. input)`, ok);
    const tr = await page.evaluate(() => ({ ghost: document.querySelector('.sh-ghost')?.hidden, t: document.querySelector('.sheet').style.transform }));
    check(`${tag} reduced motion: no travelling ghost, panel at rest`, tr.t === '' || /translate\(0\.00px,0\.00px\) scale\(1\.00000\)/.test(tr.t), tr);
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    check(`${tag} reduced motion: closes`, (await waitState(page, 'idle')) && (await (async () => { await page.waitForTimeout(300); return (await invariants(page)).ok; })()), await invariants(page));
    check(`${tag} no console errors`, errors.length === 0, { errors: errors.slice(0, 3) });
    await ctx.close();
  }
  {
    const { ctx, page } = await open(vp, '', { javaScriptEnabled: false });
    const a = page.locator(`[data-card="${SLUG}"] [data-card-title]`);
    check(`${tag} no-JS: card title is a plain link, dialog stays hidden`, (await a.getAttribute('href')) === `/work/${SLUG}` && (await page.locator('#work-sheet').isHidden()) && (await a.getAttribute('aria-expanded')) === null);
    await a.click();
    await page.waitForURL(`**/work/${SLUG}`, { timeout: 5000 }).then(
      () => check(`${tag} no-JS: link navigates to the case study`, true),
      () => check(`${tag} no-JS: link navigates to the case study`, false, { url: page.url() }),
    );
    await ctx.close();
  }

  /* ---------- 4. Inspect timeline ---------- */
  {
    const { ctx, page, errors } = await open(vp, '?hud=1');
    const cdp = br === 'chromium' ? await ctx.newCDPSession(page) : null;
    await page.waitForTimeout(500);
    const kind = useTouch ? 'touch' : 'mouse';
    const toggle = '.sheet-bar [data-inspect-toggle]';

    await openSheet(page, mobile);
    await page.waitForTimeout(300);
    await page.locator(toggle).click();
    await page.waitForSelector('[data-inspect-panel="cards"]', { timeout: 8000 }).then(
      () => check(`${tag} Inspect from inside the sheet activates the card inspectable`, true),
      () => check(`${tag} Inspect from inside the sheet activates the card inspectable`, false),
    );
    const empty = await page.locator('[data-inspect-panel="cards"] .inspect-empty').innerText().catch(() => '');
    check(`${tag} Inspect: invites a drag when nothing is recorded`, /pull the sheet down/i.test(empty), { empty: empty.slice(0, 60) });
    check(`${tag} Inspect: toggle in the sheet is pressed, sheet still operable`, (await page.locator(toggle).getAttribute('aria-pressed')) === 'true' && (await state(page)) === 'open');

    const p = await heroPoint(page);
    if (cdp) await cdpDrag(cdp, useTouch, p.x, p.y, PROFILES.flick);
    else await mouseDrag(page, p.x, p.y, REAL_FLICK);
    check(`${tag} ${kind}: flick closes the sheet`, await waitState(page, 'idle', 3000));
    await page.waitForSelector('[data-inspect-panel="cards"] .inspect-play', { timeout: 4000 }).then(
      () => check(`${tag} Inspect: timeline panel stays after the sheet closes and shows the recording`, true),
      () => check(`${tag} Inspect: timeline panel stays after the sheet closes and shows the recording`, false),
    );
    const sum = await page.locator('[data-inspect-panel="cards"] .inspect-summary').innerText();
    check(`${tag} Inspect: plain-English decision with numbers`, /You let go after \d+ px at [\d.]+ px\/ms\. Projected travel \d+ px is more than 35% of the sheet \(\d+ px\), so the sheet closed/.test(sum), { sum });
    const markers = await page.locator('[data-inspect-panel="cards"] .inspect-stop').allInnerTexts();
    check(`${tag} Inspect: markers press / drag / (close line) / release / verdict`, markers.length >= 4 && /Press/.test(markers[0]) && /Verdict/.test(markers.at(-1)), { markers });
    const ov = await page.evaluate(() => {
      const o = document.querySelector('[data-inspect-overlay]');
      return { shown: o.style.display, poly: o.querySelector('.ov-traj:not(.halo)')?.getAttribute('points')?.split(' ').length ?? 0, thr: !!o.querySelector('.ov-thr'), proj: !!o.querySelector('.ov-proj .ov-projline'), vec: !!o.querySelector('.ov-vec .ov-vecline') };
    });
    check(`${tag} Inspect: overlay shows trajectory, close line, velocity vector, projected ghost`, ov.shown === 'block' && ov.poly > 3 && ov.thr && ov.proj && ov.vec, ov);

    // sheet closed: replay lives in the framed stage, inside the viewport, with no overlapping labels
    const stage = await page.evaluate(() => {
      const o = document.querySelector('[data-inspect-overlay]');
      const b = o.getBoundingClientRect();
      const dock = document.querySelector('[data-inspect-dock]').getBoundingClientRect();
      const t = [...o.querySelectorAll('text')].filter((x) => x.textContent).map((x) => x.getBoundingClientRect());
      let overlaps = 0;
      for (let i = 0; i < t.length; i++)
        for (let j = i + 1; j < t.length; j++) {
          const a = t[i], c = t[j];
          if (a.left < c.right - 1 && a.right > c.left + 1 && a.top < c.bottom - 1 && a.bottom > c.top + 1) overlaps++;
        }
      return { stage: o.classList.contains('is-stage'), inView: b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= dock.top + 1, labels: t.length, overlaps, box: [Math.round(b.width), Math.round(b.height)] };
    });
    check(`${tag} Inspect: closed-sheet replay is a framed stage, in view, labels do not collide`, stage.stage && stage.inView && stage.overlaps === 0 && stage.labels >= 3, stage);

    // replay
    await page.locator('.inspect-play').click();
    await page.waitForTimeout(120);
    const mid = await page.locator('.inspect-range').inputValue();
    const polyMid = await page.evaluate(() => document.querySelector('.ov-traj:not(.halo)').getAttribute('points').split(' ').length);
    await page.waitForTimeout(700);
    const end = await page.locator('.inspect-range').inputValue();
    const polyEnd = await page.evaluate(() => document.querySelector('.ov-traj:not(.halo)').getAttribute('points').split(' ').length);
    const max = await page.locator('.inspect-range').getAttribute('max');
    check(`${tag} Inspect: replay runs through the recording`, Number(mid) < Number(max) && Number(end) === Number(max) && polyMid > 1, { mid, end, max, polyMid });
    // scrub to the start via the marker
    await page.locator('[data-inspect-panel="cards"] .inspect-stop').first().click();
    const polyStart = await page.evaluate(() => document.querySelector('.ov-traj:not(.halo)').getAttribute('points').split(' ').length);
    check(`${tag} Inspect: scrubbing to Press shortens the trajectory`, polyStart <= 3 && polyStart < polyEnd && Number(await page.locator('.inspect-range').inputValue()) === 0, { polyStart, polyEnd });
    const detail = await page.evaluate(() => (document.querySelector('[data-inspect-panel="cards"] details').open = true) && document.querySelector('[data-inspect-panel="cards"] .inspect-dl').innerText);
    check(`${tag} Inspect: developer details (constants, samples, estimator window)`, /80 ms/.test(detail) && /0\.35/.test(detail) && /samples/i.test(detail) && /90 ms/.test(detail), { detail: detail.slice(0, 120) });

    // context: reopen a sheet -> still cards; Inspect off -> overlay gone
    await cardActivate(page, mobile).catch(() => {});
    await page.keyboard.press('i');
    await page.waitForTimeout(300);
    check(`${tag} Inspect: "I" toggles off (overlay hidden, panel gone)`, (await page.evaluate(() => document.querySelector('[data-inspect-overlay]').style.display)) === 'none' && (await page.locator('.inspect-panel').count()) === 0);
    await page.keyboard.press('i');
    await page.waitForTimeout(300);
    check(`${tag} Inspect: "I" back on while a sheet is open picks the card inspectable`, (await page.locator('[data-inspect-panel="cards"]').count()) === 1 || (await state(page)) !== 'open', { st: await state(page) });
    await page.keyboard.press('Escape');
    await waitState(page, 'idle');
    await page.waitForTimeout(300);
    check(`${tag} Inspect: Escape closes the sheet first, Inspect stays on`, (await page.evaluate(() => document.body.dataset.inspect)) === 'on');
    check(`${tag} no console errors`, errors.length === 0, { errors: errors.slice(0, 3) });
    await ctx.close();
  }
  {
    // context switching hero <-> cards without a recording
    const { ctx, page, errors } = await open(vp, '?hud=1');
    await page.waitForTimeout(500);
    await page.locator('[data-inspect-toggle]').first().scrollIntoViewIfNeeded();
    await page.locator('[data-inspect-toggle]').first().click();
    await page.waitForSelector('[data-inspect-panel="hero"], .inspect-panel', { timeout: 8000 });
    const heroPanel = await page.locator('.inspect-panel').first().getAttribute('data-inspect-panel');
    check(`${tag} Inspect on at the page: hero inspectable`, heroPanel !== 'cards', { heroPanel });
    await cardActivate(page, mobile);
    check(`${tag} Inspect on, open a card: switches to the card inspectable`, (await page.waitForSelector('[data-inspect-panel="cards"]', { timeout: 6000 }).then(() => true, () => false)));
    await waitState(page, 'open');
    await page.keyboard.press('Escape');
    await waitState(page, 'idle');
    await page.waitForTimeout(400);
    const back = await page.locator('.inspect-panel').first().getAttribute('data-inspect-panel');
    check(`${tag} close without a recording: back to the hero inspectable`, back !== 'cards', { back });
    check(`${tag} no console errors`, errors.length === 0, { errors: errors.slice(0, 3) });
    await ctx.close();
  }
}

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(JSON.stringify({ browser: br, total: results.length, failed: bad.length }));
process.exit(bad.length ? 1 : 0);
