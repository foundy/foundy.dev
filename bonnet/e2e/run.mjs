// End-to-end checks. usage: node e2e/run.mjs [baseUrl=http://127.0.0.1:5199/bonnet/] [chromium|webkit|firefox]
// Chromium runs a touch phone (390x844, CDP touch) and a desktop; WebKit/Firefox run the desktop with mouse drags.
// One JSON line per check; exits 1 if any fails.
import { cardRect, drag, launch, maxStep, newPage, sleep, startRecording, state, stopRecording, tapAt, waitMode } from './lib.mjs';

const [base = 'http://127.0.0.1:5199/bonnet/', br = 'chromium'] = process.argv.slice(2);
const browser = await launch(br);
const results = [];
const check = (name, ok, extra = {}) => {
  results.push({ name, ok });
  console.log(JSON.stringify({ browser: br, name, ok, ...extra }));
};
const near = (a, b, t) => Math.abs(a - b) <= t;

async function fresh(kind, hash = '', extra = {}) {
  const h = await newPage(browser, br, kind, extra);
  await h.page.goto(base + hash);
  await h.page.waitForFunction(() => window.__bonnet);
  await sleep(300);
  return h;
}
const center = async (h, i = 0) => {
  const r = await cardRect(h.page, i);
  return [r.x + r.w / 2, r.y + r.h / 2];
};
const settle = (ms = 900) => sleep(ms);

