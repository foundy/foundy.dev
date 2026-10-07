// Poster <-> GL alignment check at rest.
// usage: node scripts/hero/diff.mjs [baseUrl] [browser=chromium|webkit|firefox] [dpr=1] [width=1440] [height=900]
// Takes the page with ?gl=none (SVG poster) and with the GL hero fully faded in (poster glyphs hidden, shader clock
// frozen), then reports the mean absolute difference over the wordmark box, as mean(|a-b|) per 8-bit channel
// (0..255) and as the share of pixels that differ by more than 64 (a hard misalignment would light these up).
import { chromium, webkit, firefox } from 'playwright';
import sharp from 'sharp';

const [base = 'http://127.0.0.1:4402', br = 'chromium', dprArg = '1', wArg = '1440', hArg = '900'] = process.argv.slice(2);
const T = { chromium, webkit, firefox }[br];
const browser = await T.launch(br === 'chromium' && process.env.CHANNEL ? { channel: process.env.CHANNEL } : {});
const ctx = await browser.newContext({ viewport: { width: +wArg, height: +hArg }, deviceScaleFactor: +dprArg });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));

async function shot(query, gl) {
  await page.goto(`${base}/${query}`);
  await page.evaluate(() => document.fonts.ready);
  if (gl) {
    await page.waitForFunction(() => document.querySelector('[data-hero-poster].gl-done'), null, { timeout: 20000 });
  }
  await page.waitForTimeout(400);
  const box = await page.evaluate(() => {
    const r = document.querySelector('[data-hero-poster] .art').getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: +wArg, height: +hArg } });
  return { png, box };
}

const a = await shot('?gl=none', false);
const b = await shot('?hud=1&t=3', true);
const d = +dprArg;
const region = {
  left: Math.round(a.box.x * d),
  top: Math.round(a.box.y * d),
  width: Math.round(a.box.width * d),
  height: Math.round(a.box.height * d),
};
const load = async (png) => sharp(png).extract(region).removeAlpha().raw().toBuffer();
const A = await load(a.png);
const B = await load(b.png);
let sum = 0;
let hard = 0;
for (let i = 0; i < A.length; i += 3) {
  const m = (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2])) / 3;
  sum += m;
  if (m > 64) hard++;
}
const n = A.length / 3;
console.log(
  JSON.stringify({
    browser: br,
    dpr: d,
    viewport: `${wArg}x${hArg}`,
    region,
    meanAbsDiff: +(sum / n).toFixed(3),
    pctPixelsOver64: +((100 * hard) / n).toFixed(3),
  }),
);
if (process.env.OUT) {
  await sharp(a.png).extract(region).toFile(`${process.env.OUT}-poster.png`);
  await sharp(b.png).extract(region).toFile(`${process.env.OUT}-gl.png`);
}
await browser.close();
