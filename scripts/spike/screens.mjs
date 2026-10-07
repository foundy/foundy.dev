// Screenshots of every stage and look into docs/spike/img (canvas only, palette PNG).
// Needs the preview server on :4401.   usage: node scripts/spike/screens.mjs
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:4401';
const OUT = new URL('../../docs/spike/img/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu'] });

async function shot(name, url, { drag = false, vp = { width: 1440, height: 900 }, scale = 1, width = 1200 } = {}) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: scale });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.error(name, 'pageerror', e.message));
  await p.goto(BASE + url);
  await p.waitForSelector('#gl[data-ready="1"]');
  await p.waitForTimeout(700);
  if (drag) {
    const r = await p.locator('#gl').boundingBox();
    const N = 40;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      await p.mouse.move(r.x + r.width * (0.12 + 0.55 * t), r.y + r.height * (0.25 + 0.5 * t + 0.08 * Math.sin(t * 9)));
      await p.waitForTimeout(12);
    }
    await p.waitForTimeout(110);
  }
  const buf = await p.locator('#gl').screenshot();
  const png = await sharp(buf)
    .resize({ width, withoutEnlargement: true })
    .png({ palette: true, colors: 96, quality: 70, effort: 10, dither: 0.6 })
    .toFile(`${OUT}${name}.png`);
  console.log(name, png.width + 'x' + png.height, Math.round(png.size / 1024) + ' KB');
  await ctx.close();
}

const mobile = { width: 390, height: 844 };
// stages (raw variant, ink look); flow/composite shown mid-swipe
await shot('stage-1-sdf', '/spike/raw/?stage=sdf&t=2');
await shot('stage-2-warp', '/spike/raw/?stage=warp&t=2');
await shot('stage-3-flow', '/spike/raw/?stage=flow', { drag: true });
await shot('stage-4-composite', '/spike/raw/?stage=composite&look=ink', { drag: true });
// looks, at rest and mid-swipe
for (const look of ['ink', 'refract', 'riso']) {
  await shot(`look-${look}-rest`, `/spike/raw/?look=${look}&t=2`);
  await shot(`look-${look}-swipe`, `/spike/raw/?look=${look}`, { drag: true });
}
// stack parity: three webgpu vs three webgl2 vs raw, same composite at rest and mid-swipe
await shot('parity-raw-rest', '/spike/raw/?t=2');
await shot('parity-three-webgpu-rest', '/spike/three/?t=2');
await shot('parity-three-webgl2-rest', '/spike/three/?t=2&gl=webgl2');
await shot('parity-raw-swipe', '/spike/raw/', { drag: true });
await shot('parity-three-webgpu-swipe', '/spike/three/', { drag: true });
await shot('parity-three-webgl2-swipe', '/spike/three/?gl=webgl2', { drag: true });
// mobile
await shot('mobile-ink-rest', '/spike/raw/?t=2', { vp: mobile, scale: 2, width: 390 });
await shot('mobile-riso-rest', '/spike/raw/?look=riso&t=2', { vp: mobile, scale: 2, width: 390 });
await browser.close();
