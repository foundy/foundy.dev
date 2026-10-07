// Lab chart label audit: for every decision and every recording, at desktop and mobile widths, measure the chart's
// text labels and report any pair of overlapping boxes. Optionally saves a chart screenshot of the worst case.
// usage: node scripts/lab/charts.mjs [baseUrl] [outDir]    (exit 1 if any overlap)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

const [base = 'http://127.0.0.1:4731', out] = process.argv.slice(2);
if (out) mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
let bad = 0;
for (const [w, h, mobile, tag] of [
  [1440, 900, false, 'desktop'],
  [390, 844, true, 'mobile'],
  [320, 700, true, '320'],
]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, ...(mobile ? { hasTouch: true, isMobile: true } : {}) });
  const page = await ctx.newPage();
  await page.goto(`${base}/lab/`);
  await page.evaluate(() => document.fonts.ready);
  const ids = await page.evaluate(() => [...document.querySelectorAll('[data-lab]')].map((e) => e.dataset.lab));
  for (const id of ids) {
    const sec = page.locator(`[data-lab="${id}"]`);
    await sec.scrollIntoViewIfNeeded();
    await page.waitForSelector(`[data-lab="${id}"][data-lab-ready="1"]`);
    const chips = await sec.locator('.lab-chip').count();
    for (let c = 0; c < chips; c++) {
      await sec.locator('.lab-chip').nth(c).click();
      await page.waitForTimeout(2200); // let the replay finish: final frame
      const r = await page.evaluate((id) => {
        const res = [];
        for (const svg of document.querySelectorAll(`[data-lab="${id}"] svg.ch`)) {
          const t = [...svg.querySelectorAll('text')].filter((x) => x.textContent.trim()).map((x) => ({ s: x.textContent, b: x.getBoundingClientRect() }));
          const sb = svg.getBoundingClientRect();
          const hits = [];
          for (let i = 0; i < t.length; i++) {
            const a = t[i].b;
            if (a.left < sb.left - 0.5 || a.right > sb.right + 0.5) hits.push(`${t[i].s} outside`);
            for (let j = i + 1; j < t.length; j++) {
              const b = t[j].b;
              if (a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5) hits.push(`${t[i].s} x ${t[j].s}`);
            }
          }
          res.push(hits);
        }
        return res;
      }, id);
      const n = r.flat().length;
      if (n) {
        bad += n;
        console.log(`OVERLAP ${tag} ${id} chip ${c}:`, JSON.stringify(r));
        if (out) {
          const el = sec.locator('svg.ch').first();
          await el.scrollIntoViewIfNeeded();
          const png = await el.screenshot();
          await sharp(png).png({ palette: true }).toFile(`${out}/chart-${tag}-${id}-${c}.png`);
        }
      }
    }
  }
  await ctx.close();
}
await browser.close();
console.log(bad ? `${bad} overlapping label pairs` : 'no overlapping chart labels');
process.exit(bad ? 1 : 0);
