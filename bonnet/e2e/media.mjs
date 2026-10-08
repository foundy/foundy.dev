// Records the review videos (mobile 390x844, CDP touch with a finger indicator) and screenshots into docs/media/.
// usage: node e2e/media.mjs [baseUrl=http://127.0.0.1:5199/bonnet/]
import { chromium } from 'playwright';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cardRect, drag, sleep, tapAt, waitMode } from './lib.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:5199/bonnet/';
const out = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'docs/media');
const tmp = '/tmp/bonnet-video';
await mkdir(out, { recursive: true });
await rm(tmp, { recursive: true, force: true });
const browser = await chromium.launch();

const finger = () => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;top:0;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;background:rgba(30,20,10,.28);border:2px solid rgba(255,255,255,.85);z-index:99999;pointer-events:none;display:none;box-shadow:0 2px 10px rgba(0,0,0,.25)';
  const add = () => document.body.append(d);
  document.body ? add() : addEventListener('DOMContentLoaded', add);
  const mv = (e) => {
    if (e.pointerType !== 'touch') return;
    d.style.display = 'block';
    d.style.transform = `translate(${e.clientX}px,${e.clientY}px)`;
  };
  addEventListener('pointerdown', mv, true);
  addEventListener('pointermove', mv, true);
  for (const t of ['pointerup', 'pointercancel']) addEventListener(t, () => (d.style.display = 'none'), true);
};

async function session(name, run) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
    recordVideo: { dir: tmp, size: { width: 390, height: 844 } },
  });
  await ctx.addInitScript(finger);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const h = { ctx, page, cdp, mobile: true };
  await page.goto(base);
  await page.waitForFunction(() => window.__bonnet);
  await sleep(700);
  await run(h);
  await sleep(500);
  const video = page.video();
  await ctx.close();
  const file = path.join(out, `${name}.webm`);
  await rename(await video.path(), file);
  console.log(name, Math.round((await stat(file)).size / 1024) + 'KB');
}
const shot = (h, name) => h.page.screenshot({ path: path.join(out, name), type: 'jpeg', quality: 80 });
const D = { paced: true };

await session('1-deck-swipe', async (h) => {
  const r = await cardRect(h.page, 0);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  await sleep(500);
  await drag(h, [[cx + 60, cy], [cx - 120, cy, 520]], { ...D, hold: 90 }); // slow drag, passes half a card
  await sleep(900);
  await drag(h, [[cx + 40, cy], [cx - 60, cy, 70]], D); // short flick
  await sleep(900);
  await drag(h, [[cx - 110, cy], [cx + 140, cy, 70]], D); // flick back
  await sleep(900);
  await drag(h, [[cx + 120, cy], [cx - 220, cy, 80]], D); // strong flick: skips two
  await sleep(1000);
  await drag(h, [[cx - 40, cy], [cx + 140, cy, 400]], { ...D, hold: 200 }); // small drag, lets go: springs back
  await sleep(900);
  await tapAt(h, 307, 725); // next button
  await sleep(900);
  await drag(h, [[cx - 100, cy], [cx + 160, cy, 400]], { ...D, hold: 150 }); // rubber band at the end
  await sleep(1000);
});

await session('2-open-and-angles', async (h) => {
  const r = await cardRect(h.page, 0);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  await shot(h, '1-deck.jpg');
  await sleep(500);
  await tapAt(h, cx, cy);
  await waitMode(h.page, 'open');
  await sleep(900);
  await shot(h, '2-detail.jpg');
  await drag(h, [[cx + 90, 320], [cx - 70, 322, 500]], { ...D, hold: 100 }); // scrub to the right view
  await sleep(900);
  await drag(h, [[cx + 110, 320], [cx - 100, 322, 90]], D); // flick on to the back
  await sleep(1100);
  await drag(h, [[cx - 100, 320], [cx + 120, 322, 90]], D);
  await sleep(1000);
  await drag(h, [[cx, 700], [cx, 260, 450]], D); // scroll the document
  await sleep(1000);
  await drag(h, [[cx, 300], [cx, 780, 450]], D);
  await sleep(1000);
});

await session('3-pull-down-close', async (h) => {
  const r = await cardRect(h.page, 0);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  await tapAt(h, cx, cy);
  await waitMode(h.page, 'open');
  await sleep(900);
  await drag(h, [[cx, 300], [cx + 8, 380, 700]], { ...D, hold: 600, onHold: () => shot(h, '3-pull-mid.jpg') }); // partial: stays
  await sleep(1000);
  await drag(h, [[cx, 300], [cx + 20, 600, 700]], D); // slow, far: closes
  await waitMode(h.page, 'closed');
  await sleep(1800); // the full way back to the deck
  await tapAt(h, cx, cy);
  await waitMode(h.page, 'open');
  await sleep(800);
  await drag(h, [[cx, 300], [cx + 6, 390, 80]], D); // short fast flick: closes
  await waitMode(h.page, 'closed');
  await sleep(1800);
  await tapAt(h, cx, cy);
  await sleep(160);
  await drag(h, [[cx, 300], [cx - 12, 440, 300]], { ...D, hold: 120 }); // grab it mid-open and send it back
  await sleep(1200);
});

await session('4-color-switch-and-close', async (h) => {
  const r = await cardRect(h.page, 0);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  await tapAt(h, cx, cy);
  await waitMode(h.page, 'open');
  await sleep(700);
  await drag(h, [[cx, 700], [cx, 380, 420]], D);
  await sleep(700);
  const sw = (i) => h.page.evaluate((k) => {
    const b = document.querySelector(`.sw[data-i="${k}"]`).getBoundingClientRect();
    return [b.left + b.width / 2, b.top + b.height / 2];
  }, i);
  let [x, y] = await sw(3);
  await tapAt(h, x, y);
  await sleep(900);
  [x, y] = await sw(4);
  await tapAt(h, x, y);
  await sleep(900);
  await drag(h, [[cx, 300], [cx, 760, 400]], D); // back to the top
  await sleep(900);
  await tapAt(h, 346, 36); // close button
  await waitMode(h.page, 'closed');
  await sleep(1200);
});

// desktop screenshot
const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const dp = await dctx.newPage();
await dp.goto(base + '#moss');
await dp.waitForFunction(() => window.__bonnet);
await sleep(900);
await dp.screenshot({ path: path.join(out, '4-desktop-detail.jpg'), type: 'jpeg', quality: 80 });
await dctx.close();
await browser.close();
