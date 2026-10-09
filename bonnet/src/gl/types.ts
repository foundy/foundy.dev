import type { RGB } from '../data';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the deck is showing right now (derived from the M0a state model). */
export interface DeckView {
  from: number;
  to: number;
  /** |dx| / stage width while dragging / settling (0..1) */
  dyeP: number;
  /** -1 | 0 | 1 over-drag at the end of the deck */
  edge: number;
  tone: RGB;
  /** tilt / specular driver: signed dx in css px */
  dx: number;
}

/** Everything a transition needs for one frame. All visuals are pure functions of (p, v, open, press, ...). */
export interface Env {
  /** progress 0 = deck, 1 = detail */
  p: number;
  /** progress velocity, per second */
  v: number;
  /** spring target is 1 (opening) */
  open: boolean;
  /** pointer-down press amount 0..1 (own critically damped follower) */
  press: number;
  /** damped landing wobble, css px */
  wob: number;
  W: number;
  H: number;
  slot: Rect;
  hero: Rect;
  tap: [number, number];
  tone: RGB;
  ink: RGB;
  /** path of the image the hero currently shows (null = the deck image) */
  heroPath: string | null;
  deck: DeckView;
}

export interface SpringCfg {
  k: number;
  c: number;
}

export interface Transition {
  id: string;
  open: SpringCfg;
  close: SpringCfg;
  /** landing wobble after close */
  wobble?: boolean;
  draw(g: import('./gfx').Gfx, e: Env): void;
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const range = (x: number, a: number, b: number) => clamp01((x - a) / (b - a));
export const smooth = (x: number, a: number, b: number) => {
  const t = range(x, a, b);
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeOut3 = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
