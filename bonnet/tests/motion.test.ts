import { describe, expect, it } from 'vitest';
import { COMMIT_P, COMMIT_VELOCITY, DragTracker, SLOP, decide, easeOutExpo, spring } from '../src/motion';

describe('decide', () => {
  it('commits on a fast flick in the drag direction regardless of distance', () => {
    expect(decide(0.02, COMMIT_VELOCITY + 0.01)).toBe('commit');
  });
  it('commits past half width when slow', () => {
    expect(decide(COMMIT_P + 0.01, 0)).toBe('commit');
    expect(decide(COMMIT_P - 0.01, 0.1)).toBe('cancel');
  });
  it('a fast reversal cancels even beyond half width', () => {
    expect(decide(0.8, -(COMMIT_VELOCITY + 0.05))).toBe('cancel');
  });
  it('threshold is strict (> 0.3 px/ms)', () => {
    expect(decide(0.1, COMMIT_VELOCITY)).toBe('cancel');
  });
});

describe('DragTracker: progress from the first pixel', () => {
  it('keeps all movement made before the slop is crossed', () => {
    const t = new DragTracker(100, 100, 0, 400);
    expect(t.move(103, 100, 8)).toBe('pending');
    expect(t.p).toBeCloseTo(3 / 400);
    expect(t.move(100 + SLOP + 1, 101, 16)).toBe('drag');
    // p at the instant of classification includes everything since the origin: no reset, no jump
    expect(t.dx).toBe(SLOP + 1);
    expect(t.p).toBeCloseTo((SLOP + 1) / 400);
  });
  it('p is dx / width and clamped to [-1, 1]', () => {
    const t = new DragTracker(200, 0, 0, 100);
    t.move(80, 0, 10);
    expect(t.p).toBe(-1);
    t.move(450, 0, 20);
    expect(t.p).toBe(1);
  });
  it('classifies a mostly vertical start as reject (browser owns the scroll)', () => {
    const t = new DragTracker(0, 0, 0, 300);
    expect(t.move(2, 9, 10)).toBe('reject');
  });
  it('a diagonal micro move below the slop stays pending (a tap)', () => {
    const t = new DragTracker(0, 0, 0, 300);
    expect(t.move(3, 3, 10)).toBe('pending');
  });
  it('signed velocity over the recent window; a pause before release gives ~0', () => {
    const t = new DragTracker(0, 0, 0, 400);
    for (let i = 1; i <= 10; i++) t.move(i * 10, 0, i * 10); // 1 px/ms
    expect(t.velocity()).toBeCloseTo(1, 1);
    t.move(100, 0, 400); // finger rested 300 ms
    expect(t.velocity()).toBe(0);
    const l = new DragTracker(300, 0, 0, 400);
    for (let i = 1; i <= 5; i++) l.move(300 - i * 8, 0, i * 16);
    expect(l.velocity()).toBeLessThan(-0.4);
  });
});

describe('settle motion', () => {
  it('easeOutExpo hits exactly 0 and 1', () => {
    expect(easeOutExpo(0)).toBe(0);
    expect(easeOutExpo(1)).toBe(1);
    expect(easeOutExpo(0.5)).toBeGreaterThan(0.95);
  });
  it('critically damped spring converges and never overshoots, even with a huge launch velocity', () => {
    for (const v0 of [0, 1, 20, 500]) {
      let max = -Infinity;
      for (let t = 0; t <= 1; t += 0.005) max = Math.max(max, spring(0.3, v0, 1, t).x);
      expect(max).toBeLessThanOrEqual(1 + 1e-9);
      expect(spring(0.3, v0, 1, 1).x).toBeCloseTo(1, 3);
    }
  });
  it('settling back to 0 never goes below 0', () => {
    let min = Infinity;
    for (let t = 0; t <= 1; t += 0.005) min = Math.min(min, spring(0.4, -300, 0, t).x);
    expect(min).toBeGreaterThanOrEqual(-1e-9);
  });
  it('is mostly settled within ~250 ms from rest', () => {
    expect(spring(0, 0, 1, 0.25).x).toBeGreaterThan(0.98);
  });
});
