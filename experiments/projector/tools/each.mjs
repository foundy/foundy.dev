// rest shot for every product of a set -> /tmp/each/<set>-N.jpg
import { mkdirSync } from 'node:fs';
import { launch, open, sleep, shot } from './lib.mjs';
const set = process.argv[2] || 'mixed';
mkdirSync('/tmp/each', { recursive: true });
const b = await launch();
const { page } = await open(b, set, { dsf: 1 });
for (let i = 0; i < 6; i++) { await shot(page, `/tmp/each/${set}-${i}.jpg`); await page.click('#next'); await sleep(1500); }
await b.close();
