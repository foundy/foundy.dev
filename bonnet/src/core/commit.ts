// Pure math shared by every world and the core: commit decision, drag tracking, critically damped spring.
// No DOM, no clock.

export const COMMIT_VELOCITY = 0.3; // px/ms: a flick faster than this is never ignored
export const SLOP = 6; // px before a hero-swipe pointer sequence is classified
export const TAP_SLOP = 10; // px: less total movement than this is a tap
export const SETTLE_OMEGA = 17; // 1/s; critically damped (zeta = 1): ~220 ms to land, never overshoots
export const BUTTON_OMEGA = 17;
export const VELOCITY_WINDOW_MS = 90;

export const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const easeOutExpo = (t: number) => (t >= 1 ? 1 : t <= 0 ? 0 : 1 - Math.pow(2, -10 * t));

/**
 * Critically damped approach of x from x0 (velocity v0, per second) to `target` after tSec.
 * v0 is capped so the curve can never cross the target (no overshoot, no mush).
 */
export function spring(x0: number, v0: number, target: number, tSec: number, omega = SETTLE_OMEGA): { x: number; v: number } {
  const d = x0 - target;
  const toward = Math.sign(-d);
  let v = v0;
  if (toward !== 0 && v * toward > omega * Math.abs(d)) v = toward * omega * Math.abs(d);
  const c2 = v + omega * d;
  const e = Math.exp(-omega * tSec);
  return { x: target + (d + c2 * tSec) * e, v: (c2 - omega * (d + c2 * tSec)) * e };
}

/** What a world reports when the finger lifts. Slot units: + means toward a higher product index. */
export interface Release {
  idx0: number; // nearest product when the finger went down
  q: number; // displacement from idx0 in slots at release (signed)
  v: number; // slots / second at release (signed)
  slotPx: number; // px per slot at the finger
}
export interface DecideOpts {
  n: number;
  /** largest jump in products from idx0 (water: 1, light tray: a fling may travel further) */
  maxStep: number;
  /** velocity projection time in seconds */
  project: number;
}
export const WATER_DECIDE: DecideOpts = { n: 0, maxStep: 1, project: 0.12 };
export const LIGHT_DECIDE: DecideOpts = { n: 0, maxStep: 6, project: 0.17 };

/**
 * Velocity-projected commit decision.
 *  - the landing slot is round(q + v * project), limited to maxStep
 *  - a flick faster than COMMIT_VELOCITY is never ignored: it moves at least one product in its direction
 *  - a fast reversal against the displacement beats position (cancel)
 */
export function decideTarget(r: Release, o: DecideOpts): number {
  const flick = (COMMIT_VELOCITY * 1000) / Math.max(1, r.slotPx); // slots/s
  const moved = Math.abs(r.q) > 0.015;
  let step = Math.round(clamp(r.q + r.v * o.project, -o.maxStep, o.maxStep));
  if (moved && r.q * r.v < 0 && Math.abs(r.v) > flick) step = 0;
  else if (step === 0 && Math.abs(r.v) > flick && moved && Math.sign(r.v) === Math.sign(r.q)) step = Math.sign(r.v);
  return clamp(r.idx0 + step, 0, Math.max(0, o.n - 1));
}

/** two-state commit for the small swipes of the detail hero (photo angle): pAbs = |dx|/width, vAlong px/ms along the drag */
export function decideSwipe(pAbs: number, vAlong: number): boolean {
  if (vAlong < -COMMIT_VELOCITY) return false;
  if (vAlong > COMMIT_VELOCITY) return true;
  return pAbs > 0.5;
}

export interface Sample {
  x: number;
  t: number;
}

export type Intent = 'pending' | 'drag' | 'reject';

/**
 * Tracks one pointer sequence. Everything is measured from the very first pixel:
 * dx / dy never reset when the slop is crossed, so no initial movement is discarded.
 */
export class DragTracker {
  readonly x0: number;
  readonly y0: number;
  intent: Intent = 'pending';
  dx = 0;
  dy = 0;
  x: number;
  y: number;
  maxMove = 0;
  private samples: Sample[] = [];

  constructor(x: number, y: number, t: number, readonly width: number) {
    this.x0 = this.x = x;
    this.y0 = this.y = y;
    this.samples.push({ x, t });
  }

  move(x: number, y: number, t: number): Intent {
    this.x = x;
    this.y = y;
    this.dx = x - this.x0;
    this.dy = y - this.y0;
    this.maxMove = Math.max(this.maxMove, Math.hypot(this.dx, this.dy));
    this.samples.push({ x, t });
    if (this.samples.length > 24) this.samples.shift();
    if (this.intent === 'pending' && Math.hypot(this.dx, this.dy) >= SLOP) {
      this.intent = Math.abs(this.dy) > Math.abs(this.dx) ? 'reject' : 'drag';
    }
    return this.intent;
  }

  /** signed progress, clamped to [-1, 1] */
  get p(): number {
    return clamp(this.dx / this.width, -1, 1);
  }

  /** signed velocity (px/ms) over the last VELOCITY_WINDOW_MS; 0 when there is not enough data */
  velocity(): number {
    const s = this.samples;
    const last = s[s.length - 1];
    let first = last;
    for (let i = s.length - 2; i >= 0; i--) {
      if (last.t - s[i].t > VELOCITY_WINDOW_MS) break;
      first = s[i];
    }
    const dt = last.t - first.t;
    return dt > 0 ? (last.x - first.x) / dt : 0;
  }
}

/** keeps a short history of a scalar (the world position) to read its velocity at release */
export class Velocity {
  private s: { v: number; t: number }[] = [];
  reset() {
    this.s.length = 0;
  }
  push(v: number, t: number) {
    this.s.push({ v, t });
    if (this.s.length > 16) this.s.shift();
  }
  /** units/second over the last VELOCITY_WINDOW_MS, 0 if the finger rested */
  read(now: number): number {
    const s = this.s;
    if (s.length < 2) return 0;
    const last = s[s.length - 1];
    if (now - last.t > VELOCITY_WINDOW_MS) return 0;
    let first = last;
    for (let i = s.length - 2; i >= 0; i--) {
      if (last.t - s[i].t > VELOCITY_WINDOW_MS) break;
      first = s[i];
    }
    const dt = last.t - first.t;
    return dt > 0 ? ((last.v - first.v) / dt) * 1000 : 0;
  }
}
