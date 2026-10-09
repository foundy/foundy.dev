// ?debug overlay: fps, frame p50/p95, >33 ms ratio, p, sim res, GPU string. Inert without the flag.
export const DEBUG = new URLSearchParams(location.search).has('debug');

export function initDebug(info: () => string, deltas: () => number[]) {
  const pre = document.createElement('pre');
  pre.id = 'dbg';
  document.body.append(pre);
  setInterval(() => {
    const d = [...deltas()].sort((a, b) => a - b);
    const q = (x: number) => (d.length ? d[Math.min(d.length - 1, Math.floor(d.length * x))] : 0);
    const avg = d.length ? d.reduce((a, b) => a + b, 0) / d.length : 16.7;
    const slow = d.length ? d.filter((x) => x > 33.4).length / d.length : 0;
    pre.textContent = info() + `fps ${(1000 / avg).toFixed(0)}  p50 ${q(0.5).toFixed(1)}  p95 ${q(0.95).toFixed(1)} ms\n>33ms ${(slow * 100).toFixed(1)}%  (active frames only)`;
  }, 250);
}