async function suite(kind) {
  const tag = kind;
  const touch = kind === 'mobile';
  /* ---------- structure / a11y ---------- */
  {
    const h = await fresh(kind);
    const s = await h.page.evaluate(() => ({
      carousel: document.querySelector('#deck').getAttribute('aria-roledescription'),
      label: document.querySelector('#deck').getAttribute('aria-label'),
      slides: [...document.querySelectorAll('.slide')].map((e) => e.getAttribute('aria-roledescription') + ':' + e.getAttribute('aria-label')),
      live: document.querySelector('#live').getAttribute('aria-live'),
      dialog: [document.querySelector('#sheet').getAttribute('role'), document.querySelector('#sheet').getAttribute('aria-modal')],
      viewport: document.querySelector('meta[name=viewport]').content,
      touchAction: getComputedStyle(document.querySelector('#stage')).touchAction,
      img: [...document.querySelectorAll('.slide img')].every((i) => i.decoding === 'async' && i.srcset.includes('480w')),
      tab: [...document.querySelectorAll('.hit')].map((b) => b.tabIndex),
      demo: document.body.innerText.includes('Demo'),
      footer: !!document.querySelector('a[href="https://foundy.dev"]'),
    }));
    check(`${tag} carousel semantics`, s.carousel === 'carousel' && s.label && s.slides.length === 5 && s.slides.every((x) => x.startsWith('slide:')) && s.live === 'polite', s);
    check(`${tag} dialog semantics + viewport allows zoom`, s.dialog.join() === 'dialog,true' && !/user-scalable|maximum-scale/.test(s.viewport), { viewport: s.viewport });
    check(`${tag} deck touch-action pan-y, 1x/2x webp, roving tabindex`, s.touchAction === 'pan-y' && s.img && s.tab.join() === '0,-1,-1,-1,-1');
    check(`${tag} demo label + footer link`, s.demo && s.footer);
    await h.ctx.close();
  }

  /* ---------- deck ---------- */
  {
    const h = await fresh(kind);
    const [cx, cy] = await center(h);
    const bg0 = await h.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await drag(h, [[cx, cy], [cx - 40, cy, 320]], { hold: 150 });
    await settle();
    let s = await state(h.page);
    check(`${tag} deck: short slow drag returns to the same card`, s.cur === 0 && near(s.pos, 0, 0.01), s);
    await drag(h, [[cx, cy], [cx - 150, cy, 500]], { hold: 150, onHold: async () => (s = await state(h.page)) });
    check(`${tag} deck: position follows the finger 1:1 mid-drag`, s.pos > 0.4 && s.pos < 1.2, { pos: s.pos });
    await settle();
    s = await state(h.page);
    check(`${tag} deck: long slow drag advances one card`, s.cur === 1 && near(s.pos, 1, 0.01), s);
    const bg1 = await h.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check(`${tag} deck: background tint follows the card`, bg0 !== bg1, { bg0, bg1 });
    await drag(h, [[cx, cy], [cx - 70, cy, 60]]);
    await settle();
    s = await state(h.page);
    check(`${tag} deck: short fast flick advances one card`, s.cur === 2, s);
    await drag(h, [[cx, cy], [cx - 260, cy, 60]]);
    await settle();
    s = await state(h.page);
    check(`${tag} deck: strong flick skips two, never more`, s.cur === 4, s);
    await drag(h, [[cx, cy], [cx + 70, cy, 60]]);
    await settle();
    s = await state(h.page);
    check(`${tag} deck: flick right goes back one`, s.cur === 3, s);
    await h.page.keyboard.press('Home');
    await settle();
    await drag(h, [[cx, cy], [cx + 160, cy, 400]], { hold: 100, onHold: async () => (s = await state(h.page)) });
    check(`${tag} deck: rubber-band at the start (past 0 but bounded)`, s.pos < 0 && s.pos > -0.33, { pos: s.pos });
    await settle();
    s = await state(h.page);
    check(`${tag} deck: rubber-band returns`, near(s.pos, 0, 0.01) && s.cur === 0, s);
    await h.page.click('#next');
    await settle(700);
    await h.page.keyboard.press('ArrowRight');
    await settle(700);
    s = await state(h.page);
    check(`${tag} deck: arrow button + keyboard drive the same spring`, s.cur === 2 && near(s.pos, 2, 0.01), s);
    await h.page.click('.dot >> nth=4');
    await settle();
    s = await state(h.page);
    check(`${tag} deck: dots`, s.cur === 4, s);
    await h.page.keyboard.press('ArrowLeft');
    await h.page.click('#prev');
    await settle();
    s = await state(h.page);
    check(`${tag} deck: prev x2`, s.cur === 2, s);
    const live = await h.page.evaluate(() => document.querySelector('#live').textContent);
    check(`${tag} deck: live region announces the card`, /Poppy, 3 of 5/.test(live), { live });
    // vertical gesture on the deck is not claimed
    await drag(h, [[cx, cy], [cx + 4, cy + 120, 300]]);
    await settle(500);
    s = await state(h.page);
    check(`${tag} deck: vertical swipe is left to the page`, s.cur === 2 && near(s.pos, 2, 0.001) && s.mode === 'closed', s);
    check(`${tag} deck: no console errors`, h.errors.length === 0, { errors: h.errors });
    await h.ctx.close();
  }
  if (touch && br === 'chromium') {
    const h = await fresh(kind);
    const [, cy] = await center(h);
    await drag(h, [[8, cy], [220, cy, 300]]);
    await settle(600);
    const s = await state(h.page);
    check(`${tag} edge: touch starting in the 20px edge is left to the browser (iOS back swipe)`, s.cur === 0 && near(s.pos, 0, 0.001), s);
    await h.ctx.close();
  }

  /* ---------- open / close ---------- */
  {
    const h = await fresh(kind);
    const [cx, cy] = await center(h);
    const rect0 = await cardRect(h.page, 0);
    await startRecording(h.page);
    await tapAt(h, cx, cy);
    await waitMode(h.page, 'open');
    let rec = await stopRecording(h.page);
    const first = rec.find((r) => r.mode !== 'closed');
    const s = await state(h.page);
    const o = await h.page.evaluate(() => ({
      hidden: document.querySelector('#sheet').hidden,
      focus: document.activeElement?.className,
      inert: document.querySelector('#page').inert,
      scroll: document.querySelector('#sheet').className,
      html: document.documentElement.className,
    }));
    check(`${tag} open: tap opens (p=1, #ivory, dialog visible)`, s.p === 1 && s.hash === '#ivory' && !o.hidden, { s, o });
    check(`${tag} open: focus moves to close, background inert, scroll locked`, o.focus === 'close' && o.inert && o.html.includes('locked'), o);
    check(`${tag} open: first frame starts at the card's rect (shared element)`, near(first.x, rect0.x, 16) && near(first.y, rect0.y, 16) && near(first.w, rect0.w, 22), { first, rect0 });
    if (br === 'chromium') check(`${tag} open: no jump between frames (max step px)`, maxStep(rec) < 90, { step: maxStep(rec) });
    const hero = await h.page.evaluate(() => {
      const r = document.querySelector('.hero').getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, t: document.querySelector('.hero').style.transform };
    });
    check(`${tag} open: at rest the hero has no transform (crisp)`, hero.t === '' && near(hero.y, 0, 0.5), hero);

    // close by button, then reopen and close by Escape, then by Back
    await startRecording(h.page);
    await h.page.click('.close');
    await waitMode(h.page, 'closed');
    rec = await stopRecording(h.page);
    const last = [...rec].reverse().find((r) => r.mode === 'closing' && r.p > 0.001);
    const o2 = await h.page.evaluate(() => ({ hash: location.hash, hidden: document.querySelector('#sheet').hidden, focus: document.activeElement?.className, inert: document.querySelector('#page').inert }));
    const r2 = await cardRect(h.page, 0);
    check(`${tag} close: button -> closed, hash cleared, focus restored to the card`, o2.hash === '' && o2.hidden && o2.focus === 'hit' && !o2.inert, o2);
    check(`${tag} close: last frame lands on the card's rect`, !last || (near(last.x, r2.x, 14) && near(last.y, r2.y, 14) && near(last.w, r2.w, 18)), { last, r2 });
    if (br === 'chromium') check(`${tag} close: no jump between frames`, maxStep(rec) < 90, { step: maxStep(rec) });
    await tapAt(h, cx, cy);
    await waitMode(h.page, 'open');
    await h.page.keyboard.press('Escape');
    await waitMode(h.page, 'closed');
    check(`${tag} close: Escape`, (await state(h.page)).hash === '');
    await tapAt(h, cx, cy);
    await waitMode(h.page, 'open');
    const len = await h.page.evaluate(() => history.length);
    await h.page.goBack();
    await waitMode(h.page, 'closed');
    const sb = await state(h.page);
    check(`${tag} close: browser Back closes with the transition and clears the hash`, sb.hash === '' && sb.p === 0, { len, sb });
    await h.page.goForward();
    await waitMode(h.page, 'open');
    check(`${tag} open: browser Forward reopens`, (await state(h.page)).hash === '#ivory');
    check(`${tag} open/close: no console errors`, h.errors.length === 0, { errors: h.errors });
    await h.ctx.close();
  }

  /* ---------- pull-down ---------- */
  {
    const h = await fresh(kind);
    const [cx, cy] = await center(h);
    const open = async () => {
      await tapAt(h, cx, cy);
      await waitMode(h.page, 'open');
      await sleep(150);
    };
    const hx = cx;
    const hy = 330;
    await open();
    let mid;
    await drag(h, [[hx, hy], [hx + 6, hy + 60, 600]], { hold: 120, onHold: async () => (mid = await state(h.page)) });
    await waitMode(h.page, 'open');
    let s = await state(h.page);
    check(`${tag} pull: partial pull scrubs p directly (mode=dragging, 0<p<1)`, mid.mode === 'dragging' && mid.p < 0.95 && mid.p > 0.5, mid);
    check(`${tag} pull: partial slow pull springs back and stays open`, s.p === 1 && s.hash === '#ivory', s);
    await drag(h, [[hx, hy], [hx + 10, hy + 300, 500]]);
    await waitMode(h.page, 'closed');
    s = await state(h.page);
    check(`${tag} pull: full pull closes`, s.mode === 'closed' && s.hash === '' && s.p === 0, s);
    await open();
    await drag(h, [[hx, hy], [hx + 4, hy + 80, 60]]);
    await waitMode(h.page, 'closed');
    check(`${tag} pull: short fast flick closes (velocity-projected)`, true);
    await open();
    await drag(h, [[hx, hy], [hx, hy + 300, 400], [hx, hy + 80, 400]], { hold: 80 });
    await waitMode(h.page, 'open');
    check(`${tag} pull: pulled far then dragged back up and released stays open`, (await state(h.page)).p === 1);
    // scrolled: a downward drag scrolls the document, it must not close
    await h.page.evaluate(() => (document.querySelector('#sheet').scrollTop = 400));
    await sleep(150);
    const sy0 = await h.page.evaluate(() => document.querySelector('#sheet').scrollTop);
    await drag(h, [[hx, 600], [hx, 760, 300]]);
    await sleep(500);
    const sy1 = await h.page.evaluate(() => document.querySelector('#sheet').scrollTop);
    s = await state(h.page);
    check(`${tag} pull: never claimed while the detail is scrolled`, s.mode === 'open' && sy0 > 300 && sy1 <= sy0, { sy0, sy1, s });
    // closing from a scrolled detail returns to the card without a jump
    await h.page.keyboard.press('Escape');
    await waitMode(h.page, 'closed');
    check(`${tag} pull: Escape from a scrolled detail closes (scroll eased to top)`, (await state(h.page)).hash === '');
    check(`${tag} pull: no console errors`, h.errors.length === 0, { errors: h.errors });
    await h.ctx.close();
  }

  /* ---------- interruption ---------- */
  {
    const h = await fresh(kind);
    const [cx, cy] = await center(h);
    await tapAt(h, cx, cy);
    await sleep(110);
    let m = await state(h.page);
    await h.page.keyboard.press('Escape'); // reverse while opening
    await waitMode(h.page, 'closed');
    let s = await state(h.page);
    check(`${tag} interrupt: Escape while opening reverses smoothly to closed`, m.mode === 'opening' && s.p === 0 && s.hash === '', { m, s });
    await tapAt(h, cx, cy);
    await waitMode(h.page, 'open');
    await sleep(120);
    await h.page.keyboard.press('Escape');
    await sleep(110);
    m = await state(h.page);
    await tapAt(h, 200 > cx ? cx : cx, 300); // tap the hero while it is closing
    await waitMode(h.page, 'open', 5000);
    s = await state(h.page);
    check(`${tag} interrupt: tapping the hero while closing re-opens (same spring)`, m.mode === 'closing' && s.p === 1 && s.hash === '#ivory', { m, s });
    // grab mid-close and pull
    await h.page.keyboard.press('Escape');
    await sleep(90);
    await drag(h, [[cx, 300], [cx, 340, 120]], { hold: 40 });
    await sleep(1100);
    s = await state(h.page);
    check(`${tag} interrupt: grabbing mid-close hands control to the finger and settles cleanly`, (s.mode === 'open' && s.p === 1) || (s.mode === 'closed' && s.p === 0), s);
    await h.ctx.close();
  }
  {
    const h = await fresh(kind);
    const [cx, cy] = await center(h);
    for (let i = 0; i < 20; i++) {
      await tapAt(h, cx, cy);
      await sleep(i % 3 === 0 ? 0 : 25);
    }
    await sleep(1300);
    let s = await state(h.page);
    check(`${tag} spam: 20 rapid taps settle in a consistent open state`, s.mode === 'open' && s.p === 1 && s.hash === '#ivory', s);
    for (let i = 0; i < 12; i++) {
      await h.page.keyboard.press('Escape');
      await sleep(30 + (i % 4) * 40);
      await tapAt(h, cx, 330);
      await sleep(20 + (i % 3) * 30);
    }
    await sleep(1500);
    s = await state(h.page);
    const hid = await h.page.evaluate(() => document.querySelector('#sheet').hidden);
    check(`${tag} spam: 12 alternating close/open keep state, hash and DOM in agreement`, (s.mode === 'open' && s.p === 1 && s.hash === '#ivory' && !hid) || (s.mode === 'closed' && s.p === 0 && s.hash === '' && hid), { s, hid });
    const hl = await h.page.evaluate(() => history.length);
    check(`${tag} spam: history did not balloon`, hl < 40, { hl });
    check(`${tag} spam: no console errors`, h.errors.length === 0, { errors: h.errors });
    await h.ctx.close();
  }

  /* ---------- colour switch + angle ---------- */
  {
    const h = await fresh(kind);
    const [cx, cy] = await center(h);
    await tapAt(h, cx, cy);
    await waitMode(h.page, 'open');
    await sleep(100);
    await h.page.evaluate(() => document.querySelector('.sw[data-i="1"]').scrollIntoView({ block: 'center' }));
    await sleep(150);
    await h.page.click('.sw[data-i="1"]');
    await sleep(60);
    const mixed = await h.page.evaluate(() => [...document.querySelectorAll('.grp:not([hidden])')].map((g) => g.style.opacity));
    await sleep(600);
    const o = await h.page.evaluate(() => ({
      hash: location.hash,
      title: document.querySelector('#dtitle').textContent,
      name: document.querySelector('.name').textContent,
      pressed: document.querySelector('.sw[data-i="1"]').getAttribute('aria-pressed'),
      groups: [...document.querySelectorAll('.grp:not([hidden])')].length,
      src: [...document.querySelectorAll('.grp:not([hidden]) img')].map((i) => i.currentSrc || i.src).join(' '),
      cur: __bonnet.cur,
      pos: __bonnet.pos,
    }));
    check(`${tag} colour: switching crossfades two layers then keeps one, updates hash/title/deck index`, mixed.length === 2 && o.groups === 1 && o.hash === '#moss' && o.title === 'Moss' && o.cur === 1 && o.pos === 1 && o.pressed === 'true' && /moss/.test(o.src), { mixed, o });
    await h.page.evaluate(() => (document.querySelector('#sheet').scrollTop = 0));
    await sleep(200);
    await startRecording(h.page);
    await h.page.keyboard.press('Escape');
    await waitMode(h.page, 'closed');
    const rec = await stopRecording(h.page);
    const last = [...rec].reverse().find((r) => r.mode === 'closing' && r.p > 0.001);
    const s = await state(h.page);
    const r1 = await cardRect(h.page, 1);
    const vis = await h.page.evaluate(() => getComputedStyle(document.querySelectorAll('.slide')[1]).visibility);
    check(`${tag} colour: closing lands on the new colour's card (front, centred, visible)`, s.cur === 1 && s.pos === 1 && vis === 'visible' && s.hash === '' && (!last || near(last.x, r1.x, 14) && near(last.w, r1.w, 18)), { s, vis, last, r1 });
    // second colour switch twice quickly (interruptible)
    await tapAt(h, cx, cy);
    await waitMode(h.page, 'open');
    await sleep(100);
    await h.page.evaluate(() => document.querySelector('.sw[data-i="3"]').scrollIntoView({ block: 'center' }));
    await sleep(100);
    await h.page.click('.sw[data-i="3"]');
    await sleep(40);
    await h.page.click('.sw[data-i="4"]');
    await sleep(40);
    await h.page.click('.sw[data-i="0"]');
    await sleep(900);
    const o2 = await h.page.evaluate(() => ({ groups: [...document.querySelectorAll('.grp:not([hidden])')].length, hash: location.hash, cur: __bonnet.cur, title: document.querySelector('#dtitle').textContent }));
    check(`${tag} colour: three quick switches settle on the last`, o2.groups === 1 && o2.hash === '#ivory' && o2.cur === 0 && o2.title === 'Ivory', o2);
    check(`${tag} colour: no console errors`, h.errors.length === 0, { errors: h.errors });
    await h.ctx.close();
  }
  {
    const h = await fresh(kind);
    const [cx, cy] = await center(h);
    await tapAt(h, cx, cy);
    await waitMode(h.page, 'open');
    await sleep(150);
    const hx = cx;
    const hy = 330;
    let mid;
    await drag(h, [[hx + 100, hy], [hx - 60, hy + 4, 500]], { hold: 120, onHold: async () => (mid = await h.page.evaluate(() => ({ a: __bonnet.angle, op: [...document.querySelectorAll('.grp:not([hidden]) img')].map((i) => +i.style.opacity) }))) });
    await sleep(900);
    let s = await state(h.page);
    const sum = mid.op.reduce((a, b) => a + b, 0);
    check(`${tag} angle: horizontal drag on the hero scrubs a fractional angle with crossfade weights summing to 1`, mid.a > 0.2 && mid.a < 0.99 && near(sum, 1, 0.02), { mid, sum });
    check(`${tag} angle: release snaps to a whole angle (inertia, nearest)`, Number.isInteger(Math.round(s.angle * 1000) / 1000) && s.angle === Math.round(s.angle), s);
    check(`${tag} angle: gesture did not pull the sheet down`, s.mode === 'open' && s.p === 1, s);
    await drag(h, [[hx + 120, hy], [hx - 140, hy, 70]]);
    await sleep(1100);
    const s2 = await state(h.page);
    check(`${tag} angle: a flick carries on to the next angle`, s2.angle > s.angle && s2.angle === Math.round(s2.angle), { from: s.angle, to: s2.angle });
    await h.page.click('.angles button[data-k="3"]');
    await sleep(1100);
    const s3 = await h.page.evaluate(() => ({ a: __bonnet.angle, lbl: document.querySelector('.angles .lbl').textContent, pressed: document.querySelector('.angles button[data-k="3"]').getAttribute('aria-pressed') }));
    check(`${tag} angle: indicator buttons jump to a view and show it`, ((s3.a % 4) + 4) % 4 === 3 && s3.lbl === 'Left' && s3.pressed === 'true', s3);
    await h.page.keyboard.press('Escape');
    await waitMode(h.page, 'closed');
    check(`${tag} angle: closing returns the angle to the front`, (await state(h.page)).angle === 0);
    check(`${tag} angle: no console errors`, h.errors.length === 0, { errors: h.errors });
    await h.ctx.close();
  }

  /* ---------- direct load ---------- */
  {
    const h = await fresh(kind, '#sky');
    const s = await state(h.page);
    const o = await h.page.evaluate(() => ({ hidden: document.querySelector('#sheet').hidden, pressed: document.querySelector('.sw[data-i="3"]').getAttribute('aria-pressed'), title: document.querySelector('#dtitle').textContent, tf: document.querySelector('.hero').style.transform }));
    check(`${tag} direct: /#sky opens the detail without animation on that colour`, s.mode === 'open' && s.p === 1 && s.cur === 3 && !o.hidden && o.pressed === 'true' && o.title === 'Sky' && o.tf === '', { s, o });
    await h.page.click('.close');
    await waitMode(h.page, 'closed');
    const s2 = await state(h.page);
    check(`${tag} direct: closing animates to the deck on that colour and clears the hash`, s2.hash === '' && s2.cur === 3 && s2.pos === 3, s2);
    check(`${tag} direct: no console errors`, h.errors.length === 0, { errors: h.errors });
    await h.ctx.close();
  }
}

