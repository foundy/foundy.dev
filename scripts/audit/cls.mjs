// Layout-shift sources over a page load + a slow scroll to the bottom. usage: node scripts/audit/cls.mjs <url> [width=1350] [height=940]
import { chromium } from 'playwright';

const [url, w = '1350', h = '940'] = process.argv.slice(2);
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: +w, height: +h } })).newPage();
await p.addInitScript(() => {
  window.__ls = [];
  new PerformanceObserver((l) =>
    l.getEntries().forEach((e) => {
      if (e.hadRecentInput) return;
      window.__ls.push({ t: Math.round(e.startTime), v: +e.value.toFixed(4), src: e.sources.map((s) => `${s.node?.nodeName}.${s.node?.className?.baseVal ?? s.node?.className ?? ''} ${JSON.stringify(s.previousRect)}->${JSON.stringify(s.currentRect)}`) });
    }),
  ).observe({ type: 'layout-shift', buffered: true });
});
await p.goto(url, { waitUntil: 'load' });
for (let y = 0; y < 12000; y += 400) {
  await p.evaluate((yy) => scrollTo(0, yy), y);
  await p.waitForTimeout(120);
}
await p.waitForTimeout(2500);
const r = await p.evaluate(() => window.__ls);
console.log(JSON.stringify(r, null, 1), 'total', r.reduce((a, x) => a + x.v, 0).toFixed(4));
await b.close();
