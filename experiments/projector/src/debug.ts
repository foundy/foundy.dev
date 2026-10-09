// ?debug overlay: fps, frame p50/p95, >33ms ratio, p, GPU. Inert without the flag.
export const DEBUG = new URLSearchParams(location.search).has('debug');
const deltas: number[] = [];
let lastT = 0, wasHot = false;
/** called once per frame; only frames adjacent to another animating frame are counted */
export function hot(anim: boolean, now = performance.now()) {
  if (anim && wasHot && lastT) { const d = now - lastT; if (d < 500) { deltas.push(d); if (deltas.length > 240) deltas.shift(); } }
  wasHot = anim; lastT = now;
}
export function initDebug(state: () => string, gpu: string) {
  const el = document.createElement('pre'); el.id = 'dbg'; document.body.append(el);
  (window as unknown as { __dbg: () => unknown }).__dbg = () => stats();
  setInterval(() => { const s = stats(); el.textContent = `fps ${s.fps}  p50 ${s.p50}  p95 ${s.p95}ms\n>33ms ${s.slow}%  n ${s.n}\n${state()}\n${gpu}`; }, 250);
}
function stats() {
  const a = [...deltas].sort((x, y) => x - y), n = a.length || 1, q = (f: number) => a[Math.min(a.length - 1, Math.floor(a.length * f))] ?? 0;
  const avg = a.reduce((x, y) => x + y, 0) / n;
  return { fps: +(1000 / (avg || 16.7)).toFixed(0), p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), slow: +((a.filter((d) => d > 33.4).length / n) * 100).toFixed(1), n: a.length };
}