/* ---------- reduced motion ---------- */
async function reduced() {
  const h = await fresh('desktop', '', { reducedMotion: 'reduce' });
  const [cx, cy] = await center(h);
  await h.page.click('#next');
  await sleep(450);
  const o = await h.page.evaluate(() => ({ pos: __bonnet.pos, tf: document.querySelectorAll('.slide')[1].style.transform }));
  check('reduced: deck still works, crossfade in place (no spatial transform)', o.pos === 1 && /translate3d\(0(\.00)?px,\s?0(\.00)?px/.test(o.tf) && /rotate\(0(\.000)?deg\)/.test(o.tf), o);
  await h.page.click('.hit[data-i="1"]');
  await sleep(50);
  const mid = await h.page.evaluate(() => ({ tf: document.querySelector('.hero').style.transform, op: document.querySelector('.hero').style.opacity }));
  await waitMode(h.page, 'open');
  check('reduced: detail opens by crossfade, hero is never transformed', mid.tf === '' && mid.op !== undefined, mid);
  await h.page.keyboard.press('Escape');
  await waitMode(h.page, 'closed');
  check('reduced: closes and restores focus', (await h.page.evaluate(() => document.activeElement.className)) === 'hit');
  check('reduced: no console errors', h.errors.length === 0, { errors: h.errors });
  void cx;
  void cy;
  await h.ctx.close();
}

await suite('desktop');
if (br === 'chromium') await suite('mobile');
await reduced();
await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} checks passed (${br})`);
process.exit(bad.length ? 1 : 0);
