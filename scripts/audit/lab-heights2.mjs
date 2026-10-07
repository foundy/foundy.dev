// Per-element heights inside each Lab side before / after hydration (find what moves). usage: node scripts/audit/lab-heights2.mjs [base] [width]
import { chromium } from 'playwright';

const [base = 'http://127.0.0.1:4731', width = '390'] = process.argv.slice(2);
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: +width, height: 900 } })).newPage();
await p.route('**/lab/data/*', (r) => setTimeout(() => r.continue(), 2500));
await p.goto(`${base}/lab/`);
const read = () =>
  p.evaluate(() =>
    [...document.querySelectorAll('[data-lab]')].map((s) => ({
      id: s.dataset.lab,
      ui: Math.round(s.querySelector('.lab-ui').getBoundingClientRect().height),
      sides: [...s.querySelectorAll('.lab-side')].map((f) => ['figcaption', '[data-hit]', '[data-badge]', '[data-detail]', '[data-chart]', '[data-why]'].map((q) => Math.round(f.querySelector(q).getBoundingClientRect().height * 10) / 10).join('/')).join(' | '),
      tau: s.querySelector('[data-tau-ui]') ? Math.round(s.querySelector('[data-tau-ui]').getBoundingClientRect().height) : '-',
      page: Math.round(s.getBoundingClientRect().height),
    })),
  );
const before = await read();
for (const sec of await p.locator('[data-lab]').all()) {
  await sec.scrollIntoViewIfNeeded();
  await p.waitForTimeout(100);
}
await p.waitForFunction(() => document.querySelectorAll('[data-lab-ready]').length === 4, null, { timeout: 20000 });
await p.waitForTimeout(500);
const after = await read();
for (let i = 0; i < before.length; i++) console.log(JSON.stringify(before[i]), '\n  ->', JSON.stringify(after[i]));
await b.close();
