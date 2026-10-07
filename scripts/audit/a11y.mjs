// axe-core over every page in several states, light + dark, desktop + 320px.
//   states: default, inspect on, (home) sheet open, sheet open + inspect on (timeline), (lab) all sections hydrated
// usage: node scripts/audit/a11y.mjs [baseUrl] [browser=chromium]      exits 1 on any violation (wcag2a/aa, 2.1 a/aa, best-practice)
import { chromium, webkit, firefox } from 'playwright';
import { readFileSync } from 'node:fs';

const [base = 'http://127.0.0.1:4731', br = 'chromium'] = process.argv.slice(2);
const T = { chromium, webkit, firefox }[br];
const axeSrc = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const browser = await T.launch();
const pages = ['/', '/work/hero-shader/', '/work/card-study/', '/lab/', '/404.html'];
let total = 0;
let runs = 0;
const rows = [];

async function axe(page, label) {
  await page.evaluate(axeSrc);
  const r = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] }));
  runs++;
  total += r.violations.length;
  for (const v of r.violations) console.log(`VIOLATION ${label}: ${v.id} (${v.impact}) x${v.nodes.length} ${v.nodes[0].target.join(' ')} :: ${v.help}`);
  rows.push({ label, violations: r.violations.length });
}

for (const [w, h, scheme] of [
  [1350, 900, 'light'],
  [1350, 900, 'dark'],
  [320, 700, 'light'],
]) {
  const mobile = w < 600;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, ...(mobile && br !== 'firefox' ? { hasTouch: true, isMobile: true } : {}) });
  for (const path of pages) {
    const page = await ctx.newPage();
    const tag = `${br} ${w}px ${scheme} ${path}`;
    await page.goto(base + path);
    await page.evaluate(() => document.fonts.ready);
    if (path === '/') await page.waitForFunction(() => document.querySelector('[data-hero-poster].gl-done'), null, { timeout: 20000 }).catch(() => {});
    if (path === '/lab/') {
      for (const s of await page.locator('[data-lab]').all()) await s.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => document.querySelectorAll('[data-lab-ready]').length === 4, null, { timeout: 20000 }).catch(() => {});
      await page.evaluate(() => scrollTo(0, 0));
    }
    await page.waitForTimeout(300);
    await axe(page, `${tag} default`);
    // Inspect on
    const toggle = page.locator('[data-inspect-toggle]').first();
    if (await toggle.count()) {
      await toggle.click();
      await page.waitForSelector('[data-inspect-panel]', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(400);
      await axe(page, `${tag} inspect-on`);
      if (path === '/') {
        // sheet open with Inspect on: the cards timeline panel is the active inspectable
        const t = page.locator('[data-card="card-study"] [data-card-title]');
        await t.scrollIntoViewIfNeeded();
        await t.click();
        await page.waitForFunction(() => document.documentElement.dataset.cardsState === 'open', null, { timeout: 5000 });
        await page.waitForTimeout(500);
        await axe(page, `${tag} sheet-open+inspect`);
        await page.keyboard.press('i'); // inspect off, sheet still open
        await page.waitForTimeout(300);
        await axe(page, `${tag} sheet-open`);
      }
    }
    await page.close();
  }
  await ctx.close();
}
await browser.close();
console.log(`\n${br}: ${runs} axe runs, ${total} violations`);
process.exit(total ? 1 : 0);
