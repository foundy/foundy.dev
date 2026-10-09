// GL presentation layer. Owns ONE progress p (0 deck .. 1 detail) driven by a near-critical spring;
// every transition is a pure function of (p, p-dot, direction, press). Interruption just retargets the spring
// from the current (p, v). Between animations nothing renders (the canvas keeps its last frame).
import type { RGB } from '../data';
import { Gfx } from './gfx';
import { fade } from './transitions/fade';
import { lift } from './transitions/lift';
import { optic } from './transitions/optic';
import { tunnel } from './transitions/tunnel';
import type { DeckView, Env, Rect, Transition } from './types';

export const TRANSITIONS: Transition[] = [lift, optic, tunnel];
export type Mode = 'deck' | 'trans' | 'detail';

export interface Hooks {
  slot(): Rect;
  /** the hero's CURRENT dom rect (viewport coords) or null when it is not laid out */
  hero(): Rect | null;
  opened(): void;
  closed(): void;
  lost(): void;
}

const PRESS_W = 45; // critically damped press follower, 1/s
const WOB_K = 900;
const WOB_C = 7;

export class Engine {
  readonly g: Gfx;
  mode: Mode = 'deck';
  p = 0;
  v = 0;
  target: 0 | 1 = 0;
  tr: Transition = lift;
  run: Transition = lift;
  press = 0;
  pressT = 0;
  private pressV = 0;
  wob = 0;
  private wobV = 0;
  hold = false; // debug: freeze p (scrub) / keep the GL frame at the end instead of handing off
  view: DeckView = { from: 0, to: 0, dyeP: 0, edge: 0, tone: [220, 220, 220], dx: 0 };
  ink: RGB = [200, 200, 200];
  heroPath: string | null = null;
  private tap: [number, number] = [0, 0];
  private slot: Rect = { x: 0, y: 0, w: 1, h: 1 };
  private heroR: Rect = { x: 0, y: 0, w: 1, h: 1 };
  private last = 0;
  private running = false;
  private dirty = true;
  lost = false;
  // frame stats (only frames inside a continuous animation run)
  private dts: number[] = [];
  private longest = 0;
  private slow = 0;
  private nDt = 0;
  private shown = false;

