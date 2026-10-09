// The contract between the core and a pluggable world.
//
// A world is a PURE RENDERER of core state: it never owns the page, the route or the detail DOM.
// It owns its own presentation physics (carousel position, ripples, dust) and reports what the finger did.
// Phase B renders both worlds into offscreen Targets and composites a world-switch transition: that works
// because render() draws into whatever Target it is given and leaves no GL state behind.
import type { Release } from '../core/commit';
import type { Product, RGB } from '../core/products';
import type { SpringCfg, WorldId } from '../core/state';
import type { GL, Target } from '../gl/context';
import type { Textures } from '../gl/textures';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** everything a world needs for one frame (the core owns all of it) */
export interface View {
  /** committed product index */
  index: number;
  /** open progress: 0 browse .. 1 detail, and its velocity per second */
  p: number;
  pv: number;
  /** the live DOM hero rect in viewport css px; only meaningful while p > 0 */
  hero: Rect;
  /** the current product's page tone: the colour the world must land on at p = 1 */
  tone: RGB;
  ink: RGB;
  /** seconds, monotonic */
  time: number;
}

export type DragPhase = 'start' | 'move' | 'end' | 'cancel';
export interface DragPoint {
  /** absolute finger position (viewport css px) */
  x: number;
  y: number;
  /** displacement from the pointer-down position, measured from the first pixel */
  dx: number;
  dy: number;
  /** horizontal velocity px/ms (window of the last 90 ms) */
  vx: number;
  now: number;
}

/** how much the world wants the loop to keep running */
export const Wake = {
  Sleep: 0,
  Active: 1,
  /** ambient animation only: ~30 fps is plenty */
  Idle: 2,
} as const;
export type Wake = (typeof Wake)[keyof typeof Wake];

export interface Host {
  g: GL;
  textures: Textures;
  products: Product[];
  /** ask for another frame */
  wake(): void;
}

export interface World {
  readonly id: WorldId;
  /** open / close spring of the page transition (rad/s) and where it snaps to the end */
  readonly spring: SpringCfg;
  /** [from, to]: the detail text appears when p is inside this range (the world decides when its light has settled) */
  readonly textRange: [number, number];
  /** compile programs, allocate buffers (never on a tap frame) */
  init(host: Host): void;
  /** the world has just become the visible one (switch-in / first show): play its welcome (lamp on, hello ripple) */
  enter?(): void;
  resize(W: number, H: number, dpr: number): void;
  /** make `i` the target product; immediate snaps, otherwise a critically damped spring from the current position and velocity */
  setIndex(i: number, immediate?: boolean): void;
  /** finger on the world: it sticks to the finger 1:1 from the first pixel. 'end' returns the release for the core to decide */
  drag(phase: DragPhase, pt: DragPoint): Release | undefined;
  /** what a tap at (x,y) means in this world */
  hit(x: number, y: number): 'open' | 'prev' | 'next' | 'none';
  /** px per product step at the finger */
  slotPx(): number;
  /** the product nearest to the current position (captions follow this) */
  nearest(): number;
  /** at rest on its target and not held by a finger */
  settled(): boolean;
  /** debug/test: screen centre of the product the finger holds (or the current one) */
  probe(): { x: number; y: number } | null;
  /** advance the world's own physics by dt and draw one frame into `to` */
  render(dt: number, v: View, to: Target): Wake;
  wake(): void;
  sleep(): void;
  dispose(): void;
}
