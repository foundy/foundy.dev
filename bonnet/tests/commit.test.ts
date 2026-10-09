import { describe, expect, it } from 'vitest';
import { COMMIT_VELOCITY, DragTracker, LIGHT_DECIDE, SLOP, Velocity, WATER_DECIDE, decideSwipe, decideTarget, easeOutExpo, spring } from '../src/core/commit';

const W = { ...WATER_DECIDE, n: 5 };
const L = { ...LIGHT_DECIDE, n: 5 };
const rel = (idx0: number, q: number, v: number, slotPx = 280) => ({ idx0, q, v, slotPx });

describe('decideTarget (velocity-projected commit)', () => {
  it('a slow drag past half a slot lands on the next product, short of it falls back', () => {
    expect(decideTarget(rel(2, 0.6, 0), W)).toBe(3);
    expect(decideTarget(rel(2, 0.4, 0), W)).toBe(2);
    expect(decideTarget(rel(2, -0.6, 0), W)).toBe(1);
  });
  it('a flick is never ignored: it moves one product even for a tiny drag', () => {
    const fast = ((COMMIT_VELOCITY + 0.05) * 1000) / 280; // slots/s
    expect(decideTarget(rel(2, 0.05, fast), W)).toBe(3);
    expect(decideTarget(rel(2, -0.05, -fast), W)).toBe(1);
  });
  it('velocity projection: a medium drag with speed carries over the half mark', () => {
    expect(decideTarget(rel(2, 0.3, 2.0), W)).toBe(3); // 0.3 + 2.0 * 0.12 = 0.54
    expect(decideTarget(rel(2, 0.3, 0.5), W)).toBe(2);
  });
  it('a fast reversal beats position (cancel)', () => {
    const fast = ((COMMIT_VELOCITY + 0.1) * 1000) / 280;
    expect(decideTarget(rel(2, 0.8, -fast), W)).toBe(2);
    expect(decideTarget(rel(2, -0.8, fast), W)).toBe(2);
  });
  it('water never jumps more than one product; the light tray may fling further', () => {
    expect(decideTarget(rel(0, 0.2, 40), W)).toBe(1);
    expect(decideTarget(rel(0, 0.2, 40), L)).toBe(4); // clamped to the last product (maxStep 6, n 5)
    expect(decideTarget(rel(0, 0.2, 6), L)).toBe(1); // 0.2 + 6*0.17 = 1.22
    expect(decideTarget(rel(0, 0.2, 14), L)).toBe(3); // 0.2 + 14*0.17 = 2.58
  });
  it('never leaves the list', () => {
    expect(decideTarget(rel(0, -0.9, -5), W)).toBe(0);
    expect(decideTarget(rel(4, 0.9, 5), W)).toBe(4);
  });
  it('no drag and no speed stays put', () => {
    expect(decideTarget(rel(3, 0, 0), W)).toBe(3);
  });
});

describe('decideSwipe (detail photo swipe)', () => {
  it('flick commits, half width commits, fast reversal cancels', () => {
    expect(decideSwipe(0.02, COMMIT_VELOCITY + 0.01)).toBe(true);
    expect(decideSwipe(0.51, 0)).toBe(true);
    expect(decideSwipe(0.49, 0.1)).toBe(false);
    expect(decideSwipe(0.8, -(COMMIT_VELOCITY + 0.05))).toBe(false);
  });
});

describe('DragTracker: progress from the first pixel', () => {
  it('keeps all movement made before the slop is crossed', () => {
    const t = new DragTracker(100, 100, 0, 400);
    expect(t.move(103, 100, 8)).toBe('pending');
    expect(t.dx).toBe(3);
    expect(t.move(100 + SLOP + 1, 101, 16)).toBe('drag');
    expect(t.dx).toBe(SLOP + 1);
  });
  it('p is dx / width and clamped to [-1, 1]', () => {
    const t = new DragTracker(200, 0, 0, 100);
    t.move(80, 0, 10);
    expect(t.p).toBe(-1);
    t.move(450, 0, 20);
    expect(t.p).toBe(1);
  });
  it('mostly vertical start is rejected, a diagonal micro move stays a tap', () => {
    expect(new DragTracker(0, 0, 0, 300).move(2, 9, 10)).toBe('reject');
    expect(new DragTracker(0, 0, 0, 300).move(3, 3, 10)).toBe('pending');
  });
  it('signed velocity over the recent window; a pause before release gives ~0', () => {
    const t = new DragTracker(0, 0, 0, 400);
    for (let i = 1; i <= 10; i++) t.move(i * 10, 0, i * 10);
    expect(t.velocity()).toBeCloseTo(1, 1);
    t.move(100, 0, 400);
    expect(t.velocity()).toBe(0);
  });
});

describe('Velocity (slots/s)', () => {
  it('reads units per second and returns 0 when the finger rested', () => {
    const v = new Velocity();
    for (let i = 0; i <= 5; i++) v.push(i * 0.01, i * 10); // 1 unit/s
    expect(v.read(50)).toBeCloseTo(1, 3);
    expect(v.read(400)).toBe(0);
  });
});

describe('spring (critically damped, never overshoots)', () => {
  const run = (x0: number, v0: number, target: number) => {
    let x = x0, v = v0, max = x0;
    for (let i = 0; i < 120; i++) {
      const r = spring(x, v, target, 1 / 60);
      (x = r.x), (v = r.v);
      max = target > x0 ? Math.max(max, x) : Math.min(max, x);
    }
    return { x, max };
  };
  it('lands on the target', () => {
    expect(run(0, 0, 1).x).toBeCloseTo(1, 3);
    expect(run(0.4, 0, 0).x).toBeCloseTo(0, 3);
  });
  it('a violent release velocity does not overshoot', () => {
    expect(run(0.5, 50, 1).max).toBeLessThanOrEqual(1 + 1e-9);
    expect(run(0.5, -50, 0).max).toBeGreaterThanOrEqual(-1e-9);
  });
  it('is frame-rate independent (closed form)', () => {
    let a = spring(0, 0, 1, 0.1), b = spring(0, 0, 1, 0.05);
    b = spring(b.x, b.v, 1, 0.05);
    a = spring(0, 0, 1, 0.1);
    expect(a.x).toBeCloseTo(b.x, 6);
  });
  it('easeOutExpo is clamped', () => {
    expect(easeOutExpo(-1)).toBe(0);
    expect(easeOutExpo(2)).toBe(1);
  });
});
