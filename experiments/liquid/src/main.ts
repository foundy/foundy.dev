import './style.css';
import { BRAND, DEMO, FRAME_ASPECT, PRODUCTS, imgInfo, imgUrl, padCss, rgbCss } from './data';
import { LAYER_H, LAYER_WIDTH, Water, type Frame } from './water';
import { DEBUG, initDebug } from './debug';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const root = document.documentElement;
const canvas = $<HTMLCanvasElement>('gl');
const surface = $('surface');
const detail = $('detail');
const hero = $('hero');
const heroImg = $<HTMLImageElement>('heroImg');
const N = PRODUCTS.length;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const sstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- state
let W = innerWidth, H = innerHeight;
let s = 0, sv = 0, sTarget = 0;           // current-flow spring (product index space)
let p = 0, pv = 0, pTarget = 0;           // rise progress spring
let mode: 'browse' | 'detail' = 'browse';
let handed = false;                        // DOM hero shown, GL hidden
let handing = false;
let water: Water | null = null;
let layout = { pool: [0, 0, 0, 0] as [number, number, number, number], spacing: 0 };
let raf = 0, last = 0, acc = 0, awakeUntil = 0, simDirty = false, timeAnim = 0;
let ready = false;
const uploadQ: number[] = [];
let heroDecode: Promise<void> = Promise.resolve();
let dragging = false;
let lastIdx = -1;
let nextIdle = 0;
let pFrozen = false;

const SIM_HZ = 200, C2 = 0.42, DAMP = 0.9978;

function computeLayout() {
  W = innerWidth; H = innerHeight;
  const fh = Math.min(H * 0.56, (W * 0.78) / FRAME_ASPECT, 760);
  const fw = fh * FRAME_ASPECT;
  layout.pool = [W / 2, H * 0.465, fw, fh];
  layout.spacing = Math.min(W * 0.72, fw * 1.02 + 56);
}

const heroRect = (): [number, number, number, number] => {
  const r = hero.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2, r.width, r.height];
};

// ---------------------------------------------------------------- textures
const layerCanvas = document.createElement('canvas');
layerCanvas.width = LAYER_WIDTH; layerCanvas.height = LAYER_H;
async function loadLayer(i: number): Promise<HTMLCanvasElement> {
  const path = PRODUCTS[i].images[0];
  const info = imgInfo(path);
  const blob = await (await fetch(imgUrl(path))).blob();
  const bm = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = LAYER_WIDTH; c.height = LAYER_H;
  const g = c.getContext('2d')!;
  g.setTransform(1, 0, 0, -1, 0, LAYER_H); // GL row 0 = image bottom
  const gr = info.vertical ? g.createLinearGradient(0, 0, 0, LAYER_H) : g.createLinearGradient(0, 0, LAYER_WIDTH, 0);
  gr.addColorStop(0, rgbCss(info.c0)); gr.addColorStop(1, rgbCss(info.c1));
  g.fillStyle = gr; g.fillRect(0, 0, LAYER_WIDTH, LAYER_H);
  const k = Math.min(LAYER_WIDTH / bm.width, LAYER_H / bm.height);
  const dw = bm.width * k, dh = bm.height * k;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bm, (LAYER_WIDTH - dw) / 2, (LAYER_H - dh) / 2, dw, dh);
  bm.close();
  return c;
}

// ---------------------------------------------------------------- dom
const el = { idx: $('idx'), ttl: $('ttl'), sub: $('sub'), brand: $('brand'), hint: $('hint') };
el.brand.textContent = BRAND;
document.title = `${BRAND} - liquid surface`;
function setCaption(i: number) {
  if (i === lastIdx) return;
  lastIdx = i;
  const pr = PRODUCTS[i];
  const f = () => {
    el.idx.textContent = `${String(i + 1).padStart(2, '0')} / ${String(N).padStart(2, '0')}`;
    el.ttl.textContent = pr.title;
    el.sub.textContent = pr.price;
    el.ttl.parentElement!.classList.remove('sw');
  };
  el.ttl.parentElement!.classList.add('sw');
  setTimeout(f, 110);
  ($('prev') as HTMLButtonElement).disabled = i === 0;
  ($('next') as HTMLButtonElement).disabled = i === N - 1;
}

