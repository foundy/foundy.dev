// Stack the first chart of two Lab sections into one PNG (mobile width). usage: node scripts/lab/chart-shot.mjs [baseUrl] [out.png]
import { chromium } from 'playwright';
import sharp from 'sharp';

const [base = 'http://127.0.0.1:4731', out = 'docs/screenshots/phase-7/lab-charts-mobile.png'] = process.argv.slice(2);
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })).newPage();
await p.goto(`${base}/lab/`);
const imgs = [];
for (const id of ['release-rule', 'close-order']) {
  const sec = p.locator(`[data-lab="${id}"]`);
  await sec.scrollIntoViewIfNeeded();
  await p.waitForSelector(`[data-lab="${id}"][data-lab-ready="1"]`);
  await p.waitForTimeout(2500);
  const el = sec.locator('svg.ch').first();
  await el.scrollIntoViewIfNeeded();
  imgs.push(await el.screenshot());
}
const m = await Promise.all(imgs.map((i) => sharp(i).metadata()));
const W = Math.max(...m.map((x) => x.width));
const H = m.reduce((a, x) => a + x.height, 0);
await sharp({ create: { width: W, height: H, channels: 3, background: '#f3efe7' } })
  .composite(imgs.map((input, i) => ({ input, top: m.slice(0, i).reduce((a, x) => a + x.height, 0), left: 0 })))
  .png({ palette: true })
  .toFile(out);
await b.close();
