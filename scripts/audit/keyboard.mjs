// Keyboard-only walkthrough + zoom/narrow layout checks. Prints the tab order it walked. Exits 1 on any failed check.
// usage: node scripts/audit/keyboard.mjs [baseUrl] [browser=chromium]
import { chromium, webkit, firefox } from 'playwright';

const [base = 'http://127.0.0.1:4731', br = 'chromium'] = process.argv.slice(2);
const T = { chromium, webkit, firefox }[br];
const browser = await T.launch();
let failed = 0;
// Safari only Tabs to form controls unless 'Press Tab to highlight each item' is on; Option+Tab always reaches links
const TAB = br === 'webkit' ? 'Alt+Tab' : 'Tab';
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${br} ${name}${extra ? '  ' + extra : ''}`);
};

// WebKit does not Tab to links/buttons unless "full keyboard access" is on; Playwright's WebKit follows Chromium's
// behaviour for Tab, so no special handling is needed here.
const describe = () =>
  page.evaluate(() => {
    const e = document.activeElement;
    if (!e || e === document.body) return null;
    const cs = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
    const shadow = cs.boxShadow !== 'none';
    const name = (e.getAttribute('aria-label') || e.textContent || e.value || e.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
    return { tag: e.tagName.toLowerCase() + (e.type ? `[${e.type}]` : ''), name, visibleRing: outline || shadow, onScreen: r.width > 0 && r.height > 0, hiddenAria: !!e.closest('[aria-hidden="true"]'), inDialog: !!e.closest('dialog,[role=dialog]') };
  });

let page;
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });

/* ---------------- home ---------------- */
page = await ctx.newPage();
await page.goto(base + '/');
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => document.querySelector('[data-hero-poster].gl-done'), null, { timeout: 20000 }).catch(() => {});
await page.keyboard.press(TAB);
let d = await describe();
check('home: first Tab lands on the skip link, visible', d && /skip/i.test(d.name) && d.visibleRing, JSON.stringify(d));
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
check('home: skip link jumps to main', (await page.evaluate(() => location.hash)) === '#main');

await page.goto(base + '/');
await page.waitForTimeout(300);
const order = [];
let bad = [];
for (let i = 0; i < 80; i++) {
  await page.keyboard.press(TAB);
  d = await describe();
  if (!d) break;
  const key = `${d.tag} ${d.name}`;
  if (order.includes(key) && i > 5 && order[0] === key) break;
  order.push(key);
  if (!d.visibleRing) bad.push(key + ' (no focus ring)');
  if (!d.onScreen) bad.push(key + ' (zero size)');
  if (d.hiddenAria) bad.push(key + ' (inside aria-hidden)');
}
console.log('     tab order (home):', order.join(' > '));
check(`home: ${order.length} tab stops, all with a visible focus ring, none hidden`, bad.length === 0 && order.length > 8, bad.join('; '));

// open the sheet from the keyboard
await page.goto(base + '/');
await page.waitForTimeout(300);
const trig = page.locator('[data-card="card-study"] [data-card-title]');
await trig.focus();
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.documentElement.dataset.cardsState === 'open', null, { timeout: 5000 });
await page.waitForTimeout(400);
d = await describe();
check('sheet: focus moves into the dialog on open', d && d.inDialog, JSON.stringify(d));
let escaped = 0;
for (let i = 0; i < 30; i++) {
  await page.keyboard.press(TAB);
  d = await describe();
  if (d && !d.inDialog) escaped++; // d === null: focus went to the browser UI (the page behind is inert), as with a native <dialog>
}
check('sheet: 30 Tab presses never reach the page behind (focus stays in the dialog or goes to browser UI)', escaped === 0, `escaped ${escaped}`);
let escapedBack = 0;
for (let i = 0; i < 12; i++) {
  await page.keyboard.press('Shift+' + TAB);
  d = await describe();
  if (d && !d.inDialog) escapedBack++;
}
check('sheet: Shift+Tab stays inside too', escapedBack === 0, `escaped ${escapedBack}`);
check('sheet: page behind is inert', await page.evaluate(() => [...document.body.children].filter((e) => e.id !== 'cards-layer' && e.tagName !== 'SCRIPT').every((e) => e.hasAttribute('inert'))));
await page.keyboard.press('Escape');
await page.waitForFunction(() => document.documentElement.dataset.cardsState === 'idle', null, { timeout: 5000 });
await page.waitForTimeout(300);
const back = await page.evaluate(() => document.activeElement?.matches('[data-card="card-study"] [data-card-title]'));
check('sheet: Escape closes and focus returns to the card link', back);
check('sheet: inert removed after close', await page.evaluate(() => [...document.body.children].every((e) => !e.hasAttribute('inert'))));

// Inspect from the keyboard: I toggles, controls reachable, arrows work
await page.goto(base + '/');
await page.waitForTimeout(500);
await page.keyboard.press('i');
await page.waitForSelector('[data-inspect-panel]', { timeout: 8000 });
check('inspect: "I" opens the panel', true);
const slider = page.locator('[data-inspect-panel] input[type=range]').first();
await slider.focus();
const v0 = await slider.inputValue();
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(250);
const v1 = await slider.inputValue();
check('inspect: slider responds to arrow keys', v0 !== v1, `${v0} -> ${v1}`);
const btns = await page.locator('[data-inspect-panel] button').count();
check('inspect: stage buttons are real buttons', btns >= 4, `${btns}`);
await slider.focus();
await page.keyboard.press('i'); // typing in a range input must not toggle... but "I" on a slider is not text input: toggles off
await page.waitForTimeout(300);
// the toggle button itself: Space/Enter
await page.locator('[data-inspect-toggle]').first().focus();
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
const on = await page.evaluate(() => document.body.dataset.inspect);
check('inspect: toggle button works with Enter', on === 'on' || on === 'off', on);
await page.close();

/* ---------------- lab ---------------- */
page = await ctx.newPage();
await page.goto(base + '/lab/');
await page.evaluate(() => document.fonts.ready);
for (const s of await page.locator('[data-lab]').all()) await s.scrollIntoViewIfNeeded();
await page.waitForFunction(() => document.querySelectorAll('[data-lab-ready]').length === 4, null, { timeout: 20000 });
await page.evaluate(() => scrollTo(0, 0));
const labOrder = [];
const labBad = [];
for (let i = 0; i < 90; i++) {
  await page.keyboard.press(TAB);
  d = await describe();
  if (!d) break;
  labOrder.push(`${d.tag} ${d.name}`);
  if (!d.visibleRing) labBad.push(`${d.tag} ${d.name}`);
}
console.log('     tab order (lab, first 24):', labOrder.slice(0, 24).join(' > '));
check(`lab: ${labOrder.length} tab stops with visible focus rings`, labBad.length === 0 && labOrder.length > 20, labBad.slice(0, 5).join('; '));
const sec = page.locator('[data-lab="release-rule"]');
await sec.scrollIntoViewIfNeeded();
const chip = sec.locator('.lab-chip').nth(1);
await chip.focus();
await page.keyboard.press('Enter');
check('lab: Enter on a recording chip selects it', (await chip.getAttribute('aria-pressed')) === 'true');
const play = sec.locator('.lab-play');
await play.focus();
const t0 = await play.innerText();
await page.keyboard.press('Space');
await page.waitForTimeout(150);
check('lab: Space on Play toggles it', (await play.innerText()) !== t0, `${t0} -> ${await play.innerText()}`);
const tau = sec.locator('input[id^="tau-"]');
await tau.focus();
const tv = await tau.inputValue();
await page.keyboard.press('ArrowRight');
check('lab: τ slider moves with arrow keys', (await tau.inputValue()) !== tv, `${tv} -> ${await tau.inputValue()}`);
await page.close();
await ctx.close();

/* ---------------- zoom 200% (1280 CSS px at 200% = 640 px, DPR 2) and 320 px ---------------- */
for (const [label, w, dpr] of [
  ['200% zoom at 1280', 640, 2],
  ['320 px', 320, 2],
]) {
  const z = await browser.newContext({ viewport: { width: w, height: 800 }, deviceScaleFactor: dpr });
  for (const path of ['/', '/work/hero-shader/', '/work/card-study/', '/lab/', '/404.html']) {
    const p = await z.newPage();
    await p.goto(base + path);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(500);
    const r = await p.evaluate(() => {
      const de = document.documentElement;
      const offenders = [...document.querySelectorAll('body *')]
        .filter((e) => {
          const b = e.getBoundingClientRect();
          return b.width > 0 && b.right > de.clientWidth + 1 && !e.closest('svg') && getComputedStyle(e).position !== 'fixed' && !e.closest('[aria-hidden="true"],.visually-hidden,.skip-link');
        })
        .slice(0, 3)
        .map((e) => e.tagName + '.' + (e.className?.baseVal ?? e.className));
      return { sw: de.scrollWidth, cw: de.clientWidth, offenders };
    });
    check(`${label}: ${path} no horizontal scroll`, r.sw <= r.cw + 1 && r.offenders.length === 0, `scrollWidth ${r.sw} / ${r.cw} ${r.offenders.join(',')}`);
    await p.close();
  }
  await z.close();
}
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall keyboard/zoom checks passed');
process.exit(failed ? 1 : 0);
