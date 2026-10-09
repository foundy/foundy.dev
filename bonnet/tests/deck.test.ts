import { describe, expect, it } from 'vitest';
import { Bonnet } from '../src/deck';
import { BUTTON_MS } from '../src/motion';

const O = { x: 10, y: 20 };
const run = (b: Bonnet, from: number, ms: number) => {
  for (let t = from; t <= from + ms; t += 16) if (!b.tick(t)) return t;
  return from + ms;
};
// products (bonnet set): 0 ivory, 1 moss, 2 poppy, 3 sky, 4 butter - all available since the products re-model
const make = (c = 2) => new Bonnet(c);

describe('drag', () => {
  it('p tracks from the first pixel and carries the touch origin', () => {
    const b = make();
    b.dragStart(O);
    b.dragMove(-0.02);
    expect(b.state.dye).toMatchObject({ from: 2, to: 3, origin: O });
    expect(b.state.dye.p).toBeCloseTo(0.02);
    b.dragMove(0.03);
    expect(b.state.dye).toMatchObject({ from: 2, to: 1 });
  });
  it('a fast flick commits to exactly one neighbour (one gesture = one color)', () => {
    const b = make();
    b.dragStart(O);
    b.dragMove(-0.1);
    b.dragEnd(-5, 400, 0); // violent flick left
    run(b, 0, 1000);
    expect(b.state.color).toBe(3);
    expect(b.state.dye).toMatchObject({ from: 3, to: 3, p: 0 });
  });
  it('a short slow drag springs back without changing color', () => {
    const b = make();
    b.dragStart(O);
    b.dragMove(-0.3);
    b.dragEnd(-0.05, 400, 0);
    run(b, 0, 1000);
    expect(b.state.color).toBe(2);
    expect(b.state.dye.p).toBe(0);
  });
  it('past half width commits with no velocity', () => {
    const b = make();
    b.dragStart(O);
    b.dragMove(0.6);
    b.dragEnd(0, 400, 0);
    run(b, 0, 1000);
    expect(b.state.color).toBe(1);
  });
  it('does not go past the ends (over-drag is resisted)', () => {
    const b = make(0);
    b.dragStart(O);
    b.dragMove(0.7); // toward prev: nothing before the first product
    expect(b.state.dye.to).toBe(0);
    expect(b.state.edge).toBe(1);
    expect(b.state.dye.p).toBeLessThan(0.2);
    b.dragEnd(2, 400, 0);
    run(b, 0, 1000);
    expect(b.state.color).toBe(0);
  });
  it('cancel returns to the committed color', () => {
    const b = make();
    b.dragStart(O);
    b.dragMove(-0.4);
    b.dragCancel(0);
    run(b, 0, 1000);
    expect(b.state).toMatchObject({ color: 2 });
    expect(b.state.dye.p).toBe(0);
  });
  it('a new drag during a settle completes the settle instantly first', () => {
    const b = make();
    b.dragStart(O);
    b.dragMove(-0.9);
    b.dragEnd(-1, 400, 0);
    b.tick(16);
    b.dragStart(O);
    expect(b.state.color).toBe(3);
    expect(b.animating).toBe(false);
  });
});

