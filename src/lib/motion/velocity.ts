/**
 * Pointer velocity estimate. Keeps the recent samples and fits a straight line x(t) by least squares over the last
 * VELOCITY_WINDOW_MS before the query time. A fit (not "last two points") is what makes the number steady on 60 Hz touch
 * input with jittery timestamps; the short window is what makes it describe the flick instead of the whole drag.
 * Result is px/ms. A pause longer than STALE_MS before lift-off gives 0: the finger had already stopped.
 */
export const VELOCITY_WINDOW_MS = 90;
/** fewer samples than this inside the window is not an estimate, it is noise */
const MIN_SAMPLES = 2;
/** if the newest sample is older than this at query time, treat the pointer as stopped */
export const STALE_MS = 60;

export interface TimedPoint {
  t: number;
  x: number;
  y: number;
}

/** least-squares slope of vs over ts; 0 when degenerate */
export function slope(ts: number[], vs: number[]): number {
  const n = ts.length;
  if (n < MIN_SAMPLES) return 0;
  let mt = 0;
  let mv = 0;
  for (let i = 0; i < n; i++) {
    mt += ts[i];
    mv += vs[i];
  }
  mt /= n;
  mv /= n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dt = ts[i] - mt;
    num += dt * (vs[i] - mv);
    den += dt * dt;
  }
  return den < 1e-9 ? 0 : num / den;
}

/** velocity (px/ms) of the points inside [now - windowMs, now]; points are time-ordered */
export function estimateVelocity(points: readonly TimedPoint[], now: number, windowMs = VELOCITY_WINDOW_MS): { vx: number; vy: number; n: number } {
  const ts: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (p.t > now) continue;
    if (now - p.t > windowMs) break;
    ts.push(p.t);
    xs.push(p.x);
    ys.push(p.y);
  }
  if (ts.length < MIN_SAMPLES || now - ts[0] > STALE_MS) return { vx: 0, vy: 0, n: ts.length };
  return { vx: slope(ts, xs), vy: slope(ts, ys), n: ts.length };
}

export class VelocityTracker {
  private pts: TimedPoint[] = [];
  constructor(private windowMs = VELOCITY_WINDOW_MS) {}
  reset() {
    this.pts.length = 0;
  }
  add(t: number, x: number, y: number) {
    this.pts.push({ t, x, y });
    // keep a little more than the window; the rest can never matter again
    const cut = t - this.windowMs * 2;
    let i = 0;
    while (i < this.pts.length - 2 && this.pts[i].t < cut) i++;
    if (i) this.pts.splice(0, i);
  }
  at(now: number) {
    return estimateVelocity(this.pts, now, this.windowMs);
  }
}
