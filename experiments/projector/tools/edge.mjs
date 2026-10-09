// reduced-motion + context-loss fallback + perf sampling
import { launch, open, sleep, shot, drag } from './lib.mjs';
const b = await launch();
{
  const { page, logs } = await open(b, 'mixed', { ctx: { reducedMotion: 'reduce' } });
  await page.click('#next'); await sleep(140);
  await shot(page, '/tmp/rm-change.jpg');
  await sleep(1200);
  await page.evaluate(() => window.__pj.open()); await sleep(200);
  await page.evaluate(() => window.__pj.hold(0.5)); await sleep(150);
  await shot(page, '/tmp/rm-mid.jpg');
  console.log('reduced-motion errors:', logs.filter((l) => /error/i.test(l) && !/404/.test(l)));
}
{
  const { page } = await open(b, 'bonnet', {});
  await page.evaluate(() => { const gl = document.querySelector('#gl').getContext('webgl2'); gl.getExtension('WEBGL_lose_context').loseContext(); });
  await sleep(500);
  console.log('nogl class:', await page.evaluate(() => document.documentElement.className));
  await shot(page, '/tmp/lost.jpg');
  await page.touchscreen.tap(195, 250); await sleep(400);
  console.log('open after loss:', await page.evaluate(() => document.documentElement.className), 'scrollable', await page.evaluate(() => document.documentElement.scrollHeight > innerHeight));
  await shot(page, '/tmp/lost-open.jpg');
}
{
  const { page } = await open(b, 'bonnet', { debug: true, dsf: 2 });
  for (let i = 0; i < 4; i++) { const d = await drag(page, 330, 700, 50, 700, 140, 8); await d.end(); await sleep(900); }
  await page.touchscreen.tap(195, 250); await sleep(1800);
  await page.click('#close'); await sleep(1800);
  console.log('perf', JSON.stringify(await page.evaluate(() => window.__dbg())), await page.evaluate(() => document.querySelector('#dbg').textContent.split('\n').pop()));
}
await b.close();
