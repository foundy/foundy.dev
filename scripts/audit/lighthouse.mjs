// Lighthouse over the built site: 4 pages x (mobile, desktop). Prints a table + first-view transfer breakdown and
// writes docs/qa/lighthouse.json. usage: node scripts/audit/lighthouse.mjs [baseUrl=http://127.0.0.1:4731] [runs=1]
// Uses Playwright's Chromium as the browser. Raw reports go to .tmp-p7/ (git-ignored); the summary is committed.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [base = 'http://127.0.0.1:4731', runs = '1'] = process.argv.slice(2);
const pages = ['/', '/work/hero-shader/', '/work/card-study/', '/lab/'];
mkdirSync('.tmp-p7', { recursive: true });
mkdirSync('docs/qa', { recursive: true });
const chrome = chromium.executablePath();
const kb = (n) => Math.round(n / 1024);
const rows = [];

for (const preset of ['mobile', 'desktop']) {
  for (const path of pages) {
    const all = [];
    for (let i = 0; i < Number(runs); i++) {
      const out = `.tmp-p7/lh-${preset}-${path.replace(/\W+/g, '_')}-${i}.json`;
      const args = ['lighthouse', base + path, '--output=json', `--output-path=${out}`, '--quiet', '--chrome-flags=--headless=new --no-sandbox', '--only-categories=performance,accessibility,best-practices,seo'];
      if (preset === 'desktop') args.push('--preset=desktop');
      const r = spawnSync('npx', args, { env: { ...process.env, CHROME_PATH: chrome }, encoding: 'utf8' });
      if (r.status !== 0) {
        console.error('lighthouse failed', preset, path, r.stderr.slice(0, 400));
        continue;
      }
      all.push(JSON.parse(readFileSync(out, 'utf8')));
    }
    if (!all.length) continue;
    // median run by LCP
    all.sort((a, b) => a.audits['largest-contentful-paint'].numericValue - b.audits['largest-contentful-paint'].numericValue);
    const j = all[Math.floor(all.length / 2)];
    const a = j.audits;
    const reqs = a['network-requests'].details.items.filter((x) => x.statusCode === 200 || x.statusCode === 304);
    const by = { html: 0, css: 0, font: 0, js: 0, image: 0, other: 0 };
    let sdf = 0;
    for (const q of reqs) {
      const t = q.resourceType;
      const size = q.transferSize || 0;
      if (/wordmark-sdf/.test(q.url)) sdf += size;
      if (t === 'Document') by.html += size;
      else if (t === 'Stylesheet') by.css += size;
      else if (t === 'Font') by.font += size;
      else if (t === 'Script') by.js += size;
      else if (t === 'Image') by.image += size;
      else by.other += size;
    }
    const row = {
      preset,
      path,
      perf: Math.round(j.categories.performance.score * 100),
      a11y: Math.round(j.categories.accessibility.score * 100),
      bp: Math.round(j.categories['best-practices'].score * 100),
      seo: Math.round(j.categories.seo.score * 100),
      fcp: Math.round(a['first-contentful-paint'].numericValue),
      lcp: Math.round(a['largest-contentful-paint'].numericValue),
      lcpEl: a['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node?.snippet?.slice(0, 70) ?? '',
      cls: +a['cumulative-layout-shift'].numericValue.toFixed(4),
      tbt: Math.round(a['total-blocking-time'].numericValue),
      si: Math.round(a['speed-index'].numericValue),
      maxFid: Math.round(a['max-potential-fid']?.numericValue ?? 0),
      transferKB: kb(a['total-byte-weight'].numericValue),
      breakdownKB: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, +(v / 1024).toFixed(1)])),
      sdfKB: +(sdf / 1024).toFixed(1),
      requests: reqs.length,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}
writeFileSync('docs/qa/lighthouse.json', JSON.stringify({ at: new Date().toISOString().slice(0, 10), base: 'astro preview of the production build', runs: Number(runs), rows }, null, 1) + '\n');
console.log('\npreset  page                 perf a11y bp seo  FCP   LCP   CLS   TBT  transfer');
for (const r of rows) console.log(`${r.preset.padEnd(7)} ${r.path.padEnd(20)} ${String(r.perf).padStart(4)} ${String(r.a11y).padStart(4)} ${String(r.bp).padStart(3)} ${String(r.seo).padStart(3)} ${String(r.fcp).padStart(5)} ${String(r.lcp).padStart(5)} ${String(r.cls).padStart(5)} ${String(r.tbt).padStart(4)}  ${r.transferKB} KB`);
