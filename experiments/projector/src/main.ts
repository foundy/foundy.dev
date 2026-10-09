import './style.css';
import { PRODUCTS, N_SLOTS, SET, imgUrl } from './data';
import { createGL, trayCam, type Frame } from './gl';
import { initDebug, DEBUG, hot } from './debug';

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const root = document.documentElement;
const canvas = $<HTMLCanvasElement>('#gl'), stage = $('#stage'), cap = $('#cap'), detail = $('#detail');
const hero = $<HTMLImageElement>('#hero'), slot = $('#slot'), capIdx = $('#cap .idx'), capTtl = $('#cap .ttl');
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
let reduce = reduceMQ.matches;
reduceMQ.addEventListener?.('change', () => (reduce = reduceMQ.matches));

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sm = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const NP = PRODUCTS.length, N = N_SLOTS;
const prodOf = (slotI: number) => ((slotI % N) + N) % N % NP;
const actOf = (pos: number) => (((Math.round(pos) % N) + N) % N);

// ---- state ------------------------------------------------------------------------------
let W = innerWidth, H = innerHeight, dpr = Math.min(2, devicePixelRatio || 1);
let pos = 0, vel = 0, target = 0, dragging = false;
let p = 0, pv = 0, pT = 0;
let handed = false, detailOn = false, closeFade = false, pushed = false;
let shown = 0, pending = 0, swapped = true, chT = -1e9, chShutter = 75, chAmp = 10, chBlur = 1, lastChange = -1e9, lastAct = 0;
let swapAt = 30, ready = 0, t0Ready = -1, nogl = false, wake = false;
const aspects: number[] = PRODUCTS.map(() => 1);
const avgS: [number, number, number] = [0.6, 0.55, 0.5];
let r: ReturnType<typeof createGL> | null = null;
const queue: [number, ImageBitmap][] = [];

try {
  r = createGL(canvas, NP, N, () => { nogl = true; fallback(); });
} catch (e) { console.warn(e); nogl = true; }

function fallback() {
  nogl = true; root.classList.add('nogl');
  const fb = $<HTMLImageElement>('#fb'); fb.src = imgUrl(PRODUCTS[shown].images[0]);
}
function size() {
  W = innerWidth; H = innerHeight; dpr = Math.min(2, devicePixelRatio || 1);
  r?.resize(W, H, dpr); sizeSlot(); kick();
}
function sizeSlot() {
  const a = aspects[shown], mw = Math.min(W - 32, 520), mh = H * 0.62;
  let w = mw, h = w / a; if (h > mh) { h = mh; w = h * a; }
  slot.style.width = w + 'px'; slot.style.height = h + 'px';
}

// ---- assets -------------------------------------------------------------------------------
PRODUCTS.forEach((pr, i) =>
  fetch(imgUrl(pr.images[0])).then((x) => x.blob()).then((b) => createImageBitmap(b)).then((bmp) => { aspects[i] = bmp.width / bmp.height; queue.push([i, bmp]); kick(); }).catch(() => {}),
);

// ---- caption / detail DOM -----------------------------------------------------------------
const pad = (n: number) => String(n).padStart(2, '0');
function setCaption(slotI: number, animate: boolean) {
  const pr = PRODUCTS[prodOf(slotI)];
  capIdx.textContent = `${pad(((slotI % N) + N) % N + 1)} / ${pad(N)}`;
  capTtl.textContent = pr.title;
  if (animate && !reduce) cap.animate([{ opacity: 0, transform: 'translateY(5px)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'none' }], { duration: 520, delay: 70, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' });
  else if (animate) cap.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, fill: 'backwards' });
}
function fillDetail() {
  const pr = PRODUCTS[shown];
  $('#d-idx').textContent = `${pad(actOf(pos) + 1)} / ${pad(N)}`;
  $('#d-title').textContent = pr.title; $('#d-price').textContent = pr.price; $('#d-desc').textContent = pr.desc;
  $('#d-extra').replaceChildren(...pr.images.slice(1).map((s) => { const i = new Image(); i.src = imgUrl(s); i.loading = 'lazy'; i.alt = ''; return i; }));
  $('#d-info').replaceChildren(...pr.details.flatMap(([k, v]) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = v.join(' / '); return [dt, dd]; }));
  hero.alt = pr.title;
}