describe('buttons never queue', () => {
  it('step runs p 0 -> 1 in BUTTON_MS (220 ms) with the button center as origin', () => {
    const b = make();
    expect(b.step(1, O, 1000)).toBe(true);
    expect(b.state.dye).toMatchObject({ from: 2, to: 3, origin: O, p: 0 });
    b.tick(1000 + BUTTON_MS / 2);
    expect(b.state.dye.p).toBeGreaterThan(0.9); // easeOutExpo front-loads
    b.tick(1000 + BUTTON_MS);
    expect(b.state.color).toBe(3);
    expect(b.animating).toBe(false);
  });
  it('rapid taps: each tap finishes the previous instantly and starts the next (no queue)', () => {
    const b = make(1);
    b.step(1, O, 0);
    b.step(1, O, 30);
    expect(b.state.color).toBe(2);
    expect(b.state.dye).toMatchObject({ from: 2, to: 3 });
    b.step(1, O, 60);
    expect(b.state.color).toBe(3);
    expect(b.state.dye.to).toBe(4);
    b.step(1, O, 70); // finishes 3 -> 4 instantly; nothing beyond the last color to start
    expect(b.state.color).toBe(4);
    expect(b.state.dye).toMatchObject({ from: 4, to: 4, p: 0 });
    expect(b.animating).toBe(false);
  });
  it('rail tap jumps straight to the color (no intermediate colors)', () => {
    const b = make(1);
    b.go(4, O, 0);
    expect(b.state.dye).toMatchObject({ from: 1, to: 4 });
    run(b, 0, 400);
    expect(b.state.color).toBe(4);
  });
  it('out-of-range or current targets are ignored', () => {
    const b = make();
    expect(b.go(5, O, 0)).toBe(false);
    expect(b.go(2, O, 0)).toBe(false);
    expect(b.animating).toBe(false);
  });
  it('a button press during a drag cancels the drag and proceeds', () => {
    const b = make();
    b.dragStart(O);
    b.dragMove(-0.2);
    expect(b.go(4, O, 0)).toBe(true);
    expect(b.state.dye).toMatchObject({ from: 2, to: 4 });
  });
  it('reduced motion lands instantly', () => {
    const b = make();
    b.reduced = true;
    b.step(1, O, 0);
    expect(b.state.color).toBe(3);
    expect(b.animating).toBe(false);
  });
});

describe('page state', () => {
  it('deck -> opening -> detail -> closing -> deck', () => {
    const b = make();
    expect(b.open(true)).toBe(true);
    expect(b.state.page).toBe('opening');
    b.pageDone();
    expect(b.state.page).toBe('detail');
    expect(b.close(true)).toBe(true);
    expect(b.state.page).toBe('closing');
    b.pageDone();
    expect(b.state.page).toBe('deck');
  });
  it('open/close are idempotent and can interrupt each other', () => {
    const b = make();
    expect(b.close(true)).toBe(false);
    b.open(true);
    expect(b.open(true)).toBe(false);
    b.close(true);
    expect(b.open(true)).toBe(true); // reopening during the close is allowed
    expect(b.state.page).toBe('opening');
  });
  it('direct load / reduced motion skip the transition states', () => {
    const b = make();
    b.open(false);
    expect(b.state.page).toBe('detail');
    b.close(false);
    expect(b.state.page).toBe('deck');
    b.reduced = true;
    b.open(true);
    expect(b.state.page).toBe('detail');
  });
  it('open completes a running color transition and resets the angle', () => {
    const b = make();
    b.step(1, O, 0);
    b.setAngle(3);
    b.open(true);
    expect(b.state.color).toBe(3);
    expect(b.state.angle).toBe(0);
  });
  it('color change in detail is what the deck lands on after close', () => {
    const b = make();
    b.open(true);
    const seen: number[] = [];
    b.committed = (c) => seen.push(c);
    expect(b.setColor(4, O)).toBe(true);
    b.close(true);
    expect(b.state.color).toBe(4);
    expect(b.state.dye).toMatchObject({ from: 4, to: 4, p: 0 });
    expect(seen).toEqual([4]);
  });
  it('angle wraps', () => {
    const b = make();
    b.setAngle(-1);
    expect(b.state.angle).toBe(3);
    b.setAngle(4);
    expect(b.state.angle).toBe(0);
  });
  it('transitions never block color or angle changes (animations do not gate input)', () => {
    const b = make();
    b.open(true);
    expect(b.state.page).toBe('opening');
    expect(b.setColor(3, O)).toBe(true);
    b.setAngle(2);
    expect(b.state).toMatchObject({ color: 3, angle: 2 });
  });
});
