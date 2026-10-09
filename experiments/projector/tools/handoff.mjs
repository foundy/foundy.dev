// Hand-off continuity: last GL frame (p->1) vs first DOM frame. Prints mean/max abs diff over the hero rect (0..255).
import { launch, open, sleep } from './lib.mjs';
const set = process.argv[2] || 'bonnet';
const b = await launch();
const { page, ctx } = await open(b, set, {});
await page.evaluate(() => window.__pj.open());
await sleep(100);
await page.evaluate(() => window.__pj.hold(0.9899));
await sleep(300);
const rect = await page.evaluate(() => { const r = document.querySelector('#hero').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
const A = await page.screenshot({ type: 'png', clip: rect });
await page.evaluate(() => window.__pj.hold(1));
await sleep(600);
const h = await page.evaluate(() => window.__pj.handed);
const B = await page.screenshot({ type: 'png', clip: rect });
import('node:fs').then((f) => { f.writeFileSync('/tmp/hA.png', A); f.writeFileSync('/tmp/hB.png', B); });
const p2 = await ctx.newPage();
await p2.goto('about:blank');
const res = await p2.evaluate(async ([a, b]) => {
  const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + s; });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(ia, 0, 0); const da = x.getImageData(0, 0, c.width, c.height).data;
  x.drawImage(ib, 0, 0); const db = x.getImageData(0, 0, c.width, c.height).data;
  let s = 0, m = 0, big = 0;
  for (let i = 0; i < da.length; i += 4) for (let k = 0; k < 3; k++) { const d = Math.abs(da[i + k] - db[i + k]); s += d; if (d > m) m = d; if (d > 12) big++; }
  return { mean: s / (da.length * 0.75), max: m, pxOver12: big / (da.length / 4) };
}, [A.toString('base64'), B.toString('base64')]);
console.log(set, 'handed', h, JSON.stringify(res));
await b.close();