function fillDetail(i: number) {
  const pr = PRODUCTS[i];
  const info = imgInfo(pr.images[0]);
  hero.style.background = padCss(info);
  heroImg.src = imgUrl(pr.images[0]);
  heroImg.alt = pr.title;
  $('dIdx').textContent = `${String(i + 1).padStart(2, '0')} / ${String(N).padStart(2, '0')}`;
  $('dTitle').textContent = pr.title;
  $('dPrice').textContent = pr.price;
  $('dDesc').textContent = pr.desc;
  const more = $('dMore');
  more.textContent = '';
  const extra = pr.images.slice(1);
  (extra.length ? extra : pr.images).forEach((im) => {
    const inf = imgInfo(im);
    const d = document.createElement('div');
    d.className = 'm';
    d.style.background = padCss(inf);
    const g = document.createElement('img');
    g.loading = 'lazy'; g.decoding = 'async'; g.alt = ''; g.src = imgUrl(im);
    d.append(g);
    more.append(d);
  });
  const det = $('dDet');
  det.textContent = '';
  pr.details.forEach(([h, lines]) => {
    const d = document.createElement('div');
    const hh = document.createElement('h3'); hh.textContent = h;
    d.append(hh);
    lines.forEach((l) => { const q = document.createElement('p'); q.textContent = l; d.append(q); });
    det.append(d);
  });
  detail.style.setProperty('--tone', rgbCss(pr.tone));
  detail.style.setProperty('--ink', rgbCss(pr.ink));
}

// ---------------------------------------------------------------- wake / sleep
function wake(ms = 0) {
  awakeUntil = Math.max(awakeUntil, performance.now() + ms);
  if (!raf && water) { last = performance.now(); raf = requestAnimationFrame(tick); }
}
const kick = () => { simDirty = true; wake(); };

// ---------------------------------------------------------------- input
const ptrs = new Map<number, { x: number; y: number; t: number }>();
let primary = -1;
let down = { x: 0, y: 0, t: 0, s0: 0, idx0: 0, lock: '' as '' | 'x' | 'y', moved: 0 };
const samples: { t: number; s: number }[] = [];

function trail(x0: number, y0: number, x1: number, y1: number, dt: number) {
  if (!water || reduce) return;
  const d = Math.hypot(x1 - x0, y1 - y0);
  if (d < 0.5) return;
  const speed = d / Math.max(dt, 8) * 1000; // px/s
  const k = clamp(speed / 1800, 0, 1);
  const stepPx = 9;
  const n = Math.min(10, Math.ceil(d / stepPx));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    water.drop(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 23 + 10 * k, -(0.035 + 0.11 * k) * Math.min(1, d / n / stepPx + 0.25));
  }
  kick();
}

function poolHit(x: number, y: number) {
  const [cx, cy, w, h] = layout.pool;
  const d = (idx() - s) * layout.spacing;
  return Math.abs(x - (cx + d)) < w / 2 + 6 && Math.abs(y - cy) < h / 2 + 6;
}
const idx = () => clamp(Math.round(s), 0, N - 1);

function endDrag(commit: boolean) {
  if (primary < 0) return;
  dragging = false;
  if (commit && down.lock === 'x') {
    const n = samples.length;
    let v = 0;
    if (n > 1) {
      const a = samples[Math.max(0, n - 5)], b = samples[n - 1];
      if (b.t - a.t > 5) v = ((b.s - a.s) / (b.t - a.t)) * 1000;
    }
    sv = v;
    const proj = s + v * 0.16;
    sTarget = clamp(Math.round(proj), Math.max(0, down.idx0 - 1), Math.min(N - 1, down.idx0 + 1));
  } else if (down.lock === 'x') {
    sTarget = clamp(Math.round(s), 0, N - 1);
  }
  primary = -1;
  wake(600);
}