// ---- change event -------------------------------------------------------------------------
function trigger(now: number, act: number) {
  const gap = now - lastChange; lastChange = now;
  const strobe = gap < 170;
  chShutter = strobe ? 30 : 75; chAmp = strobe ? 3 : 10; chBlur = strobe ? 0.3 : 1;
  chT = now; pending = prodOf(act); swapped = false;
  swapAt = reduce ? 0 : strobe ? 12 : chShutter * 0.4;
  try { navigator.vibrate?.(6); } catch { /* */ }
}

// ---- input ---------------------------------------------------------------------------------
const slotPx = () => { const c = trayCam(W, H, H * 0.815); return c.proj(0, 0, 1)[2] * (2 * Math.PI / N); }; // px per slot at the front
let pid = -1, downX = 0, downY = 0, downT = 0, downPos = 0, moved = false;
const samples: [number, number][] = [];
stage.addEventListener('pointerdown', (e) => {
  if (pid !== -1 || detailOn) return;
  pid = e.pointerId; downX = e.clientX; downY = e.clientY; downT = e.timeStamp; downPos = pos; moved = false; dragging = true; vel = 0; samples.length = 0;
  try { stage.setPointerCapture(pid); } catch { /* */ }
  root.classList.add('touched'); kick();
});
stage.addEventListener('pointermove', (e) => {
  if (e.pointerId !== pid) return;
  const dx = e.clientX - downX;
  if (Math.hypot(dx, e.clientY - downY) > 9) moved = true;
  pos = downPos - dx / slotPx();
  samples.push([e.timeStamp, pos]); while (samples.length > 2 && e.timeStamp - samples[0][0] > 90) samples.shift();
  kick();
});
function release(tap: boolean, e?: PointerEvent) {
  if (pid === -1) return;
  const was = pid; pid = -1; dragging = false;
  try { stage.releasePointerCapture(was); } catch { /* */ }
  if (tap && e && !moved && e.timeStamp - downT < 600) { onTap(e.clientX, e.clientY); return; }
  let v = 0;
  if (samples.length > 1) { const a = samples[0], b = samples[samples.length - 1]; if (b[0] > a[0]) v = ((b[1] - a[1]) / (b[0] - a[0])) * 1000; }
  vel = v;
  target = Math.round(pos + clamp(v * 0.17, -6, 6));
  kick();
}
stage.addEventListener('pointerup', (e) => { if (e.pointerId === pid) release(true, e); });
stage.addEventListener('pointercancel', () => release(false));
stage.addEventListener('lostpointercapture', () => release(false));
document.addEventListener('visibilitychange', () => { if (document.hidden) release(false); else kick(); });
function onTap(x: number, y: number) {
  if (y < H * 0.6 || Math.abs(x - W / 2) < W * 0.2) openDetail(); else step(x < W / 2 ? -1 : 1);
}
function step(d: number) { if (detailOn) return; target = Math.round(target) + d; kick(); }
$('#prev').addEventListener('click', () => step(-1));
$('#next').addEventListener('click', () => step(1));
$('#close').addEventListener('click', () => (pushed && history.state?.pr ? history.back() : closeDetail()));
// tap on the hero while the transition is still running retargets the spring (a fresh tap, never the opening tap's own click)
let sd: [number, number, number] | null = null;
slot.addEventListener('pointerdown', (e) => { sd = handed ? null : [e.pointerId, e.clientX, e.clientY]; });
slot.addEventListener('pointerup', (e) => { if (sd && sd[0] === e.pointerId && Math.hypot(e.clientX - sd[1], e.clientY - sd[2]) < 10 && !handed && detailOn) (pT === 1 ? (pushed ? history.back() : closeDetail()) : openDetail()); sd = null; });
slot.addEventListener('pointercancel', () => (sd = null));
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (detailOn) (pushed ? history.back() : closeDetail()); }
  else if (!detailOn && e.key === 'ArrowLeft') step(-1);
  else if (!detailOn && e.key === 'ArrowRight') step(1);
  else if (!detailOn && (e.key === 'Enter' || e.key === ' ') && document.activeElement === document.body) { e.preventDefault(); openDetail(); }
});
addEventListener('popstate', (e) => { if (e.state?.pr) openDetail(true); else if (detailOn) { pushed = false; closeDetail(); } });
addEventListener('resize', size);

