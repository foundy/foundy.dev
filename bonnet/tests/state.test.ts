import { describe, expect, it } from 'vitest';
import { Core, DEFAULT_SPRING, SWITCH_S } from '../src/core/state';

const run = (c: Core, sec: number, cfg = DEFAULT_SPRING) => {
  for (let t = 0; t < sec; t += 1 / 60) if (!c.tick(1 / 60, cfg)) break;
};

describe('index', () => {
  it('steps within the list and stops at the ends', () => {
    const c = new Core(5, 'light', 0);
    expect(c.step(-1)).toBe(-1);
    expect(c.step(1)).toBe(1);
    expect(c.state.index).toBe(1);
    c.setIndex(4);
    expect(c.step(1)).toBe(-1);
    expect(c.state.index).toBe(4);
  });
  it('index only changes while browsing', () => {
    const c = new Core(5, 'water', 2);
    c.open(true);
    expect(c.setIndex(3)).toBe(false);
    expect(c.state.index).toBe(2);
  });
  it('clamps the start index', () => {
    expect(new Core(3, 'light', 9).state.index).toBe(2);
  });
});

describe('page', () => {
  it('browse -> opening -> detail -> closing -> browse', () => {
    const c = new Core(5, 'light', 1);
    expect(c.open(true)).toBe(true);
    expect(c.state.page).toBe('opening');
    run(c, 3);
    expect(c.state.p).toBe(1);
    expect(c.arrived).toBe(true);
    expect(c.state.page).toBe('opening'); // stays until the view finishes the hand-off
    c.settle();
    expect(c.state.page).toBe('detail');
    expect(c.close(true)).toBe(true);
    expect(c.state.page).toBe('closing');
    run(c, 3);
    expect(c.state.p).toBe(0);
    c.settle();
    expect(c.state.page).toBe('browse');
  });
  it('p never overshoots 1 and rises monotonically', () => {
    const c = new Core(5, 'water', 1);
    c.open(true);
    let prev = 0;
    for (let i = 0; i < 400; i++) {
      c.tick(1 / 60, { open: 5.4, close: 5.4, snap: 0.0006 });
      expect(c.state.p).toBeGreaterThanOrEqual(prev);
      expect(c.state.p).toBeLessThanOrEqual(1);
      prev = c.state.p;
    }
    expect(prev).toBe(1);
  });
  it('closing during the opening retargets from the current p and v (no jump)', () => {
    const c = new Core(5, 'light', 1);
    c.open(true);
    run(c, 0.15);
    const { p, pv } = c.state;
    expect(p).toBeGreaterThan(0);
    c.close(true);
    expect(c.state.page).toBe('closing');
    expect(c.state.p).toBe(p);
    expect(c.state.pv).toBe(pv);
    run(c, 3);
    expect(c.state.p).toBe(0);
  });
  it('reopening during the closing works too (Forward)', () => {
    const c = new Core(5, 'light', 1);
    c.open(true);
    run(c, 3);
    c.settle();
    c.close(true);
    run(c, 0.1);
    expect(c.open(true)).toBe(true);
    expect(c.state.page).toBe('opening');
  });
  it('open/close are idempotent', () => {
    const c = new Core(5, 'light', 1);
    expect(c.close(true)).toBe(false);
    c.open(true);
    expect(c.open(true)).toBe(false);
  });
  it('reduced motion: instant pages, no spring', () => {
    const c = new Core(5, 'light', 1);
    c.reduced = true;
    c.open(true);
    expect(c.state).toMatchObject({ page: 'detail', p: 1 });
    c.close(true);
    expect(c.state).toMatchObject({ page: 'browse', p: 0 });
  });
  it('a non-animated open (deep link) lands on detail at once', () => {
    const c = new Core(5, 'light', 1);
    c.open(false);
    expect(c.state).toMatchObject({ page: 'detail', p: 1, pv: 0 });
  });
});

describe('world switch', () => {
  it('keeps the product and runs the ~1.1 s signature transition', () => {
    const c = new Core(5, 'light', 3);
    expect(c.switchWorld('water')).toBe(true);
    expect(c.state).toMatchObject({ world: 'water', index: 3 });
    expect(c.state.sw).toMatchObject({ from: 'light', t: 0, kind: 'l2w', u: 0, dir: 1 });
    let t = 0;
    while (c.state.sw && t < 2) (c.tick(1 / 60), (t += 1 / 60));
    expect(t).toBeGreaterThanOrEqual(SWITCH_S - 0.05);
    expect(t).toBeLessThan(SWITCH_S + 0.05);
    expect(c.state.sw).toBeNull();
    expect(c.state.index).toBe(3);
  });
  it('switching to the same world does nothing; only in browse', () => {
    const c = new Core(5, 'light', 1);
    expect(c.switchWorld('light')).toBe(false);
    c.open(true);
    expect(c.switchWorld('water')).toBe(false);
  });
  it('toggling back mid-switch reverses in place (the mix stays continuous)', () => {
    const c = new Core(5, 'light', 1);
    c.switchWorld('water');
    for (let i = 0; i < 20; i++) c.tick(1 / 60);
    const t = c.state.sw!.t;
    c.switchWorld('light');
    expect(c.state.world).toBe('light');
    expect(c.state.sw!.from).toBe('water');
    expect(c.state.sw!.t).toBeCloseTo(1 - t, 6);
    // same timeline, played backwards: the progress u is unchanged at the reversal and then runs down to 0
    expect(c.state.sw).toMatchObject({ kind: 'l2w', dir: -1 });
    expect(c.state.sw!.u).toBeCloseTo(t, 6);
    let n = 0;
    while (c.state.sw && n++ < 200) c.tick(1 / 60);
    expect(c.state.sw).toBeNull();
    expect(c.state.world).toBe('light');
  });
  it('a zero-length first frame (equal timestamps) does not end the switch', () => {
    const c = new Core(5, 'light', 1);
    c.switchWorld('water');
    c.tick(0);
    expect(c.state.sw).not.toBeNull();
  });
  it('a w2l switch is its own timeline; reversing twice goes forward again', () => {
    const c = new Core(5, 'water', 1);
    c.switchWorld('light');
    expect(c.state.sw).toMatchObject({ kind: 'w2l', u: 0 });
    for (let i = 0; i < 10; i++) c.tick(1 / 60);
    c.switchWorld('water');
    c.switchWorld('light');
    expect(c.state.sw).toMatchObject({ kind: 'w2l', dir: 1 });
  });
  it('the page spring can be held for a scrubbing finger', () => {
    const c = new Core(5, 'light', 1);
    c.open(false);
    c.close(true);
    c.hold = true;
    c.state.p = 0.7;
    c.tick(0.5);
    expect(c.state.p).toBe(0.7);
    c.hold = false;
    c.tick(0.1);
    expect(c.state.p).toBeLessThan(0.7);
  });
  it('mix is a smoothstep of the switch progress', () => {
    const c = new Core(5, 'light', 1);
    expect(c.mix).toBe(1);
    c.switchWorld('water');
    expect(c.mix).toBe(0);
    c.state.sw!.t = 0.5;
    expect(c.mix).toBeCloseTo(0.5, 6);
  });
  it('reduced motion switches instantly', () => {
    const c = new Core(5, 'light', 1);
    c.reduced = true;
    c.switchWorld('water');
    expect(c.state.world).toBe('water');
    expect(c.state.sw).toBeNull();
  });
});
