// Core state machine, shared by both worlds. DOM-free and clock-injected so it can be unit tested.
//   world : light | water   which renderer draws the browse view
//   index : committed product index (what the page is "on")
//   page  : browse | opening | detail | closing
//   p/pv  : open progress 0 (browse) .. 1 (detail) and its velocity; ONE spring for both worlds
//   sw    : world switch in flight (crossfade), t = 0..1 fraction of the NEW world
import { spring } from './commit';

export type WorldId = 'light' | 'water';
export const WORLDS: WorldId[] = ['light', 'water'];
export type Page = 'browse' | 'opening' | 'detail' | 'closing';
export interface Switch {
  from: WorldId;
  t: number;
}
export interface CoreState {
  world: WorldId;
  index: number;
  page: Page;
  p: number;
  pv: number;
  sw: Switch | null;
}
export interface SpringCfg {
  open: number;
  close: number;
  /** snap to the target when this close; lets a world finish its tail early */
  snap: number;
}
export const DEFAULT_SPRING: SpringCfg = { open: 7, close: 9, snap: 0.0006 };
export const SWITCH_S = 0.6;

export class Core {
  state: CoreState;
  /** reduced motion: no animation, pages change instantly */
  reduced = false;

  constructor(readonly n: number, world: WorldId, index: number) {
    this.state = { world, index: Math.max(0, Math.min(n - 1, index)), page: 'browse', p: 0, pv: 0, sw: null };
  }

  get target(): 0 | 1 {
    const pg = this.state.page;
    return pg === 'opening' || pg === 'detail' ? 1 : 0;
  }
  /** a page change is in flight (spring running or handoff pending) */
  get transitioning() {
    return this.state.page === 'opening' || this.state.page === 'closing';
  }

  // ---- product index (browse only) -----------------------------------------------------------
  setIndex(i: number): boolean {
    const s = this.state;
    if (s.page !== 'browse' || i < 0 || i >= this.n || i === s.index) return false;
    s.index = i;
    return true;
  }
  /** next index in direction dir, or -1 at the ends */
  neighbor(dir: 1 | -1): number {
    const i = this.state.index + dir;
    return i >= 0 && i < this.n ? i : -1;
  }
  step(dir: 1 | -1): number {
    const to = this.neighbor(dir);
    return to >= 0 && this.setIndex(to) ? to : -1;
  }
  /** detail opened by history navigation with a different product */
  forceIndex(i: number) {
    if (i >= 0 && i < this.n) this.state.index = i;
  }

  // ---- page --------------------------------------------------------------------------------
  open(animated: boolean): boolean {
    const s = this.state;
    if (s.page === 'opening' || s.page === 'detail') return false;
    s.sw = null;
    if (animated && !this.reduced) s.page = 'opening';
    else (s.page = 'detail'), (s.p = 1), (s.pv = 0);
    return true;
  }
  /** close from opening (retargets the spring from the current p, v) or from detail */
  close(animated: boolean): boolean {
    const s = this.state;
    if (s.page === 'browse' || s.page === 'closing') return false;
    if (animated && !this.reduced) s.page = 'closing';
    else (s.page = 'browse'), (s.p = 0), (s.pv = 0);
    return true;
  }
  /** the spring reached its target (and the view finished its hand-off): opening -> detail, closing -> browse */
  settle(): Page {
    const s = this.state;
    if (s.page === 'opening') (s.page = 'detail'), (s.p = 1), (s.pv = 0);
    else if (s.page === 'closing') (s.page = 'browse'), (s.p = 0), (s.pv = 0);
    return s.page;
  }
  /** p has reached the end of its current direction */
  get arrived(): boolean {
    return this.state.p === this.target && this.state.pv === 0;
  }

  // ---- world switch --------------------------------------------------------------------------
  switchWorld(w: WorldId): boolean {
    const s = this.state;
    if (s.page !== 'browse' || w === s.world) return false;
    if (this.reduced) {
      s.world = w;
      s.sw = null;
      return true;
    }
    if (s.sw && w === s.sw.from) s.sw = { from: s.world, t: 1 - s.sw.t }; // reverse in place: the mix stays continuous
    else s.sw = { from: s.world, t: 0 };
    s.world = w;
    return true;
  }

  // ---- time --------------------------------------------------------------------------------
  /** advance the open spring and the world switch; returns true while either is still moving */
  tick(dt: number, cfg: SpringCfg = DEFAULT_SPRING): boolean {
    const s = this.state;
    let more = false;
    if (s.sw) {
      s.sw.t += dt / SWITCH_S;
      if (s.sw.t >= 1) s.sw = null;
      else more = true;
    }
    const T = this.target;
    if (s.p !== T || s.pv !== 0) {
      const r = spring(s.p, s.pv, T, dt, T ? cfg.open : cfg.close);
      s.p = r.x;
      s.pv = r.v;
      if (Math.abs(s.p - T) < cfg.snap && Math.abs(s.pv) < Math.max(0.004, cfg.snap * 5)) (s.p = T), (s.pv = 0);
      s.p = Math.min(1, Math.max(0, s.p));
      if (s.p !== T || s.pv !== 0) more = true;
    }
    return more;
  }

  /** eased 0..1 mix for the crossfade (smoothstep of sw.t) */
  get mix(): number {
    const t = this.state.sw ? this.state.sw.t : 1;
    return t * t * (3 - 2 * t);
  }
}
