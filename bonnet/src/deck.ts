// State model + transitions. DOM-free and clock-injected so it can be unit tested.
// The four state slices are independent on purpose (M1 hangs a GL wavefront off `dye`):
//   page  : deck | opening | detail | closing
//   color : committed colour index (what the page is "on")
//   angle : detail photo angle
//   dye   : { from, to, origin, p }  one object shared by every renderer (DOM now, GL later)
import { available, neighbor } from './data';
import { BUTTON_MS, decide, easeOutExpo, spring } from './motion';

export type Page = 'deck' | 'opening' | 'detail' | 'closing';
export interface Point {
  x: number;
  y: number;
}
export interface Dye {
  from: number;
  to: number;
  origin: Point;
  p: number;
}
export interface State {
  page: Page;
  color: number;
  angle: number;
  dye: Dye;
  /** -1 | 0 | 1: sign of dx during an over-drag at the end of the deck (dye.p then carries the resisted amount) */
  edge: number;
}

type Anim =
  | { kind: 'ease'; t0: number; target: 1 }
  | { kind: 'spring'; t0: number; p0: number; v0: number; target: 0 | 1 };

export const EDGE_RESIST = 0.18;

export class Bonnet {
  state: State;
  reduced = false;
  /** every state mutation ends in render(); committed() fires when the colour actually changes */
  render: () => void = () => {};
  committed: (color: number) => void = () => {};
  private anim: Anim | null = null;
  private dragging = false;

  constructor(color: number, center: Point = { x: 0, y: 0 }) {
    this.state = { page: 'deck', color, angle: 0, dye: { from: color, to: color, origin: center, p: 0 }, edge: 0 };
  }

  get animating() {
    return this.anim !== null;
  }

  // ---- drag (deck swipe) -------------------------------------------------------------------
  dragStart(origin: Point) {
    this.finish();
    this.dragging = true;
    this.state.dye = { from: this.state.color, to: this.state.color, origin, p: 0 };
    this.state.edge = 0;
  }

  /** signed progress dx/width, measured from the first pixel: p < 0 drags toward the next colour */
  dragMove(p: number) {
    if (!this.dragging) return;
    const s = this.state;
    const dir = p < 0 ? 1 : -1;
    const to = p === 0 ? s.color : neighbor(s.color, dir);
    const abs = Math.abs(p);
    if (to < 0 || p === 0) {
      s.dye.to = s.color;
      s.dye.p = abs * EDGE_RESIST;
      s.edge = p === 0 ? 0 : -dir;
    } else {
      s.dye.to = to;
      s.dye.p = abs;
      s.edge = 0;
    }
    this.render();
  }

  /** v = signed pointer velocity in px/ms, width in px */
  dragEnd(v: number, width: number, now: number) {
    if (!this.dragging) return;
    this.dragging = false;
    const s = this.state;
    const crossing = s.dye.to !== s.color;
    const dirSign = s.edge !== 0 ? s.edge : crossing ? (s.dye.to > s.color ? -1 : 1) : 0; // sign of dx
    const vAlong = dirSign === 0 ? 0 : v * dirSign;
    const commit = crossing && decide(s.dye.p, vAlong) === 'commit';
    this.settle(commit ? 1 : 0, (vAlong * 1000) / width, now);
  }

  dragCancel(now: number) {
    if (!this.dragging) return;
    this.dragging = false;
    this.settle(0, 0, now);
  }

  private settle(target: 0 | 1, v0: number, now: number) {
    const s = this.state;
    if (this.reduced) {
      this.land(target === 1);
      return;
    }
    this.anim = { kind: 'spring', t0: now, p0: s.dye.p, v0, target };
    this.render();
  }

  // ---- buttons / keys / rail ---------------------------------------------------------------
  /** Jump to colour `to`. Never queues: any running transition is completed instantly first. */
  go(to: number, origin: Point, now: number) {
    if (this.dragging) this.dragCancel(now);
    this.finish();
    const s = this.state;
    if (!available(to) || to === s.color) return false;
    s.dye = { from: s.color, to, origin, p: 0 };
    s.edge = 0;
    if (this.reduced) {
      this.land(true);
    } else {
      this.anim = { kind: 'ease', t0: now, target: 1 };
      this.render();
    }
    return true;
  }

  step(dir: 1 | -1, origin: Point, now: number) {
    this.finish(); // so repeated taps advance one step each from the up-to-date colour
    const to = neighbor(this.state.color, dir);
    return to >= 0 && this.go(to, origin, now);
  }

  /** advance the running animation; returns true while more frames are needed */
  tick(now: number): boolean {
    const a = this.anim;
    if (!a) return false;
    const s = this.state;
    if (a.kind === 'ease') {
      const t = (now - a.t0) / BUTTON_MS;
      s.dye.p = easeOutExpo(t);
      if (t >= 1) {
        this.land(true);
        return false;
      }
    } else {
      const t = (now - a.t0) / 1000;
      const r = spring(a.p0, a.v0, a.target, t);
      s.dye.p = Math.min(1, Math.max(0, r.x));
      if (t > 0.08 && Math.abs(r.x - a.target) < 0.0015 && Math.abs(r.v) < 0.05) {
        this.land(a.target === 1);
        return false;
      }
    }
    this.render();
    return true;
  }

  /** complete whatever is running right now */
  finish() {
    const a = this.anim;
    if (a) this.land(a.target === 1);
  }

  private land(commit: boolean) {
    const s = this.state;
    this.anim = null;
    const changed = commit && s.dye.to !== s.color;
    if (changed) s.color = s.dye.to;
    s.dye = { from: s.color, to: s.color, origin: s.dye.origin, p: 0 };
    s.edge = 0;
    this.render();
    if (changed) this.committed(s.color);
  }

  // ---- page --------------------------------------------------------------------------------
  open(animated: boolean) {
    const s = this.state;
    if (s.page === 'opening' || s.page === 'detail') return false;
    this.finish();
    s.angle = 0;
    s.page = animated && !this.reduced ? 'opening' : 'detail';
    this.render();
    return true;
  }

  close(animated: boolean) {
    const s = this.state;
    if (s.page === 'deck' || s.page === 'closing') return false;
    s.page = animated && !this.reduced ? 'closing' : 'deck';
    this.render();
    return true;
  }

  /** end of the opening / closing transition (timer in the view layer) */
  pageDone() {
    const s = this.state;
    if (s.page === 'opening') s.page = 'detail';
    else if (s.page === 'closing') s.page = 'deck';
    else return;
    this.render();
  }

  /** detail swatch: change colour with no deck animation (the hero crossfades in the view) */
  setColor(color: number, origin: Point) {
    this.finish();
    const s = this.state;
    if (!available(color) || color === s.color) return false;
    s.color = color;
    s.dye = { from: color, to: color, origin, p: 0 };
    this.render();
    this.committed(color);
    return true;
  }

  setAngle(angle: number) {
    this.state.angle = ((angle % 4) + 4) % 4;
    this.render();
  }
}
