// Pure math: commit decision, drag tracking, easing and the critically damped settle. No DOM, no clock.

export const COMMIT_VELOCITY = 0.3; // px/ms, signed, in the drag direction
export const COMMIT_P = 0.5;
export const SLOP = 6; // px before a pointer sequence is classified
export const BUTTON_MS = 220;
export const SETTLE_OMEGA = 24; // 1/s; critically damped (zeta = 1)
export const VELOCITY_WINDOW_MS = 90;

/** pAbs = |dx|/width (0..1); vAlong = velocity (px/ms) along the drag direction, + means "still going that way". */
export function decide(pAbs: number, vAlong: number): 'commit' | 'cancel' {
  if (vAlong < -COMMIT_VELOCITY) return 'cancel'; // fast reversal beats position
  if (vAlong > COMMIT_VELOCITY) return 'commit';
  return pAbs > COMMIT_P ? 'commit' : 'cancel';
}

export const easeOutExpo = (t: number) => (t >= 1 ? 1 : t <= 0 ? 0 : 1 - Math.pow(2, -10 * t));

/**
 * Critically damped approach of x from x0 (velocity v0, per second) to `target`.
 * v0 is capped so the curve can never cross the target (no overshoot).
 */
export function spring(x0: number, v0: number, target: number, tSec: number, omega = SETTLE_OMEGA): { x: number; v: number } {
  const d = x0 - target;
  const toward = Math.sign(-d); // direction of the target as seen from x0
  let v = v0;
  if (toward !== 0 && v * toward > omega * Math.abs(d)) v = toward * omega * Math.abs(d);
  const c2 = v + omega * d;
  const e = Math.exp(-omega * tSec);
  return { x: target + (d + c2 * tSec) * e, v: (c2 - omega * (d + c2 * tSec)) * e };
}

export interface Sample {
  x: number;
  t: number;
}

export type Intent = 'pending' | 'drag' | 'reject';

/**
 * Tracks one pointer sequence. Everything is measured from the very first pixel:
 * dx / p never reset when the slop is crossed, so no initial movement is discarded.
 */
export class DragTracker {
  readonly x0: number;
  readonly y0: number;
  intent: Intent = 'pending';
  dx = 0;
  dy = 0;
  private samples: Sample[] = [];

  constructor(x: number, y: number, t: number, readonly width: number) {
    this.x0 = x;
    this.y0 = y;
    this.samples.push({ x, t });
  }

  move(x: number, y: number, t: number): Intent {
    this.dx = x - this.x0;
    this.dy = y - this.y0;
    this.samples.push({ x, t });
    if (this.samples.length > 24) this.samples.shift();
    if (this.intent === 'pending' && Math.hypot(this.dx, this.dy) >= SLOP) {
      this.intent = Math.abs(this.dy) > Math.abs(this.dx) ? 'reject' : 'drag';
    }
    return this.intent;
  }

  /** signed progress, clamped to [-1, 1] */
  get p(): number {
    return Math.max(-1, Math.min(1, this.dx / this.width));
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
