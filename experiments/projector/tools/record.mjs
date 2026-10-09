// node tools/record.mjs [outdir=media] [sets=bonnet,mixed] -> spin / open / close webm per set (CDP screencast -> ffmpeg VP9, <= 2 MB)
import { mkdirSync, mkdtempSync, statSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launch, open, sleep, drag } from './lib.mjs';
const out = process.argv[2] || 'media';
const sets = (process.argv[3] || 'bonnet,mixed').split(',');
mkdirSync(out, { recursive: true });
const b = await launch();
const swipe = async (page, x0, y0, x1, y1, ms) => { const d = await drag(page, x0, y0, x1, y1, ms, Math.max(4, Math.round(ms / 16))); await d.end(); };
async function clip(set, name, run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pjv-'));
  const { ctx, page } = await open(b, set, { settle: 600, dsf: 1 });
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', (f) => { frames.push({ t: f.metadata.timestamp, d: f.data }); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, everyNthFrame: 1, maxWidth: 390, maxHeight: 844 });
  const tStart = Date.now();
  const t0 = await run(page, () => (Date.now() - tStart) / 1000);
  await sleep(300);
  await cdp.send('Page.stopScreencast');
  await ctx.close();
  if (frames.length < 5) throw new Error('no frames');
  const list = [];
  frames.forEach((f, i) => { const fn = path.join(dir, `f${String(i).padStart(5, '0')}.jpg`); writeFileSync(fn, Buffer.from(f.d, 'base64')); list.push(`file '${fn}'\nduration ${Math.max(0.001, (frames[i + 1] ? frames[i + 1].t - f.t : 0.04)).toFixed(4)}`); });
  writeFileSync(path.join(dir, 'list.txt'), list.join('\n') + `\nfile '${path.join(dir, `f${String(frames.length - 1).padStart(5, '0')}.jpg`)}'\n`);
  const dst = path.join(out, `${set}-${name}.webm`);
  let crf = 34;
  for (;;) {
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'), '-ss', String(Math.max(0, t0)), '-an', '-vf', 'fps=30', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(crf), '-deadline', 'good', '-cpu-used', '3', dst]);
    if (r.status) console.log(String(r.stderr));
    const sz = statSync(dst).size;
    console.log(set, name, (sz / 1024).toFixed(0) + ' KB', 'crf', crf, 'frames', frames.length);
    if (sz <= 1.9 * 1024 * 1024 || crf > 55) break;
    crf += 4;
  }
  rmSync(dir, { recursive: true, force: true });
}
for (const set of sets) {
  await clip(set, 'spin', async (page, now) => {
    await sleep(1200); const t0 = now();
    await swipe(page, 320, 700, 60, 700, 160); await sleep(2000);
    await swipe(page, 80, 700, 330, 700, 700); await sleep(1500);
    await page.click('#next'); await sleep(900); await page.click('#next'); await sleep(900); await page.click('#prev'); await sleep(1200);
    await swipe(page, 300, 690, 40, 690, 110); await sleep(1800);
    return t0;
  });
  await clip(set, 'open', async (page, now) => {
    await sleep(1500); const t0 = now();
    await page.touchscreen.tap(195, 250); await sleep(2300);
    await swipe(page, 200, 650, 200, 250, 350); await sleep(700);
    await swipe(page, 200, 300, 200, 700, 350); await sleep(900);
    return t0 - 0.3;
  });
  await clip(set, 'close', async (page, now) => {
    await sleep(1200); await page.touchscreen.tap(195, 250); await sleep(2400);
    await swipe(page, 200, 650, 200, 520, 250); await sleep(500); const t0 = now();
    await page.click('#close'); await sleep(2000);
    return t0 - 0.5;
  });
}
await b.close();
