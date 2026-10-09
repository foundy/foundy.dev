// Functional flow check: drag spin, tap open, native scroll during/after open, close, Back, interrupt
import { launch, open, sleep, drag } from './lib.mjs';
const b = await launch();
const { page, logs } = await open(b, process.argv[2] || 'bonnet', {});
const st = () => page.evaluate(() => ({ p: +window.__pj.p.toFixed(3), handed: window.__pj.handed, y: Math.round(scrollY), open: document.documentElement.className, hist: history.state }));
const d = await drag(page, 100, 700, 200, 700, 200, 8);
await d.end(); await sleep(1500);
console.log('after drag', JSON.stringify(await st()), await page.evaluate(() => document.querySelector('#cap .idx').textContent));
await page.touchscreen.tap(195, 250); // tap projection
await sleep(250);
console.log('open +250ms', JSON.stringify(await st()));
// scroll natively mid-open
const sc = await drag(page, 200, 600, 200, 300, 150, 6); await sc.end();
await sleep(1600);
console.log('open settled', JSON.stringify(await st()));
await page.evaluate(() => scrollTo(0, 260)); await sleep(100);
console.log('scrolled', JSON.stringify(await st()));
await page.click('#close'); await sleep(120);
console.log('close +120ms', JSON.stringify(await st()));
await sleep(1500);
console.log('closed', JSON.stringify(await st()));
await page.touchscreen.tap(195, 250); await sleep(300);
await page.goBack(); await sleep(200);
console.log('back mid-open', JSON.stringify(await st()));
await sleep(1500);
console.log('after back', JSON.stringify(await st()));
// interrupt: open, then tap hero mid-way to close
await page.touchscreen.tap(195, 250); await sleep(260);
await page.touchscreen.tap(195, 300); await sleep(1600);
console.log('interrupt', JSON.stringify(await st()));
await page.keyboard.press('ArrowRight'); await sleep(1000);
console.log('key', await page.evaluate(() => document.querySelector('#cap .idx').textContent));
console.log(logs.filter((l) => !/vite|404/.test(l)).join('\n'));
await b.close();
