// Heights of the Lab controls (.lab-ui, .lab-bar) before and after hydration at several widths, to size the reserved space.
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:4731';
const b = await chromium.launch();
for (const w of [1350, 1000, 800, 600, 390, 320]) {
  const p = await (await b.newContext({ viewport: { width: w, height: 900 } })).newPage();
  await p.route('**/lab/data/*', (r) => setTimeout(() => r.continue(), 1500)); // hold hydration back to read the "before" heights
  await p.goto(`${base}/lab/`);
  const read = () =>
    p.evaluate(() =>
      [...document.querySelectorAll('[data-lab]')].map((s) => [Math.round(s.querySelector('.lab-ui').getBoundingClientRect().height), Math.round(s.querySelector('.lab-bar')?.getBoundingClientRect().height ?? -1)].join('/'))
    );
  const before = await read();
  for (const sec of await p.locator('[data-lab]').all()) {
    await sec.scrollIntoViewIfNeeded();
    await p.waitForTimeout(100);
  }
  await p.waitForSelector('[data-lab][data-lab-ready="1"]');
  await p.waitForFunction(() => document.querySelectorAll('[data-lab-ready]').length === 4);
  await p.waitForTimeout(300);
  console.log(w, 'before ui/bar', before.join(' '), 'after', (await read()).join(' '));
}
await b.close();
