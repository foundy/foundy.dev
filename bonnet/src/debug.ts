// ?debug overlay. Entirely inert (and tree-cheap) without the flag. Listeners are passive and never alter behaviour.
import type { State } from './deck';

export const DEBUG = new URLSearchParams(location.search).has('debug');

let pending: { t: number; kind: string } | null = null;
const lat: number[] = [];
let lastLat = 0;
let lastKind = '-';

/** remember the first un-answered input; `t` is the event timestamp (performance.now() timeline) */
export function markInput(kind: string, t: number = performance.now()) {
  if (DEBUG && !pending) pending = { t, kind };
}

/** call after a render that visibly changed something; closes the pending input -> visual measurement */
export function markVisual() {
  if (!DEBUG || !pending) return;
  const p = pending;
  pending = null;
  requestAnimationFrame(() =>
    setTimeout(() => {
      lastLat = performance.now() - p.t;
      lastKind = p.kind;
      lat.push(lastLat);
      if (lat.length > 50) lat.shift();
    }, 0),
  );
}

export function initDebug(getState: () => State, extra: () => string = () => '', onReset: () => void = () => {}) {
  if (!DEBUG) return;
  const root = document.createElement('div');
  root.id = 'dbg';
  root.innerHTML = '<div class="dbg-bar"><button type="button" data-t>dbg</button><button type="button" data-r>reset</button></div><pre aria-hidden="true"></pre>';
  document.body.append(root);
  const pre = root.querySelector('pre')!;
  root.querySelector('[data-t]')!.addEventListener('click', () => root.classList.toggle('off'));

  // frames
  const deltas: number[] = [];
  let longest = 0;
  let last = performance.now();
  const frame = (t: number) => {
    const d = t - last;
    last = t;
    if (d < 1000) {
      deltas.push(d);
      if (deltas.length > 300) deltas.shift();
      if (d > longest) longest = d;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  root.querySelector('[data-r]')!.addEventListener('click', () => {
    longest = 0;
    onReset();
    deltas.length = 0;
    lat.length = 0;
    lastLat = 0;
    log.length = 0;
  });

  // events (observe only)
  const log: { label: string; n: number; t: number }[] = [];
  const push = (label: string) => {
    const l = log[log.length - 1];
    if (l && l.label === label) l.n++;
    else log.push({ label, n: 1, t: performance.now() });
    if (log.length > 14) log.shift();
  };
  const tgt = (e: Event) => {
    const el = e.target as Element | null;
    return el && el.nodeType === 1 ? (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '')) : '?';
  };
  for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'touchstart', 'touchend', 'touchcancel', 'click', 'contextmenu']) {
    window.addEventListener(t, (e) => push(`${t} ${tgt(e)}`), { capture: true, passive: true });
  }
  for (const t of ['pointermove', 'touchmove']) window.addEventListener(t, () => push(t), { capture: true, passive: true });
  window.addEventListener('scroll', () => push(`scroll y=${Math.round(scrollY)}`), { passive: true });

  setInterval(() => {
    if (root.classList.contains('off')) return;
    const n = deltas.length || 1;
    const avg = deltas.reduce((a, b) => a + b, 0) / n;
    const slow = deltas.filter((d) => d > 33.4).length / n;
    const la = lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : 0;
    const s = getState();
    const now = performance.now();
    const sorted = [...deltas].sort((a, b) => a - b);
    const q = (x: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * x))] : 0);
    pre.textContent =
      extra() +
      `raf p50 ${q(0.5).toFixed(1)} p95 ${q(0.95).toFixed(1)}ms\n` +
      `fps ${(1000 / (avg || 16.7)).toFixed(0)}  >33ms ${(slow * 100).toFixed(1)}%  stall ${longest.toFixed(0)}ms\n` +
      `input->visual ${lastLat.toFixed(0)}ms (${lastKind}) avg ${la.toFixed(0)} max ${Math.max(0, ...lat).toFixed(0)}\n` +
      `${s.page} c${s.color} a${s.angle} dye ${s.dye.from}>${s.dye.to} p${s.dye.p.toFixed(2)} o${Math.round(s.dye.origin.x)},${Math.round(s.dye.origin.y)}\n` +
      log.map((l) => `${(((now - l.t) / 1000) | 0).toString().padStart(3)}s ${l.label}${l.n > 1 ? ' x' + l.n : ''}`).join('\n');
  }, 200);
}
