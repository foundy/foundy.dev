// Measures what rendering BOTH worlds into FBOs + the compositor costs on the transition frames, against one world on the canvas.
// usage: node e2e/switch-cost.mjs [--no-build]   (Chromium, ANGLE/Metal; the app reads one pixel back per frame under ?debug&cost, so ms = CPU + GPU)
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv.includes('--no-build')) spawnSync('npx', ['vite', 'build'], { cwd: root, stdio: 'ignore' });
const port = await new Promise((res) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => res(p));
  });
});
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore', detached: true });
const stop = () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}
};
process.on('exit', stop);
const BASE = `http://127.0.0.1:${port}/bonnet/`;
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(BASE)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stat = (a) => {
  if (!a.length) return 'n/a';
  const s = [...a].sort((x, y) => x - y);
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return `mean ${m.toFixed(1)} ms  p95 ${s[Math.floor(s.length * 0.95)].toFixed(1)}  max ${s[s.length - 1].toFixed(1)}  (n=${a.length})`;
};
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
for (const [label, vp, dsf] of [['390x844 @2x', { width: 390, height: 844 }, 2], ['430x932 @3x (capped to dpr 2 by MAX_DPR/MAX_PIXELS)', { width: 430, height: 932 }, 3], ['1280x800 @2x', { width: 1280, height: 800 }, 2]]) {
  for (const osc of ['auto', '1', '0.75']) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: dsf, hasTouch: true, isMobile: vp.width < 600 });
    const page = await ctx.newPage();
    await page.goto(`${BASE}?debug&cost&world=light${osc === 'auto' ? '' : '&osc=' + osc}`);
    await page.waitForFunction(() => window.__bonnet && window.__bonnet.gl === 'on');
    await sleep(2500);
    // light on canvas: poke the world so it renders
    await page.click('#next');
    await sleep(900);
    const light1 = (await page.evaluate(() => window.__bonnet)).cost.one.slice(-20);
    await page.click('[data-w=water]');
    await sleep(2200);
    await page.click('[data-w=light]');
    await sleep(2200);
    const st = await page.evaluate(() => window.__bonnet);
    const dpr = await page.evaluate(() => document.getElementById('gl').width / innerWidth);
    console.log(`${label} osc=${osc} (canvas dpr ${dpr.toFixed(2)})\n   one world on canvas (browse frames): ${stat(st.cost.one)}\n   transition frames (both FBOs + compositor): ${stat(st.cost.sw)}`);
    void light1;
    await ctx.close();
  }
}
await browser.close();
stop();
