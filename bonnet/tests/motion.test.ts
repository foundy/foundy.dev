import { describe, expect, it } from 'vitest';
import { Spring, springFromRatio } from '../src/motion/spring';
import { VelocityTracker, estimateVelocity } from '../src/motion/velocity';
import { angleParts, bandPosition, decideClose, pickTarget, snapAngle } from '../src/motion/decide';
import { cardLook } from '../src/layout';
import { clamp, rubber, smoothstep } from '../src/motion/math';

const run = (s: Spring, ms: number) => {
  for (let t = 0; t < ms; t += 8) s.step(8);
};

describe('spring', () => {
  it('settles on its target', () => {
    const s = new Spring(0, springFromRatio(240, 0.9));
    s.retarget(1);
    run(s, 3000);
    expect(s.settled).toBe(true);
    expect(s.value).toBe(1);
  });
  it('carries release velocity and overshoots when underdamped', () => {
    const s = new Spring(0, springFromRatio(230, 0.6));
    s.set(0, 6);
    s.retarget(1);
    let max = 0;
    for (let i = 0; i < 200; i++) max = Math.max(max, s.step(8));
    expect(max).toBeGreaterThan(1);
  });
  it('retargeting keeps value and velocity (reversal bends, never restarts)', () => {
    const s = new Spring(0, springFromRatio(240, 0.9));
    s.retarget(1);
    run(s, 120);
    const v = s.value;
    const vel = s.velocity;
    s.retarget(0);
    expect(s.value).toBe(v);
    expect(s.velocity).toBe(vel);
    run(s, 3000);
    expect(s.value).toBe(0);
  });
  it('is frame-rate independent (closed form)', () => {
    const a = new Spring(0, springFromRatio(240, 0.8));
    const b = new Spring(0, springFromRatio(240, 0.8));
    a.retarget(1);
    b.retarget(1);
    for (let i = 0; i < 25; i++) a.step(8);
    for (let i = 0; i < 12; i++) b.step(16.6667);
    expect(Math.abs(a.value - b.value)).toBeLessThan(0.01);
  });
});

describe('velocity', () => {
  it('fits a line over the recent window', () => {
    const pts = Array.from({ length: 8 }, (_, i) => ({ t: i * 16, x: i * 16 * 1.5, y: 0 }));
    expect(estimateVelocity(pts, 112).vx).toBeCloseTo(1.5, 5);
  });
  it('is zero when the finger rested before lift-off', () => {
    const vt = new VelocityTracker();
    for (let i = 0; i < 5; i++) vt.add(i * 16, i * 30, 0);
    expect(vt.at(64 + 200).vx).toBe(0);
  });
});

describe('deck target selection', () => {
  const base = { spacing: 170, count: 5, startIndex: 2 };
  it('stays when barely moved', () => expect(pickTarget({ ...base, pos: 2.1, vx: 0 })).toBe(2));
  it('goes past half a card without velocity', () => expect(pickTarget({ ...base, pos: 2.6, vx: 0 })).toBe(3));
  it('a short flick left advances one card (finger moves left = vx < 0)', () => expect(pickTarget({ ...base, pos: 2.1, vx: -0.9 })).toBe(3));
  it('a short flick right goes back one card', () => expect(pickTarget({ ...base, pos: 1.9, vx: 0.9 })).toBe(1));
  it('a strong flick may skip two but never more', () => {
    expect(pickTarget({ ...base, pos: 2.2, vx: -3 })).toBe(4);
    expect(pickTarget({ ...base, pos: 2.2, vx: -9 })).toBe(4);
  });
  it('a medium flick is clamped to one card', () => expect(pickTarget({ ...base, pos: 2.3, vx: -1.8 })).toBe(3));
  it('clamps to the ends', () => {
    expect(pickTarget({ ...base, startIndex: 0, pos: -0.2, vx: 4 })).toBe(0);
    expect(pickTarget({ ...base, startIndex: 4, pos: 4.2, vx: -4 })).toBe(4);
  });
  it('rubber-bands past the ends and approaches a limit', () => {
    expect(bandPosition(2, 5)).toBe(2);
    expect(bandPosition(-1, 5)).toBeLessThan(0);
    expect(bandPosition(-1, 5)).toBeGreaterThan(-0.32);
    expect(bandPosition(9, 5)).toBeLessThan(4.32);
    expect(bandPosition(4.1, 5)).toBeCloseTo(4.1 - 0.0, 0);
  });
});

describe('close decision', () => {
  const range = 340;
  it('a slow short pull stays', () => expect(decideClose({ p: 1 - 60 / range, velocity: 0.05, range }).close).toBe(false));
  it('a slow long pull closes', () => expect(decideClose({ p: 1 - 200 / range, velocity: 0.1, range }).close).toBe(true));
  it('a short fast flick closes (projected, not just distance)', () => expect(decideClose({ p: 1 - 60 / range, velocity: 2.2, range }).close).toBe(true));
  it('a twitch never closes however fast', () => expect(decideClose({ p: 1 - 6 / range, velocity: 6, range }).close).toBe(false));
  it('an upward flick after pulling stays', () => expect(decideClose({ p: 1 - 100 / range, velocity: -2, range }).close).toBe(false));
});

describe('angle scrub', () => {
  it('splits a continuous angle into image + fraction (cyclic)', () => {
    expect(angleParts(0)).toEqual([0, 0]);
    expect(angleParts(1.25)).toEqual([1, 0.25]);
    expect(angleParts(-0.5)).toEqual([3, 0.5]);
    expect(angleParts(5.75)[0]).toBe(1);
  });
  it('snaps to the nearest whole angle at rest', () => {
    expect(snapAngle(1.3, 0)).toBe(1);
    expect(snapAngle(1.6, 0)).toBe(2);
  });
  it('inertia carries to the next angle and is capped at two', () => {
    expect(snapAngle(0.2, 0.004, 0)).toBe(1);
    expect(snapAngle(0.2, 0.05, 0)).toBe(2);
    expect(snapAngle(0.2, -0.05, 0)).toBe(-2);
  });
});

describe('layout is continuous', () => {
  it('front card is exactly neutral at d = 0 (so the hero hand-off has no jump)', () => {
    const l = cardLook(0, 160, 0, false);
    [l.x, l.y, l.rot, l.rotY, l.px].forEach((v) => expect(Math.abs(v)).toBe(0));
    expect([l.scale, l.opacity, l.pscale]).toEqual([1, 1, 1]);
  });
  it('front card tracks the finger 1:1 for small moves', () => {
    expect(cardLook(0.01, 160, 0, false).x).toBeCloseTo(1.6, 2);
  });
  it('is continuous across d (no steps)', () => {
    let prev = cardLook(-3, 160, 0, false);
    for (let d = -2.99; d <= 3; d += 0.01) {
      const l = cardLook(d, 160, 0, false);
      expect(Math.abs(l.x - prev.x)).toBeLessThan(3);
      expect(Math.abs(l.scale - prev.scale)).toBeLessThan(0.01);
      expect(Math.abs(l.opacity - prev.opacity)).toBeLessThan(0.02);
      prev = l;
    }
  });
  it('siblings are gone at p = 1; reduced motion crossfades in place', () => {
    expect(cardLook(1, 160, 1, false).opacity).toBe(0);
    const r = cardLook(0.5, 160, 0, true);
    expect(r.x).toBe(0);
    expect(r.opacity).toBe(0.5);
  });
});

describe('math', () => {
  it('helpers', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(rubber(-1, 10)).toBe(0);
  });
});
