// Markdown tables from docs/spike/results.json (+ results-stress.json) for the write-up.
import { readFileSync } from 'node:fs';
const rows = JSON.parse(readFileSync('docs/spike/results.json', 'utf8'));
let stress = [];
try {
  stress = JSON.parse(readFileSync('docs/spike/results-stress.json', 'utf8'));
} catch {}
const short = (b) => b.replace(/ \d.*$/, '') + ' ' + (b.match(/\d+/)?.[0] ?? '');
const be = (b) => (b.startsWith('webgpu') ? 'WebGPU' : 'WebGL2');
const sel = (vp, ids) => rows.filter((r) => r.viewport === vp && ids.includes(r.case) && !r.error);

function table(title, vp, ids, cols) {
  console.log(`\n**${title}**\n`);
  console.log('| browser | page | backend | ' + cols.map((c) => c[0]).join(' | ') + ' |');
  console.log('|---|---|---|' + cols.map(() => '---:').join('|') + '|');
  for (const r of sel(vp, ids)) {
    console.log(`| ${short(r.browser)} | ${r.case} | ${be(r.backend)} | ${cols.map((c) => c[1](r)).join(' | ')} |`);
  }
}
const base = ['raw', 'three', 'three-gl2'];
for (const vp of ['desktop', 'mobile']) {
  const px = rows.find((r) => r.viewport === vp)?.canvasPx?.join('x');
  table(`Startup, ${vp} (canvas ${px} px)`, vp, base, [
    ['SDF bake ms', (r) => r.sdfMs],
    ['init ms', (r) => r.initMs],
    ['first frame after init ms', (r) => r.firstFrameAfterInitMs],
    ['first frame from nav start ms', (r) => r.ttffFromNavMs],
  ]);
  table(`Scripted pointer drag 5 s, ${vp}`, vp, base, [
    ['frames', (r) => r.drag.frames],
    ['median ms', (r) => r.drag.medianMs],
    ['p95 ms', (r) => r.drag.p95Ms],
    ['max ms', (r) => r.drag.maxMs],
    ['>20 ms', (r) => r.drag.over16_7],
    ['>33 ms', (r) => r.drag.over33],
    ['JS/frame ms', (r) => r.drag.cpuMedianMs],
  ]);
  table(`GPU-inclusive bench (back-to-back frames + readPixels sync, 3 s), ${vp}`, vp, base, [
    ['frames', (r) => r.bench.frames],
    ['median ms', (r) => r.bench.medianMs],
    ['p95 ms', (r) => r.bench.p95Ms],
    ['max ms', (r) => r.bench.maxMs],
  ]);
}
table('Looks (raw WebGL2), desktop', 'desktop', ['raw', 'raw-refract', 'raw-riso'], [
  ['init ms', (r) => r.initMs],
  ['drag p95 ms', (r) => r.drag.p95Ms],
  ['bench median ms', (r) => r.bench.medianMs],
  ['bench p95 ms', (r) => r.bench.p95Ms],
]);
console.log('\n**Stress: Chrome, desktop, DPR forced to 3 (4080x1768 px = 7.2 Mpx)**\n');
console.log('| page | backend | bench median ms | bench p95 ms | bench max ms | frames in 3 s |');
console.log('|---|---|---:|---:|---:|---:|');
for (const r of stress) console.log(`| ${r.case.replace('@dpr3', '')} | ${be(r.backend)} | ${r.bench.medianMs} | ${r.bench.p95Ms} | ${r.bench.maxMs} | ${r.bench.frames} |`);
console.log('\nGPU strings:');
for (const b of new Set(rows.map((r) => r.browser))) {
  for (const id of ['raw', 'three']) {
    const r = rows.find((x) => x.browser === b && x.case === id && x.viewport === 'desktop');
    if (r) console.log(`- ${short(b)} ${id}: backend=${r.backend}, navigator.gpu=${r.navigatorGpu}, ${r.gpu}`);
  }
}