surface.addEventListener('pointerdown', (e) => {
  if (mode !== 'browse' && pTarget === 1) return;
  try { surface.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp });
  if (primary < 0) {
    primary = e.pointerId;
    down = { x: e.clientX, y: e.clientY, t: e.timeStamp, s0: s, idx0: idx(), lock: '', moved: 0 };
    samples.length = 0;
    dragging = true;
    sv = 0;
  }
  if (water && !reduce) { water.drop(e.clientX, e.clientY, 17, -0.3); kick(); }
  el.hint.classList.add('gone');
  wake(300);
});
surface.addEventListener('pointermove', (e) => {
  const pt = ptrs.get(e.pointerId);
  if (!pt) return;
  const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
  const list = evs.length ? evs : [e];
  for (const ev of list) {
    trail(pt.x, pt.y, ev.clientX, ev.clientY, ev.timeStamp - pt.t);
    pt.x = ev.clientX; pt.y = ev.clientY; pt.t = ev.timeStamp;
  }
  if (e.pointerId !== primary) return;
  const dx = e.clientX - down.x, dy = e.clientY - down.y;
  down.moved = Math.max(down.moved, Math.hypot(dx, dy));
  if (!down.lock && Math.hypot(dx, dy) > 3) down.lock = Math.abs(dx) >= Math.abs(dy) * 0.9 ? 'x' : 'y';
  if (down.lock === 'x') {
    let ns = down.s0 - dx / layout.spacing;
    if (ns < 0) ns = ns * 0.35; else if (ns > N - 1) ns = N - 1 + (ns - (N - 1)) * 0.35;
    s = ns; sTarget = ns;
    samples.push({ t: e.timeStamp, s });
    if (samples.length > 12) samples.shift();
    wake(300);
  }
});
const up = (e: PointerEvent) => {
  const had = ptrs.delete(e.pointerId);
  if (!had) return;
  if (e.pointerId === primary) {
    const isTap = down.lock === '' && down.moved < 10 && e.timeStamp - down.t < 650 && e.type === 'pointerup';
    endDrag(e.type === 'pointerup');
    if (isTap && poolHit(e.clientX, e.clientY) && Math.abs(s - idx()) < 0.2) open();
  }
};
surface.addEventListener('pointerup', up);
surface.addEventListener('pointercancel', up);
surface.addEventListener('lostpointercapture', (e) => { if (ptrs.has(e.pointerId)) up(e as PointerEvent); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { ptrs.clear(); if (primary >= 0) endDrag(false); } else wake(500); });

function go(dir: 1 | -1) {
  if (mode !== 'browse' || pTarget !== 0) return;
  const t = clamp(Math.round(sTarget) + dir, 0, N - 1);
  if (t === sTarget) return;
  if (noGL) { s = sTarget = t; setCaption(t); fbShow(true); return; }
  sTarget = t;
  el.hint.classList.add('gone');
  kick();
}
$('prev').addEventListener('click', () => go(-1));
$('next').addEventListener('click', () => go(1));
$('back').addEventListener('click', () => requestClose());
addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') go(1);
  else if (e.key === 'ArrowLeft') go(-1);
  else if (e.key === 'Enter' && mode === 'browse' && (document.activeElement as HTMLElement | null)?.tagName !== 'BUTTON') open();
  else if (e.key === 'Escape') requestClose();
});
addEventListener('popstate', () => { if (mode === 'detail') doClose(); });
addEventListener('resize', () => { computeLayout(); if (water) water.resize(W, H, devicePixelRatio); wake(200); });

// ---------------------------------------------------------------- open / close
function setPointerModes() {
  root.classList.toggle('tgt1', pTarget === 1);
}

function open() {
  if (mode !== 'browse' || pTarget === 1) return;
  mode = 'detail'; pTarget = 1;
  const i = idx();
  s = sTarget = i; sv = 0;
  fillDetail(i);
  detail.hidden = false;
  detail.style.opacity = '0';
  root.classList.add('detail');
  window.scrollTo(0, 0);
  heroDecode = heroImg.decode().catch(() => {});
  hero.style.visibility = 'hidden';
  handed = false; handing = false;
  try { history.pushState({ d: 1 }, ''); } catch { /* ignore */ }
  setPointerModes();
  if (reduce || !water) {
    p = pv = 1; quickOpen();
    return;
  }
  kick();
}

function quickOpen() {
  detail.classList.add('q');
  root.style.setProperty('--chrome', '0');
  detail.style.opacity = '1';
  root.style.background = rgbCss(PRODUCTS[idx()].tone);
  hero.style.visibility = 'visible';
  handed = true;
  canvas.style.visibility = 'hidden';
  fbShow(false);
}

