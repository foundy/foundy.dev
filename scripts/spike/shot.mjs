// usage: [DRAG=1] node scripts/spike/shot.mjs "<url>" out.png [w h dpr browser]
import { chromium, webkit, firefox } from 'playwright';
const [url, out, w = '1440', h = '900', dpr = '1', br = 'chrome'] = process.argv.slice(2);
const b =
  br === 'webkit'
    ? await webkit.launch()
    : br === 'firefox'
      ? await firefox.launch()
      : await chromium.launch({
          channel: br === 'chrome' ? 'chrome' : undefined,
          args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
        });
const ctx = await b.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
const p = await ctx.newPage();
p.on('console', (m) => m.type() !== 'debug' && console.log('console', m.type(), m.text()));
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(url);
await p.waitForSelector('#gl[data-ready="1"]', { timeout: 20000 }).catch((e) => console.log('not ready', e.message));
await p.waitForTimeout(600);
if (process.env.DRAG) {
  const r = await p.locator('#gl').boundingBox();
  // one diagonal swipe through the wordmark, then stop while the flow is still alive
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    await p.mouse.move(r.x + r.width * (0.12 + 0.55 * t), r.y + r.height * (0.25 + 0.5 * t + 0.08 * Math.sin(t * 9)));
    await p.waitForTimeout(12);
  }
  await p.waitForTimeout(+process.env.AFTER || 120);
}
console.log(JSON.stringify(await p.evaluate(() => window.__spike?.info)));
await p.screenshot({ path: out });
await b.close();
