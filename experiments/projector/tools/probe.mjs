// node tools/probe.mjs <set> <flags,comma> <out.jpg> : screenshot at rest with debug flags (nobeam,nodust)
import { launch, open, shot, sleep } from './lib.mjs';
const [set = 'bonnet', flags = '', out = '/tmp/probe.jpg'] = process.argv.slice(2);
const b = await launch();
const { page } = await open(b, set, {});
await page.evaluate((f) => { window.__flags = Object.fromEntries(f.split(',').filter(Boolean).map((k) => [k, true])); window.__pj.step(0); }, flags);
await sleep(300);
await shot(page, out);
await b.close();