function requestClose() {
  if (mode !== 'detail') return;
  if (history.state && history.state.d) history.back();
  else doClose();
}

function doClose() {
  if (mode !== 'detail') return;
  mode = 'browse'; pTarget = 0;
  setPointerModes();
  const hr = heroRect();
  const vis = hr[1] + hr[3] / 2 > 0 && hr[1] - hr[3] / 2 < H && Math.min(hr[1] + hr[3] / 2, H) - Math.max(hr[1] - hr[3] / 2, 0) > hr[3] * 0.5;
  if (reduce || !water || !vis) {
    // short fade: detail fades out, water scene fades in
    detail.classList.add('q');
    root.style.setProperty('--chrome', '1');
    p = pv = 0;
    canvas.style.visibility = 'visible';
    root.style.background = '';
    if (water) { drawNow(); }
    detail.style.opacity = '0';
    fbShow(true);
    handed = false;
    setTimeout(() => finishClose(), 340);
    kick();
    return;
  }
  detail.classList.remove('q');
  // GL shows the hero at p=1 first, then the DOM hero hides next frame
  p = 1; pv = 0; pFrozen = true;
  canvas.style.visibility = 'visible';
  drawNow();
  requestAnimationFrame(() => {
    hero.style.visibility = 'hidden';
    root.style.background = '';
    handed = false; pFrozen = false;
    kick();
  });
}

function finishClose() {
  if (mode !== 'browse' || pTarget !== 0 || p > 0.001) return;
  detail.hidden = true;
  detail.classList.remove('q');
  root.classList.remove('detail');
  window.scrollTo(0, 0);
  hero.style.visibility = 'hidden';
}

// ---------------------------------------------------------------- frame
let noGL = false;
function frameObj(time: number): Frame {
  const cur = idx();
  const hr = p > 0 ? heroRect() : ([W / 2, H * 0.2, layout.pool[2], layout.pool[3]] as [number, number, number, number]);
  const pr = PRODUCTS[cur];
  const a = PRODUCTS[clamp(Math.floor(s), 0, N - 1)], b = PRODUCTS[clamp(Math.ceil(s), 0, N - 1)];
  const f = s - Math.floor(s);
  const mixc = (x: number[], y: number[]) => x.map((v, i) => v + (y[i] - v) * f) as [number, number, number];
  return {
    W, H, s, sv, cur, p: clamp(p, 0, 1), pool: layout.pool, hero: hr, poolRad: 10, heroRad: 10, spacing: layout.spacing,
    tone: pr.tone.slice() as [number, number, number], bgInk: mixc(a.ink, b.ink), reduce, time, dither: p < 0.995,
  };
}

function drawNow() {
  if (!water) return;
  const f = frameObj(timeAnim);
  water.render(f, false);
}

function fbShow(on: boolean) {
  if (!noGL) return;
  $('fb').hidden = !on;
  if (on) ($('fb').firstElementChild as HTMLImageElement).src = imgUrl(PRODUCTS[idx()].images[0]);
}

