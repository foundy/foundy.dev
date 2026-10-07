import { describe, expect, it } from 'vitest';
import { Spring, springFromRatio } from './spring';
import { estimateVelocity, VelocityTracker } from './velocity';
import { GesturePipeline, type GestureEvent, type Sample } from './gesture';
import { GestureRecorder, parseRecording, replay, toJSON } from './recorder';
import { CLOSE_FRACTION, decideClose, dragOffset, shouldClose, TAU_MS } from '../cards/decision';

const run = (s: Spring, ms: number, step = 16) => {
  for (let t = 0; t < ms; t += step) s.step(step);
};

describe('spring', () => {
  it('settles on the target for under, critically and over damped', () => {
    for (const ratio of [0.4, 1, 2.5]) {
      const s = new Spring(0, springFromRatio(300, ratio));
      s.retarget(1);
      run(s, 4000);
      expect(s.settled).toBe(true);
      expect(s.value).toBe(1);
    }
  });
  it('under-damped overshoots, critically damped does not', () => {
    const peak = (ratio: number) => {
      const s = new Spring(0, springFromRatio(300, ratio));
      s.retarget(1);
      let m = 0;
      for (let i = 0; i < 200; i++) m = Math.max(m, s.step(8));
      return m;
    };
    expect(peak(0.4)).toBeGreaterThan(1.1);
    expect(peak(1)).toBeLessThanOrEqual(1.0000001);
  });
  it('is frame-rate independent (exact closed form)', () => {
    const a = new Spring(0, springFromRatio(260, 0.6));
    const b = new Spring(0, springFromRatio(260, 0.6));
    a.retarget(1);
    b.retarget(1);
    for (let i = 0; i < 20; i++) a.step(16);
    for (let i = 0; i < 40; i++) b.step(8);
    expect(a.value).toBeCloseTo(b.value, 6);
    expect(a.velocity).toBeCloseTo(b.velocity, 4);
  });
  it('clamps dt so a stall cannot teleport it', () => {
    const a = new Spring(0, springFromRatio(300, 1));
    a.retarget(1);
    a.step(10_000);
    const b = new Spring(0, springFromRatio(300, 1));
    b.retarget(1);
    b.step(32);
    expect(a.value).toBeCloseTo(b.value, 9);
  });
  it('retargeting mid-flight carries velocity', () => {
    const s = new Spring(0, springFromRatio(300, 1));
    s.retarget(1);
    run(s, 80);
    const v = s.velocity;
    const x = s.value;
    expect(v).toBeGreaterThan(0);
    s.retarget(0);
    expect(s.velocity).toBe(v);
    expect(s.value).toBe(x);
    s.step(16);
    expect(s.value).toBeGreaterThan(x); // still moving up before it turns around
    run(s, 4000);
    expect(s.value).toBe(0);
  });
  it('set() with a velocity starts moving', () => {
    const s = new Spring(1, springFromRatio(300, 1));
    s.set(0.5, -3);
    s.step(16);
    expect(s.value).toBeLessThan(0.5);
  });
});

describe('velocity', () => {
  const line = (v: number, n = 12, dt = 8) => Array.from({ length: n }, (_, i) => ({ t: i * dt, x: 0, y: v * i * dt }));
  it('recovers a constant velocity', () => {
    const pts = line(1.8);
    const r = estimateVelocity(pts, pts.at(-1)!.t);
    expect(r.vy).toBeCloseTo(1.8, 6);
    expect(r.vx).toBeCloseTo(0, 9);
  });
  it('only looks at the last ~90 ms', () => {
    const slow = line(0.1, 20, 8);
    const t0 = slow.at(-1)!.t;
    const fast = Array.from({ length: 8 }, (_, i) => ({ t: t0 + (i + 1) * 8, x: 0, y: slow.at(-1)!.y + 3 * (i + 1) * 8 }));
    const all = [...slow, ...fast];
    expect(estimateVelocity(all, all.at(-1)!.t).vy).toBeGreaterThan(2.2);
  });
  it('is 0 after a pause (finger stopped before lift-off)', () => {
    const pts = line(2);
    expect(estimateVelocity(pts, pts.at(-1)!.t + 120).vy).toBe(0);
  });
  it('is 0 with a single sample', () => {
    expect(estimateVelocity([{ t: 0, x: 0, y: 0 }], 0).vy).toBe(0);
  });
  it('tracker agrees with the pure function', () => {
    const tr = new VelocityTracker();
    const pts = line(1.2, 30, 8);
    pts.forEach((p) => tr.add(p.t, p.x, p.y));
    expect(tr.at(pts.at(-1)!.t).vy).toBeCloseTo(1.2, 6);
  });
});