  constructor(readonly canvas: HTMLCanvasElement, private hooks: Hooks) {
    this.g = new Gfx(canvas);
    this.g.onReady = () => this.invalidate();
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
      this.hide();
      hooks.lost();
    });
    // compile everything up front so the first tap never pays for it
    for (const t of [...TRANSITIONS, fade]) t.draw(this.g, this.env(true));
  }

  setTransition(id: string) {
    const t = TRANSITIONS.find((x) => x.id === id);
    if (t && this.mode === 'deck') this.tr = t;
    this.invalidate();
  }
  get busy() {
    return this.mode === 'trans';
  }
  get name() {
    return this.mode === 'trans' ? this.run.id : this.tr.id;
  }

  layout() {
    const c = this.canvas;
    const was = this.shown;
    if (!was) c.style.display = 'block';
    const W = innerWidth;
    const H = c.clientHeight || innerHeight;
    if (!was) c.style.display = 'none';
    this.g.resize(W, H, innerHeight / 2 / H);
    this.slot = this.hooks.slot();
    this.invalidate();
  }
  show() {
    if (!this.shown) {
      this.canvas.style.display = 'block';
      this.shown = true;
    }
  }
  hide() {
    this.canvas.style.display = 'none';
    this.shown = false;
  }

  setView(v: DeckView) {
    this.view = v;
    this.invalidate();
  }
  invalidate() {
    this.dirty = true;
  }
  want(paths: string[]) {
    this.g.want(paths);
  }
  setPress(on: boolean, x?: number, y?: number) {
    if (this.mode !== 'deck' || this.lost) return;
    this.pressT = on ? 1 : 0;
    if (on && x !== undefined && y !== undefined) this.setTap(x, y);
  }
  setTap(x: number, y: number) {
    this.tap = [x, y];
    const s = this.slot;
    this.g.tapUV = [Math.min(1, Math.max(0, (x - s.x) / s.w)), Math.min(1, Math.max(0, (y - s.y) / s.h))];
  }

  // ---- control -------------------------------------------------------------------------------
  open(x?: number, y?: number) {
    if (this.lost || this.mode === 'detail') return;
    if (x !== undefined && y !== undefined) this.setTap(x, y);
    else if (this.pressT === 0) this.setTap(this.slot.x + this.slot.w / 2, this.slot.y + this.slot.h / 2);
    this.pressT = 0;
    if (this.mode === 'deck') {
      this.run = this.tr;
      this.p = 0;
      this.v = 0;
    }
    this.target = 1;
    this.mode = 'trans';
    this.show();
    this.kickStart();
  }
  /** returns true when GL owns the close (caller must hide the dom hero right now) */
  close(forceFade = false): boolean {
    if (this.lost || this.mode === 'deck') return false;
    if (this.mode === 'detail') {
      const h = this.hooks.hero();
      const H = this.g.H;
      const visible = !forceFade && !!h && h.y + h.h * 0.4 > 0 && h.y < H * 0.75;
      this.run = visible ? this.tr : fade;
      this.p = 1;
      this.v = 0;
      this.mode = 'trans';
      this.show();
    }
    this.target = 0;
    this.pressT = 0;
    this.kickStart();
    this.last = performance.now(); // dt = 0 on the first frame: p stays exactly 1 and the first GL frame equals the dom
    this.renderNow();
    return true;
  }
  /** a closing transition is cut short (deck input during the close must never be dropped) */
  snapClose(): boolean {
    if (this.mode !== 'trans') return true;
    if (this.target === 1) return false;
    this.p = 0;
    this.v = 0;
    this.dirty = true;
    this.finish();
    return true;
  }
  private kickStart() {
    this.dirty = true;
  }

  // ---- debug scrub -------------------------------------------------------------------------------
  scrub(p: number, open: boolean, tr?: string) {
    this.hold = true;
    if (tr) this.tr = TRANSITIONS.find((x) => x.id === tr) ?? this.tr;
    this.run = this.tr;
    this.mode = 'trans';
    this.target = open ? 1 : 0;
    this.p = p;
    this.v = 0;
    this.show();
    this.renderNow();
  }
  release() {
    this.hold = false;
    if (this.mode === 'trans' && Math.abs(this.p - this.target) < 1e-3) this.finish();
  }

  // ---- frame ---------------------------------------------------------------------------------------
  renderNow() {
    this.measure();
    this.draw();
    this.dirty = false;
  }

  /** advance physics and draw. Returns true while more frames are needed. */
  frame(now: number): boolean {
    if (this.lost) return false;
    let dt = (now - this.last) / 1000;
    const cont = this.running && dt < 0.1;
    if (!this.running) dt = 1 / 60;
    this.last = now;
    if (cont) {
      const ms = dt * 1000;
      this.dts.push(ms);
      if (this.dts.length > 240) this.dts.shift();
      this.nDt++;
      if (ms > 33.4) this.slow++;
      if (ms > this.longest) this.longest = ms;
    }
    dt = Math.min(dt, 1 / 20);
    let anim = false;
    // press follower
    if (this.press !== this.pressT || this.pressV !== 0) {
      const n = Math.ceil(dt / 0.004), h = dt / n;
      for (let i = 0; i < n; i++) {
        this.pressV += (-PRESS_W * PRESS_W * (this.press - this.pressT) - 2 * PRESS_W * this.pressV) * h;
        this.press += this.pressV * h;
      }
      if (Math.abs(this.press - this.pressT) < 0.002 && Math.abs(this.pressV) < 0.02) {
        this.press = this.pressT;
        this.pressV = 0;
      } else anim = true;
      this.dirty = true;
    }
    if (this.wob !== 0 || this.wobV !== 0) {
      const n = Math.ceil(dt / 0.004), h = dt / n;
      for (let i = 0; i < n; i++) {
        this.wobV += (-WOB_K * this.wob - WOB_C * this.wobV) * h;
        this.wob += this.wobV * h;
      }
      if (Math.abs(this.wob) < 0.03 && Math.abs(this.wobV) < 1) this.wob = this.wobV = 0;
      else anim = true;
      this.dirty = true;
    }
    if (this.mode === 'trans' && !this.hold) {
      const cfg = this.target ? this.run.open : this.run.close;
      const n = Math.ceil(dt / 0.004), h = dt / n;
      for (let i = 0; i < n; i++) {
        this.v += (-cfg.k * (this.p - this.target) - cfg.c * this.v) * h;
        this.p += this.v * h;
      }
      if (this.p > 1) (this.p = 1), (this.v = Math.min(0, this.v));
      if (this.p < 0) (this.p = 0), (this.v = Math.max(0, this.v));
      this.dirty = true;
      if (Math.abs(this.p - this.target) < 0.0006 && Math.abs(this.v) < 0.02) {
        this.p = this.target;
        this.v = 0;
        this.measure();
        this.draw();
        this.dirty = false;
        this.finish();
        this.running = this.wob !== 0;
        return this.running;
      }
      anim = true;
    }
    if (this.mode !== 'trans' && this.g.busyUploads) {
      this.g.pump();
      this.dirty = true;
    }
    if (this.dirty && this.mode !== 'detail') {
      this.measure();
      this.draw();
      this.dirty = false;
    }
    this.running = anim || this.g.busyUploads > 0;
    return this.running;
  }

  private finish() {
    if (this.target === 1) {
      this.mode = 'detail';
      if (!this.hold) {
        this.hooks.opened();
      }
    } else {
      this.mode = 'deck';
      if (this.run.wobble) this.wobV = 120;
      if (!this.hold) this.hooks.closed();
    }
  }

  /** dom has taken over (called by the host on the frame after it showed the hero) */
  handoffDone() {
    this.hide();
  }

  private measure() {
    this.slot = this.hooks.slot();
    if (this.mode === 'trans') {
      const h = this.hooks.hero();
      if (h) this.heroR = h;
    }
  }

  private env(compile = false): Env {
    const s = this.slot;
    return {
      p: compile ? 0.5 : this.p,
      v: this.v,
      open: this.target === 1,
      press: this.press,
      wob: this.wob,
      W: this.g.W,
      H: this.g.H,
      slot: s,
      hero: compile ? { x: 0, y: 0, w: s.w * 1.1, h: s.h * 1.1 } : this.heroR,
      tap: this.tap,
      tone: this.view.tone,
      ink: this.ink,
      heroPath: this.heroPath,
      deck: this.view,
    };
  }

  private draw() {
    const g = this.g;
    if (g.W < 2 || this.canvas.width < 2) return;
    const e = this.env();
    if (this.mode === 'trans') this.run.draw(g, e);
    else if (this.press > 0.002) this.tr.draw(g, e);
    else drawDeck(g, e);
  }

  stats() {
    const d = [...this.dts].sort((a, b) => a - b);
    const q = (x: number) => (d.length ? d[Math.min(d.length - 1, Math.floor(d.length * x))] : 0);
    const st = this.g.stats();
    return {
      p50: q(0.5),
      p95: q(0.95),
      slow: this.nDt ? this.slow / this.nDt : 0,
      longest: this.longest,
      renderer: this.g.renderer,
      textures: st.textures,
      mb: st.mb,
    };
  }
  resetStats() {
    this.dts.length = 0;
    this.longest = this.slow = this.nDt = 0;
  }
}

/** the resting / dragging deck (no transition running) */
export function drawDeck(g: Gfx, e: Env) {
  g.bg(e.tone);
  g.backs(e, {}, e.wob);
  const s = e.slot;
  const out = e.deck.to !== e.deck.from ? e.deck.dyeP : 0;
  g.shadow({ x: s.x + e.deck.dx, y: s.y, w: s.w, h: s.h }, 28, 16, 0.2 * (1 - out), 12);
  g.front(e, {}, e.wob);
}