let prevP = 0;
function tick(now: number) {
  raf = 0;
  if (!water) return;
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  timeAnim += dt;
  dbgFrame(now);

  // upload one product layer per frame
  if (uploadQ.length) { const i = uploadQ.shift()!; uploadPending(i); }

  // springs (critically damped)
  const sub = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / sub;
  const ws = reduce ? 18 : 10.5, wp = 5.4;
  for (let k = 0; k < sub; k++) {
    if (!dragging) {
      sv += (-ws * ws * (s - sTarget) - 2 * ws * sv) * h;
      s += sv * h;
    }
    if (!pFrozen) {
      pv += (-wp * wp * (p - pTarget) - 2 * wp * pv) * h;
      p += pv * h;
    }
  }
  if (!dragging && Math.abs(s - sTarget) < 0.0004 && Math.abs(sv) < 0.004) { s = sTarget; sv = 0; }
  if (!pFrozen && Math.abs(p - pTarget) < 0.0006 && Math.abs(pv) < 0.004) { p = pTarget; pv = 0; }
  if (dragging) {
    // flow speed while dragging comes from the finger samples
    const b = samples[samples.length - 1];
    if (samples.length > 1 && now - b.t < 90) {
      const a = samples[Math.max(0, samples.length - 4)];
      if (b.t - a.t > 4) sv = ((b.s - a.s) / (b.t - a.t)) * 1000;
    } else sv = 0;
  }
  const ci = idx();
  setCaption(ci);

  // ----- stimuli
  const [pcx, pcy, pw, ph] = layout.pool;
  if (water && !reduce) {
    // wake behind the moving product
    const asv = Math.abs(sv);
    if (asv > 0.12 && mode === 'browse') {
      const xc = pcx + (ci - s) * layout.spacing * 0.92;
      const dir = Math.sign(sv);
      for (let k = 0; k < 2; k++) {
        const y = pcy + (Math.random() - 0.5) * ph * 0.9;
        water.drop(xc + dir * pw * 0.5 * 0.9, y, 16, -Math.min(0.03, asv * 0.008) * (0.6 + Math.random() * 0.8));
        water.drop(xc - dir * pw * 0.5 * 0.9, y, 12, Math.min(0.018, asv * 0.005));
      }
      simDirty = true;
    }
    // rise / sink coupling
    const hr = frameObj(timeAnim).hero;
    const rcx = p > 0 ? pcx + (hr[0] - pcx) * sstep(0, 1, p) : pcx;
    const rcy = p > 0 ? pcy + (hr[1] - pcy) * sstep(0, 1, p) : pcy;
    const rw = pw + (hr[2] - pw) * sstep(0, 1, p), rh = ph + (hr[3] - ph) * sstep(0, 1, p);
    let inside = 0, ring = 0;
    const crossUp = prevP < 0.34 && p >= 0.34, crossDn = prevP >= 0.34 && p < 0.34;
    if (p > 0.001 && p < 0.34 && pv > 0) inside = 0.0012 * clamp(pv, 0, 3.5);
    if (p > 0.34 && p < 0.8 && pv > 0.05) ring = -0.0035 * clamp(pv, 0, 3);
    if (crossUp) { ring = -0.22; water.drop(rcx, rcy, pw * 0.55, 0.0); for (let k = 0; k < 4; k++) water.drop(rcx + (Math.random() - 0.5) * rw, rcy + (Math.random() - 0.5) * rh * 0.5, 10 + Math.random() * 8, 0.35); }
    if (crossDn && pv < 0) {
      ring = 0.12;
      water.drop(rcx, rcy, pw * 0.5, -0.9);
      for (let k = 0; k < 5; k++) water.drop(rcx + (Math.random() - 0.5) * rw * 1.2, rcy + (Math.random() - 0.5) * rh * 0.9, 12 + Math.random() * 10, -0.4 - Math.random() * 0.3);
    }
    if (inside || ring) water.setRect(rcx, rcy, rw, rh, inside, ring, 10); else water.clearRect();
    if (inside || ring || crossUp || crossDn) simDirty = true;
    // a single quiet drop now and then
    if (mode === 'browse' && ready && now > nextIdle && p === 0 && !dragging) {
      nextIdle = now + 5200 + Math.random() * 4800;
      const top = Math.random() < 0.5;
      water.drop(W * (0.12 + Math.random() * 0.76), H * (top ? 0.06 + Math.random() * 0.1 : 0.82 + Math.random() * 0.1), 11, -0.14);
      simDirty = true;
    }
  }
  prevP = p;

  // chrome / detail visibility as pure functions of p
  const chrome = 1 - sstep(0, 0.28, p);
  root.style.setProperty('--chrome', chrome.toFixed(3));
  if (!detail.hidden && !detail.classList.contains('q')) {
    detail.style.opacity = String(sstep(0.5, 0.9, p));
  }

  // ----- sim + render
  const stepsF = Math.min(dt, 0.04) * SIM_HZ;
  acc += stepsF;
  const steps = Math.min(8, Math.floor(acc)); acc -= steps;
  if (simDirty) water.step(steps, C2, DAMP);
  if (!(handed && p === 1)) drawNow();

  // settle -> flatten + sleep
  const moving = dragging || s !== sTarget || p !== pTarget || Math.abs(sv) > 0 || Math.abs(pv) > 0;
  water.energy *= Math.pow(0.5, dt / 0.95);
  const stim = now < awakeUntil || water.energy > 0.012;
  // hand-off to the DOM hero
  if (!handed && !handing && p === 1 && pTarget === 1 && !pFrozen) {
    handing = true;
    heroDecode.then(() => {
      if (pTarget !== 1 || p !== 1) { handing = false; return; }
      hero.style.visibility = 'visible';
      root.style.background = rgbCss(PRODUCTS[idx()].tone);
      requestAnimationFrame(() => { canvas.style.visibility = 'hidden'; handed = true; handing = false; });
    });
  }
  if (p === 0 && pTarget === 0 && !detail.hidden && !detail.classList.contains('q')) finishClose();
  if (moving || stim || handing || uploadQ.length || (p === 1 && !handed)) { raf = requestAnimationFrame(tick); return; }
  if (simDirty) { water.flatten(); simDirty = false; water.clearRect(); drawNow(); }
  if (canvas.style.visibility !== 'hidden') drawNow();
}