describe('shouldClose', () => {
  const H = 640;
  it('the worked example: 92 px at 1.8 px/ms closes', () => {
    const d = decideClose({ distance: 92, velocity: 1.8, sheetHeight: H });
    expect(d.projected).toBeCloseTo(92 + 1.8 * TAU_MS, 6);
    expect(d.threshold).toBeCloseTo(CLOSE_FRACTION * H, 6);
    expect(d.close).toBe(true);
  });
  it('slow long pull closes', () => expect(shouldClose({ distance: 260, velocity: 0, sheetHeight: H })).toBe(true));
  it('small slow drag stays open', () => expect(shouldClose({ distance: 70, velocity: 0.05, sheetHeight: H })).toBe(false));
  it('upward velocity cancels a long pull', () => expect(shouldClose({ distance: 230, velocity: -1.5, sheetHeight: H })).toBe(false));
  it('a twitch is not a flick', () => expect(shouldClose({ distance: 6, velocity: 6, sheetHeight: H })).toBe(false));
  it('is monotonic in distance and velocity', () => {
    for (let d = 20; d < 400; d += 20) {
      for (let v = -1; v < 4; v += 0.5) {
        if (shouldClose({ distance: d, velocity: v, sheetHeight: H })) {
          expect(shouldClose({ distance: d + 10, velocity: v, sheetHeight: H })).toBe(true);
          expect(shouldClose({ distance: d, velocity: v + 0.5, sheetHeight: H })).toBe(true);
        }
      }
    }
  });
  it('rubber band: 1:1 down, bounded above', () => {
    expect(dragOffset(120)).toBe(120);
    expect(dragOffset(-10)).toBeLessThan(0);
    expect(dragOffset(-10)).toBeGreaterThan(-10);
    expect(dragOffset(-5000)).toBeGreaterThan(-57);
  });
});

/** a synthetic flick: press, 10 px slop, then a fast pull and lift */
const flick = (): Sample[] => {
  const s: Sample[] = [{ t: 0, x: 200, y: 100, type: 'down' }];
  let y = 100;
  for (let i = 1; i <= 14; i++) {
    y += i < 4 ? 4 : 11;
    s.push({ t: i * 8, x: 200 + (i % 3), y, type: i === 14 ? 'up' : 'move' });
  }
  return s;
};
const feedAll = (samples: Sample[], claim = true) => {
  const ev: GestureEvent[] = [];
  const p = new GesturePipeline({ slop: 10, claim: () => claim }, 'touch', (e) => ev.push(e));
  samples.forEach((s) => p.feed(s));
  return ev;
};

describe('gesture pipeline', () => {
  it('a press with no travel is a tap', () => {
    const ev = feedAll([
      { t: 0, x: 5, y: 5, type: 'down' },
      { t: 30, x: 7, y: 6, type: 'move' },
      { t: 80, x: 7, y: 6, type: 'up' },
    ]);
    expect(ev.map((e) => e.kind)).toEqual(['down', 'tap']);
  });
  it('past the slop it claims, then drags relative to the claim point, then releases with velocity', () => {
    const ev = feedAll(flick());
    const kinds = ev.map((e) => e.kind);
    expect(kinds[0]).toBe('down');
    expect(kinds[1]).toBe('slop');
    expect(kinds.at(-1)).toBe('release');
    const first = ev.find((e) => e.kind === 'drag')!;
    expect(first.kind === 'drag' && Math.abs(first.dy)).toBeLessThan(15); // no jump at claim
    const rel = ev.at(-1)!;
    expect(rel.kind === 'release' && rel.vy).toBeGreaterThan(1);
  });
  it('axis lock: a mostly horizontal move is axis x and can be declined', () => {
    const ev = feedAll(
      [
        { t: 0, x: 0, y: 0, type: 'down' },
        { t: 8, x: 14, y: 3, type: 'move' },
        { t: 16, x: 30, y: 5, type: 'move' },
        { t: 24, x: 30, y: 5, type: 'up' },
      ],
      false,
    );
    const slop = ev.find((e) => e.kind === 'slop')!;
    expect(slop.kind === 'slop' && slop.axis).toBe('x');
    expect(slop.kind === 'slop' && slop.claimed).toBe(false);
    expect(ev.some((e) => e.kind === 'release' || e.kind === 'drag')).toBe(false);
  });
  it('cancel mid-drag reports claimed and never releases', () => {
    const s = flick().slice(0, 8);
    s.push({ t: 70, x: 200, y: 180, type: 'cancel' });
    const ev = feedAll(s);
    const last = ev.at(-1)!;
    expect(last.kind).toBe('cancel');
    expect(last.kind === 'cancel' && last.claimed).toBe(true);
    expect(ev.some((e) => e.kind === 'release')).toBe(false);
  });
});

describe('recorder', () => {
  const record = () => {
    const rec = new GestureRecorder();
    rec.begin('sheet-pull', { pointerType: 'touch', slop: 10, sheetHeight: 640 });
    flick().forEach((s) => rec.add(s));
    return rec.finish({ close: true })!;
  };
  it('round-trips through versioned JSON', () => {
    const r = record();
    const back = parseRecording(toJSON(r));
    expect(back).toEqual(r);
    expect(() => parseRecording('{"v":99,"kind":"x","samples":[],"meta":{}}')).toThrow();
  });
  it('replay is deterministic and matches the live pipeline', () => {
    const r = record();
    const a = replay(r);
    const b = replay(parseRecording(toJSON(r)));
    expect(b).toEqual(a);
    expect(a).toEqual(feedAll(flick()));
  });
  it('one recording, two decision rules', () => {
    const r = record();
    const rel = replay(r).find((e) => e.kind === 'release');
    if (rel?.kind !== 'release') throw new Error('no release');
    const input = { distance: rel.dy, velocity: rel.vy, sheetHeight: 640 };
    const strict = { tau: 0, fraction: 0.35, minDistance: 16 }; // old rule: distance only
    expect(decideClose(input).close).toBe(true);
    expect(decideClose(input, strict).close).toBe(false);
  });
  it('drops degenerate recordings', () => {
    const rec = new GestureRecorder();
    rec.begin('x', { pointerType: 'mouse', slop: 8 });
    rec.add({ t: 0, x: 0, y: 0, type: 'down' });
    expect(rec.finish()).toBeNull();
  });
});
