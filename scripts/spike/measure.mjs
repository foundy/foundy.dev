// Measurement matrix. Needs `npm run build && npx astro preview --port 4401` running.
// usage: node scripts/spike/measure.mjs [browsers=chrome,webkit,firefox] > docs/spike/results.json
import { chromium, webkit, firefox } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:4401';
const browsers = (process.argv[2] || 'chrome,webkit,firefox').split(',');
const DRAG_MS = 5000;
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null; // case ids
const VP = process.env.VP || null; // desktop|mobile
if (process.env.DSF) viewports_dsf(+process.env.DSF);
function viewports_dsf(n) { globalThis.__dsf = n; }

const viewports = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 },
};
const cases = [
  { id: 'raw', path: '/spike/raw/', q: '' },
  { id: 'three', path: '/spike/three/', q: '' },
  { id: 'three-gl2', path: '/spike/three/', q: '&gl=webgl2' },
  { id: 'raw-refract', path: '/spike/raw/', q: '&look=refract' },
  { id: 'raw-riso', path: '/spike/raw/', q: '&look=riso' },
];
// stress: DPR cap lifted to 3 on desktop (4080x1768 px) to expose GPU cost hidden by the 60 Hz cap
const stress = [
  { id: 'raw@dpr3', path: '/spike/raw/', q: '&dpr=3' },
  { id: 'three@dpr3', path: '/spike/three/', q: '&dpr=3' },
  { id: 'three-gl2@dpr3', path: '/spike/three/', q: '&dpr=3&gl=webgl2' },
];

if (globalThis.__dsf) viewports.desktop.deviceScaleFactor = globalThis.__dsf;

async function launch(name) {
  if (name === 'webkit') return webkit.launch();
  if (name === 'firefox') return firefox.launch();
  return chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
}

async function measure(browser, bname, vpName, c) {
  const ctx = await browser.newContext(viewports[vpName]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${BASE}${c.path}?hud=1${c.q}`, { waitUntil: 'load' });
  const row = { browser: bname, viewport: vpName, case: c.id };
  try {
    await page.waitForSelector('#gl[data-ready="1"]', { timeout: 30000 });
  } catch (e) {
    row.error = errors[0] || String(e.message).split('\n')[0];
    await ctx.close();
    return row;
  }
  const ttff = await page.evaluate(() => performance.now()); // since navigation start
  row.ttffFromNavMs = Math.round(ttff);
  const info = await page.evaluate(() => window.__spike.info);
  Object.assign(row, {
    backend: info.backend,
    gpu: info.gpu,
    canvasPx: info.canvasPx,
    dpr: info.dpr,
    sdfMs: +info.sdfMs.toFixed(1),
    initMs: +info.initMs.toFixed(1),
    firstFrameAfterInitMs: +info.firstFrameAfterInitMs.toFixed(1),
    navigatorGpu: await page.evaluate(() => !!navigator.gpu),
  });
  // scripted pointer drag: lissajous over the canvas for 5 s
  const r = await page.locator('#gl').boundingBox();
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__spike.resetStats());
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < DRAG_MS) {
    const t = (Date.now() - t0) / 1000;
    await page.mouse.move(
      r.x + r.width * (0.5 + 0.42 * Math.sin(t * 2.1)),
      r.y + r.height * (0.5 + 0.35 * Math.sin(t * 3.3 + 1)),
    );
    i++;
    await page.waitForTimeout(6);
  }
  const st = await page.evaluate(() => window.__spike.stats());
  row.drag = {
    frames: st.frames,
    medianMs: +st.median.toFixed(2),
    p95Ms: +st.p95.toFixed(2),
    maxMs: +st.max.toFixed(2),
    over16_7: st.over167,
    over33: st.over33,
    cpuMedianMs: +st.cpuMedian.toFixed(2),
    cpuP95Ms: +st.cpuP95.toFixed(2),
    moveEvents: i,
  };
  // GPU-inclusive: back-to-back frames awaiting GPU completion
  const b = await page.evaluate(() => window.__spike.bench(3000));
  row.bench = {
    frames: b.frames,
    medianMs: +b.median.toFixed(2),
    p95Ms: +b.p95.toFixed(2),
    maxMs: +b.max.toFixed(2),
    cpuMedianMs: +b.cpuMedian.toFixed(2),
  };
  if (errors.length) row.errors = errors.slice(0, 3);
  await ctx.close();
  return row;
}

const out = [];
for (const bname of browsers) {
  let browser;
  try {
    browser = await launch(bname);
  } catch (e) {
    out.push({ browser: bname, error: `launch failed: ${String(e.message).split('\n')[0]}` });
    continue;
  }
  const ver = browser.version();
  for (const vp of Object.keys(viewports).filter((v) => !VP || v === VP)) {
    for (const c of (vp === 'desktop' ? [...cases, ...stress] : cases).filter((c) => !ONLY || ONLY.includes(c.id))) {
      const row = await measure(browser, `${bname} ${ver}`, vp, c);
      console.error(JSON.stringify(row));
      out.push(row);
    }
  }
  await browser.close();
}
console.log(JSON.stringify(out, null, 1));