// ---- open / close ------------------------------------------------------------------------------
function openDetail(fromPop = false) {
  if (!ready && !nogl) return;
  pT = 1;
  if (!detailOn) {
    if (pending !== shown) { prevShown = shown; shown = pending; swapped = true; }
    detailOn = true; closeFade = false; handed = false;
    fillDetail(); sizeSlot();
    hero.style.visibility = 'hidden'; hero.src = imgUrl(PRODUCTS[shown].images[0]); hero.decode().catch(() => {});
    root.classList.add('open'); root.classList.remove('solid'); scrollTo(0, 0);
    if (!fromPop) { history.pushState({ pr: 1 }, ''); pushed = true; } else pushed = true;
    if (nogl) { p = 1; pv = 0; finishOpen(); return; }
  }
  kick();
}
function closeDetail() {
  if (!detailOn) return;
  pT = 0; pushed = false;
  if (nogl) { p = 0; finishClose(); return; }
  if (handed) {
    // GL takes over from the DOM at exactly the same rect, then the DOM image goes away next frame
    handed = false; p = 0.99; pv = 0;
    canvas.style.visibility = 'visible';
    draw(performance.now(), true);
    requestAnimationFrame(() => { hero.style.visibility = 'hidden'; root.classList.remove('solid'); });
  }
  const rc = hero.getBoundingClientRect();
  closeFade = rc.bottom < 40 || rc.top > H - 40;
  kick();
}
function finishOpen() {
  hero.style.visibility = 'visible'; root.classList.add('solid');
  if (nogl) return;
  requestAnimationFrame(() => { canvas.style.visibility = 'hidden'; });
}
function finishClose() {
  detailOn = false; root.classList.remove('open', 'solid'); hero.style.visibility = 'hidden';
  canvas.style.visibility = 'visible'; closeFade = false;
}

// ---- frame -----------------------------------------------------------------------------------------
let raf = 0, tmo = 0, last = 0, lastDraw = 0;
function kick() {
  if (nogl || document.hidden) return;
  if (tmo) { clearTimeout(tmo); tmo = 0; }
  wake = true;
  if (!raf) raf = requestAnimationFrame(loop);
}
function spring(x: number, v: number, T: number, w: number, dt: number): [number, number] {
  const e = x - T, k = v + w * e, ex = Math.exp(-w * dt);
  return [T + (e + k * dt) * ex, (v - k * w * dt) * ex];
}
function animating(now: number) {
  return dragging || Math.abs(pos - target) > 1e-3 || Math.abs(vel) > 0.01 || p !== pT || Math.abs(pv) > 1e-3 || now - chT < 800 || queue.length > 0 || (t0Ready > 0 && now - t0Ready < 2200);
}
function loop(now: number) {
  raf = 0;
  const dt = clamp((now - (last || now - 16)) / 1000, 0, 0.05); last = now;
  if (queue.length) { const [i, b] = queue.shift()!; r?.setTex(i, b); b.close(); ready++; if (i === shown || ready === 1) { sizeSlot(); } if (ready === NP) { t0Ready = now; chT = now; lastChange = now - 1000; chShutter = 140; swapped = true; setCaption(actOf(pos), true); cap.classList.add('on'); } }
  // physics
  if (!dragging) { [pos, vel] = spring(pos, vel, target, 11, dt); if (Math.abs(pos - target) < 1e-3 && Math.abs(vel) < 0.01) { pos = target; vel = 0; } }
  else if (samples.length > 1) { const a = samples[0], b = samples[samples.length - 1]; vel = b[0] > a[0] ? ((b[1] - a[1]) / (b[0] - a[0])) * 1000 : 0; }
  if (p !== pT || pv) {
    [p, pv] = spring(p, pv, pT, pT ? 7.5 : 9, dt);
    if (Math.abs(p - pT) < (pT ? 0.0 : 0.0008) && Math.abs(pv) < 0.01 && !pT) { p = 0; pv = 0; }
    if (pT === 1 && p >= 0.99) { p = 1; pv = 0; }
  }
  const act = actOf(pos);
  if (act !== lastAct) { lastAct = act; if (!detailOn) trigger(now, act); }
  if (!swapped && now - chT >= swapAt) { prevShown = shown; shown = pending; swapped = true; setCaption(act, true); sizeSlot(); }
  draw(now, false);
  // hand-off to the DOM
  if (pT === 1 && p === 1 && !handed && detailOn) {
    handed = true;
    const go = () => finishOpen();
    hero.decode().then(go, go);
  }
  if (pT === 0 && p === 0 && detailOn) finishClose();
  if (handed) { if (DEBUG) hot(false); return; }
  const anim = animating(now) || wake;
  wake = false;
  if (DEBUG) hot(anim, now);
  if (anim) raf = requestAnimationFrame(loop);
  else if (!document.hidden) tmo = window.setTimeout(() => { tmo = 0; raf = requestAnimationFrame(loop); }, reduce ? 2000 : 34);
}

