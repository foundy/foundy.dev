// Frame-by-frame inspection of the world-switch transitions at 1/5 speed (?tscale), as a contact sheet.
// usage: node e2e/switch-frames.mjs [--no-build] [--dir=l2w|w2l|both] [--set=bonnet|mixed] [--out=/tmp/dir] [--n=24]
// Output: <out>/<kind>-NN.png (390x844 @1x) and <out>/<kind>-sheet.png. Dev tool, not part of the test run.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const out = arg('out', '/tmp/bonnet-frames');
const which = arg('dir', 'both');
const set = arg('set', 'bonnet');
const N = +arg('n', 24);
mkdirSync(out, { recursive: true });
if (!process.argv.includes('--no-build')) {
  if (spawnSync('npx', ['vite', 'build'], { cwd: root, stdio: 'ignore' }).status !== 0) process.exit(1);
}
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
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });

for (const kind of which === 'both' ? ['l2w', 'w2l'] : [which]) {
  const from = kind === 'l2w' ? 'light' : 'water';
  const to = kind === 'l2w' ? 'water' : 'light';
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await page.goto(`${BASE}?debug&set=${set}&world=${from}&tscale=0.2`);
  await page.waitForFunction(() => window.__bonnet && window.__bonnet.gl === 'on', null, { timeout: 15000 });
  await page.addStyleTag({ content: '#dbg{display:none!important}' });
  await sleep(2500); // let the first world settle at the slow clock
  await page.click(`[data-w=${to}]`);
  const files = [];
  for (let i = 0; i < N; i++) {
    const st = await page.evaluate(() => window.__bonnet);
    if (st.sw === null && i > 2) break;
    const f = path.join(out, `${kind}-${String(i).padStart(2, '0')}.png`);
    await page.screenshot({ path: f });
    files.push([f, st.swU]);
    await sleep(60);
  }
  // contact sheet
  const cols = 6, w = 195, h = 422;
  const rows = Math.ceil(files.length / cols);
  const comps = await Promise.all(files.map(async ([f, u], i) => ({ input: await sharp(f).resize(w, h).toBuffer(), left: (i % cols) * w, top: Math.floor(i / cols) * h })));
  await sharp({ create: { width: cols * w, height: rows * h, channels: 3, background: '#222' } }).composite(comps).png().toFile(path.join(out, `${kind}-sheet.png`));
  console.log(kind, files.map(([, u]) => (u == null ? 'end' : u.toFixed(2))).join(' '), errs.length ? 'ERR ' + errs.join('|') : 'no errors');
  await ctx.close();
}
await browser.close();
stop();