// ---------------------------------------------------------------- debug hook
let dbgDeltas: number[] = [];
let dbgLast = 0;
function dbgFrame(t: number) {
  if (!DEBUG) return;
  if (dbgLast && t - dbgLast < 120) { dbgDeltas.push(t - dbgLast); if (dbgDeltas.length > 240) dbgDeltas.shift(); }
  dbgLast = t;
}

// ---------------------------------------------------------------- boot
async function uploadPending(i: number) {
  const c = layers[i];
  if (c && water) water.uploadLayer(i, c);
}
const layers: HTMLCanvasElement[] = [];

async function boot() {
  computeLayout();
  root.classList.add('browse');
  setCaption(0);
  el.hint.textContent = reduce ? 'tap to open' : 'touch the water';
  if (DEMO) el.hint.setAttribute('data-demo', DEMO);
  try {
    water = new Water(canvas, N, PRODUCTS.map((x) => x.ink));
    water.resize(W, H, devicePixelRatio);
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); toFallback(); });
  } catch (e) {
    console.warn('webgl unavailable', e);
    toFallback();
    return;
  }
  const loaded = await Promise.all(PRODUCTS.map((_, i) => loadLayer(i)));
  loaded.forEach((c, i) => (layers[i] = c));
  // upload one per frame, then reveal
  for (let i = 0; i < N; i++) { uploadQ.push(i); }
  ready = true;
  if (DEBUG) {
    initDebug(() => `p ${p.toFixed(3)} s ${s.toFixed(2)} sv ${sv.toFixed(2)}\nsim ${water!.simW}x${water!.simH} ${water!.mode}\n${water!.gpu}\n`, () => dbgDeltas);
    (window as unknown as Record<string, unknown>).__liquid = {
      open, requestClose, go, hold(v: number) { if (mode === 'browse') open(); p = pTarget = v; pv = 0; handed = false; handing = true; pFrozen = false; detail.style.opacity = String(sstep(0.5, 0.9, v)); canvas.style.visibility = 'visible'; hero.style.visibility = 'hidden'; wake(100); },
      drop(x: number, y: number, r = 18, st = -0.8) { water!.drop(x, y, r, st); kick(); },
      peek: () => water!.peek(),
      get st() { return { s, p, mode, handed }; },
    };
  }
  wake(100);
  const reveal = () => {
    if (uploadQ.length) { requestAnimationFrame(reveal); return; }
    requestAnimationFrame(() => {
      root.classList.add('ready');
      canvas.classList.add('on');
      if (!reduce && water) {
        const [cx, cy, w, h] = layout.pool;
        setTimeout(() => { water!.drop(cx, cy, w * 0.3, -0.07); kick(); }, 250);
        setTimeout(() => { water!.drop(cx - w * 0.2, cy + h * 0.28, 22, -0.22); water!.drop(cx + w * 0.3, cy - h * 0.3, 18, -0.16); kick(); }, 520);
      }
      nextIdle = performance.now() + 4500;
      setTimeout(() => root.classList.add('settled'), 3200);
      wake(500);
    });
  };
  reveal();
}

function toFallback() {
  water = null;
  noGL = true;
  root.classList.add('nogl', 'ready');
  canvas.style.display = 'none';
  const fb = $('fb');
  fb.hidden = false;
  fb.firstElementChild!.setAttribute('src', imgUrl(PRODUCTS[idx()].images[0]));
  fb.addEventListener('click', () => open());
}

boot();