const lens: [number, number] = [0, 0];
function draw(now: number, _once: boolean) {
  if (nogl || !r) return;
  const t = now / 1000;
  const age = now - chT, pvis = Math.min(1, p * 1.0101);
  const g = reduce ? (pvis < 0.5 ? 0 : 1) : sm(0, 1, pvis) * 0.5 + pvis * 0.5;
  const light = sm(0.16, 0.98, pvis);
  // slide-change timeline (pure function of time since the change)
  let rush = 0, bright = 1, dy = 0, blur = 0, scale = 1, mixv = 0, texA = shown, texB = shown;
  if (reduce) {
    if (age < 300) { texA = prevShown; mixv = sm(0, 300, age); }
  } else if (age < 900) {
    if (age < chShutter) bright = age < swapAt ? 1 - sm(0, swapAt, age) : 0;
    else { const a = (age - chShutter) / 1000; bright = sm(0, 0.034, a); rush = chBlur * 0.28 * Math.exp(-a * 11); dy = -chAmp * Math.exp(-22 * a) * Math.cos(38 * a); blur = chBlur * (1 - sm(0, 0.27, a)) ** 2; scale = 1 + 0.02 * blur; }
  }
  if (!ready) bright = 0;
  const intro = t0Ready > 0 ? sm(0, 1.3, (now - t0Ready) / 1000) : 0;
  const flick = reduce ? 0 : (0.012 * Math.sin(t * 61) + 0.008 * Math.sin(t * 23.7 + 1.3) + 0.006 * Math.sin(t * 97.3) + 0.01 * Math.sin(t * 0.9)) * (1 - g);
  const a = aspects[shown];
  // wall quad
  const bw = Math.min(W * 0.84, 720, H * 0.46 * 1.2), bh = H * 0.46;
  let ww = bw, wh = ww / a; if (wh > bh) { wh = bh; ww = wh * a; }
  const cyW = H * 0.345, cx = W / 2;
  const wTop: [number, number, number] = [cx - (ww * 1.045) / 2, cx + (ww * 1.045) / 2, cyW - wh / 2];
  const wBot: [number, number, number] = [cx - (ww * 0.985) / 2, cx + (ww * 0.985) / 2, cyW + wh / 2];
  let top = wTop, bot = wBot, alpha = 1;
  if (detailOn) {
    const rc = hero.getBoundingClientRect();
    if (closeFade) { alpha = sm(0, 0.6, pvis); }
    else { const t2: [number, number, number] = [rc.left, rc.right, rc.top], b2: [number, number, number] = [rc.left, rc.right, rc.bottom]; top = wTop.map((v, i) => lerp(v, t2[i], g)) as [number, number, number]; bot = wBot.map((v, i) => lerp(v, b2[i], g)) as [number, number, number]; }
  }
  if (reduce) alpha *= Math.abs(2 * pvis - 1);
  // colour of the current slide
  const av = r.avgs[shown] ?? [0.6, 0.55, 0.5];
  for (let i = 0; i < 3; i++) avgS[i] += (av[i] - avgS[i]) * (1 - Math.exp(-5 * 0.016 * 3));
  const mx = Math.max(avgS[0], avgS[1], avgS[2], 0.3);
  const tint: [number, number, number] = [0, 1, 2].map((i) => lerp(i === 0 ? 1.0 : i === 1 ? 0.93 : 0.8, clamp(avgS[i] / mx), 0.38)) as [number, number, number];
  // tray + lens
  const kick = reduce ? 0 : (age < 400 ? 5 * Math.exp(-age / 70) * Math.sin(Math.min(age, 140) / 140 * Math.PI) * (chShutter > 50 ? 1 : 0.4) : 0);
  const trayCy = H * 0.815 + g * H * 0.5 + kick;
  const cam = trayCam(W, H, trayCy);
  const L = cam.proj(0, 0.72, 1.03);
  lens[0] = L[0]; lens[1] = L[1];
  const r0 = 0.155 * L[2];
  const s = sm(0.08, 0.92, pvis);
  const beamTL: [number, number] = [lerp(bot[0], -0.3 * W, s), lerp(bot[2], -0.2 * H, s)];
  const beamTR: [number, number] = [lerp(bot[1], 1.3 * W, s), lerp(bot[2], -0.2 * H, s)];
  const vB = lerp(top[2], -0.2 * H, s);
  const open = 1 - sm(0.5, 1, pvis);
  const flash = Math.sin(Math.PI * pvis) ** 2 * 0.5;
  const F: Frame = {
    t, W, H, light, projI: bright * (1 - light) * intro, quad: [(top[0] + top[1]) / 2, (top[2] + bot[2]) / 2, ((top[1] - top[0]) / 2) * clamp(alpha * 2), ((bot[2] - top[2]) / 2) * clamp(alpha * 2)],
    top, bot, texA, texB, mix: mixv, blur, bright: bright * (0.15 + 0.85 * intro) , vig: 1 - sm(0.2, 1, pvis), fringe: 1 - g, expo: (1 + 0.5 * flash + rush) * (1 + 0.5 * (1 - intro)), bloom: (0.85 + 1.2 * flash) * (1 - sm(0.8, 1, pvis)),
    dy: (dy + (reduce ? 0 : 0.3 * Math.sin(t * 41) + 0.2 * Math.sin(t * 17.3))) * (1 - g), scale, alpha, flick, seed: shown / NP, pos, vel, trayCy, avg: avgS as [number, number, number], tint, lens, r0, beamTL, beamTR,
    beamGain: (0.8 + rush) * bright * open * intro, dustFade: bright * open * intro, vB, grain: 1.0, vigPost: 0.85, still: reduce,
  };
  r.draw(F);
  // DOM follow-ups
  const ui = 1 - sm(0, 0.22, pvis);
  if (Math.abs(ui - uiLast) > 0.01) { uiLast = ui; document.body.style.setProperty('--ui', ui.toFixed(3)); }
  if (detailOn) { const tp = sm(0.55, 1, pvis); if (Math.abs(tp - tpLast) > 0.005) { tpLast = tp; detail.style.setProperty('--tp', tp.toFixed(3)); } }
}
let uiLast = -1, tpLast = -1, prevShown = 0;

// ---- boot --------------------------------------------------------------------------------------------
if (nogl) fallback();
size();
setCaption(0, false);
$('#setname').textContent = SET;
history.replaceState(null, '');
if (DEBUG) initDebug(() => `p ${p.toFixed(3)} pT ${pT} pos ${pos.toFixed(2)} sh ${shown} ${handed ? 'DOM' : 'GL'}`, r?.gpu ?? 'no-gl');
kick();
(window as unknown as { __pj: unknown }).__pj = { get p() { return p; }, get ready() { return ready; }, get handed() { return handed; }, open: () => openDetail(), close: () => closeDetail(), step, hold: (v: number) => { p = v; pT = v; pv = 0; kick(); } };
