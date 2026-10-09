// WATER world: products rest under a still, glossy pool. A wave simulation (ping-pong, float or packed-byte) is only
// stimulated by the finger, the wake of a moving product and the rise/sink thresholds; at rest it is flat and the
// loop sleeps. Sticky drag: the product under the finger moves 1:1 with it (x = (i - s) * spacing, s = s0 - dx / spacing),
// tilts a little, leaves a wake; the next product rises in coupled to the drag progress.
import { SETTLE_OMEGA, Velocity, clamp, smooth, spring } from '../../core/commit';
import type { Release } from '../../core/commit';
import type { SpringCfg } from '../../core/state';
import { FULLSCREEN_VS, type Prog, type Target } from '../../gl/context';
import { LAYER_W } from '../../gl/textures';
import { Wake, type DragPhase, type DragPoint, type Host, type View, type World } from '../types';
import { DERIVE, RENDER, SIM } from './shaders';

const SIM_HZ = 200, C2 = 0.42, DAMP = 0.9978;
const GRAB_FOLLOW = 18; // 1/s: how fast the product settles into / out of the finger's hold
const RUBBER = 0.35; // over-drag at the ends of the list
const TILT_V = 0.011; // rad per (slot/s) of velocity
export const WATER_SPRING: SpringCfg = { open: 5.4, close: 5.4, snap: 0.0006 };

type Mode = 'f32' | 'f16' | 'u8';

export class WaterWorld implements World {
  readonly id = 'water' as const;
  readonly spring = WATER_SPRING;
  readonly textRange: [number, number] = [0.5, 0.9];
  private h!: Host;
  private gl!: WebGL2RenderingContext;
  private mode: Mode = 'u8';
  private progs!: { sim: Prog; derive: Prog; render: Prog };
  private tex: WebGLTexture[] = [];
  private fbo: WebGLFramebuffer[] = [];
  private surfTex: WebGLTexture | null = null;
  private surfFbo: WebGLFramebuffer | null = null;
  private cur = 0;
  private drops: number[] = [];
  private rect = new Float32Array(4);
  private rectP = new Float32Array(4);
  private inks = new Float32Array(24);
  private simW = 2;
  private simH = 2;
  private cell = 2;
  private mobile = false;
  private W = 1;
  private H = 1;
  private N = 1;
  private slopeK = 15;
  private lapK = 14;
  /** CPU-side estimate of live wave energy so the loop can sleep without a GPU read-back */
  private energy = 0;
  private acc = 0;
  private awakeUntil = 0;
  private dirty = false;
  // layout
  private pool: [number, number, number, number] = [0, 0, 1, 1];
  private spacing = 1;
  // carousel
  private s = 0;
  private sv = 0;
  private sTarget = 0;
  private dragging = false;
  private s0 = 0;
  private idx0 = 0;
  private vel = new Velocity();
  private grab = 0;
  private grabT = 0;
  private tiltV = 0;
  private fx = 0;
  private fy = 0;
  private prevP = 0;
  private entered = -1;
  private flat = true;
  fmt = '';

  init(host: Host) {
    this.h = host;
    const gl = (this.gl = host.g.gl);
    this.N = host.products.length;
    this.mobile = matchMedia('(hover: none)').matches || Math.min(screen.width, screen.height) < 700;
    host.products.forEach((p, i) => p.ink.forEach((v, j) => (this.inks[i * 3 + j] = v / 255)));
    this.pickFormat();
    this.fmt = this.mode;
    const defs = this.mode === 'u8' ? '' : '#define FLOATTEX\n';
    const mk = (fs: string) => host.g.program(FULLSCREEN_VS, fs.replace('precision highp float;', 'precision highp float;\n' + defs));
    this.progs = { sim: mk(SIM), derive: mk(DERIVE), render: mk(RENDER) };
    void gl;
  }

  private pickFormat() {
    const gl = this.gl;
    const cbf = gl.getExtension('EXT_color_buffer_float');
    const cbh = gl.getExtension('EXT_color_buffer_half_float');
    const test = (ifmt: number, type: number) => {
      const t = gl.createTexture()!;
      const f = gl.createFramebuffer()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, 4, 4, 0, gl.RGBA, type, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(f);
      gl.deleteTexture(t);
      return ok;
    };
    if (cbf && test(gl.RGBA32F, gl.FLOAT)) this.mode = 'f32';
    else if ((cbf || cbh) && test(gl.RGBA16F, gl.HALF_FLOAT)) this.mode = 'f16';
    else this.mode = 'u8';
    if (new URLSearchParams(location.search).get('fmt') === 'u8') this.mode = 'u8';
  }

  private target(w: number, h: number, ifmt: number, fmt: number, type: number, filter: number) {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const f = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { t, f };
  }

  resize(W: number, H: number, _dpr: number) {
    void _dpr;
    const gl = this.gl;
    this.W = W;
    this.H = H;
    // layout: a 4:5 pool card; neighbours peek in from the sides
    const fh = Math.min(H * 0.56, (W * 0.78) / 0.8, 760);
    const fw = fh * 0.8;
    this.pool = [W / 2, H * 0.465, fw, fh];
    this.spacing = clamp(W / 2 - 46 + 0.4 * fw, fw * 0.62, fw * 1.05);
    const area = this.mobile ? 72000 : 150000;
    this.cell = Math.sqrt((W * H) / area);
    this.simW = Math.max(32, Math.round(W / this.cell));
    this.simH = Math.max(32, Math.round(H / this.cell));
    for (const t of this.tex) gl.deleteTexture(t);
    for (const f of this.fbo) gl.deleteFramebuffer(f);
    if (this.surfTex) gl.deleteTexture(this.surfTex);
    if (this.surfFbo) gl.deleteFramebuffer(this.surfFbo);
    this.tex = [];
    this.fbo = [];
    const m = this.mode;
    const spec = m === 'f32' ? [gl.RGBA32F, gl.RGBA, gl.FLOAT] : m === 'f16' ? [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT] : [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE];
    for (let i = 0; i < 2; i++) {
      const r = this.target(this.simW, this.simH, spec[0], spec[1], spec[2], gl.NEAREST);
      this.tex.push(r.t);
      this.fbo.push(r.f);
    }
    if (m === 'u8') this.clearState();
    const sp = m === 'u8' ? [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE] : [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT];
    const s = this.target(this.simW, this.simH, sp[0], sp[1], sp[2], gl.LINEAR);
    this.surfTex = s.t;
    this.surfFbo = s.f;
    if (m === 'u8') this.fillSurfFlat();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.drops.length = 0;
    this.energy = 0;
    this.flat = true;
    this.wake();
  }

  /** u8 mode: zero is not byte 0, so state/surface must be seeded explicitly */
  private clearState() {
    const gl = this.gl;
    const z = new Uint8Array(this.simW * this.simH * 4);
    for (let i = 0; i < z.length; i += 4) {
      z[i] = 128;
      z[i + 1] = 0;
      z[i + 2] = 128;
      z[i + 3] = 0;
    }
    for (const t of this.tex) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.simW, this.simH, gl.RGBA, gl.UNSIGNED_BYTE, z);
    }
  }
  private fillSurfFlat() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.surfFbo);
    gl.clearColor(0.5, 0.5, 0.5, 0.5);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  /** wipe the sim to a perfectly flat state (the water has fully settled: no pop, no residue) */
  private flatten() {
    const gl = this.gl;
    if (this.mode === 'u8') {
      this.clearState();
      this.fillSurfFlat();
    } else
      for (const f of [...this.fbo, this.surfFbo!]) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.drops.length = 0;
    this.flat = true;
  }

  /** impulse; x,y css px (y DOWN), radius css px, strength in sim velocity units (negative = pressed down) */
  private drop(x: number, y: number, radius: number, strength: number) {
    if (this.drops.length > 4 * 40) return;
    this.energy += Math.abs(strength) * (radius / 17);
    this.drops.push(x / this.cell, this.simH - y / this.cell, Math.max(2, radius / this.cell), strength);
    this.dirty = true;
    this.flat = false;
  }
  private setRect(x: number, y: number, w: number, h: number, inside: number, ring: number, rad: number) {
    const c = this.cell;
    this.rect.set([x / c, this.simH - y / c, w / 2 / c, h / 2 / c]);
    this.rectP.set([inside, ring, 5, rad / c]);
    this.energy += Math.abs(inside) * 120 + Math.abs(ring) * 4;
    this.dirty = true;
    this.flat = false;
  }

  private stepSim(steps: number) {
    const gl = this.gl;
    const P = this.progs.sim;
    gl.useProgram(P.p);
    gl.viewport(0, 0, this.simW, this.simH);
    gl.uniform2f(P.u.uSize, this.simW, this.simH);
    gl.uniform1f(P.u.uC2, C2);
    gl.uniform1f(P.u.uDamp, DAMP);
    gl.uniform1i(P.u.uState, 0);
    for (let s = 0; s < steps; s++) {
      const n = Math.min(16, this.drops.length / 4);
      const buf = new Float32Array(64);
      for (let i = 0; i < n * 4; i++) buf[i] = this.drops[i];
      this.drops.splice(0, n * 4);
      gl.uniform1i(P.u.uN, n);
      gl.uniform4fv(P.u.uDrops, buf);
      gl.uniform4fv(P.u.uRect, this.rect);
      gl.uniform4fv(P.u.uRectP, this.rectP);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[1 - this.cur]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.cur = 1 - this.cur;
    }
  }

  // ---- World -------------------------------------------------------------------------------------
  setIndex(i: number, immediate = false) {
    if (this.dragging) return;
    this.sTarget = i;
    if (immediate) {
      this.s = i;
      this.sv = 0;
    }
    this.wake();
  }

  slotPx() {
    return this.spacing;
  }
  nearest() {
    return clamp(Math.round(this.s), 0, this.N - 1);
  }
  probe() {
    const i = this.dragging ? this.idx0 : this.nearest();
    return { x: this.pool[0] + (i - this.s) * this.spacing, y: this.pool[1] };
  }

  hit(x: number, y: number): 'open' | 'prev' | 'next' | 'none' {
    const [cx, cy, w, h] = this.pool;
    const i = this.nearest();
    const px = cx + (i - this.s) * this.spacing;
    if (Math.abs(y - cy) > h / 2 + 8) return 'none';
    if (Math.abs(x - px) < w / 2 + 6) return Math.abs(this.s - i) < 0.25 ? 'open' : 'none';
    return x < px ? 'prev' : 'next';
  }

  drag(phase: DragPhase, pt: DragPoint): Release | undefined {
    const L = this.spacing;
    if (phase === 'start') {
      this.dragging = true;
      this.s0 = this.s; // caught mid-settle: the product stays exactly where it is and follows from there
      this.idx0 = this.nearest();
      this.sTarget = this.s;
      this.vel.reset();
      this.vel.push(this.s, pt.now);
      this.fx = pt.x;
      this.fy = pt.y;
      this.grabT = 1;
      this.drop(pt.x, pt.y, 17, -0.3);
    } else if (phase === 'move' && this.dragging) {
      // the finger trail ripples the water
      this.trail(this.fx, this.fy, pt.x, pt.y, 16);
      this.fx = pt.x;
      this.fy = pt.y;
      let ns = this.s0 - pt.dx / L;
      if (ns < 0) ns *= RUBBER;
      else if (ns > this.N - 1) ns = this.N - 1 + (ns - (this.N - 1)) * RUBBER;
      this.s = ns;
      this.vel.push(ns, pt.now);
    } else if ((phase === 'end' || phase === 'cancel') && this.dragging) {
      this.dragging = false;
      this.grabT = 0;
      this.sv = phase === 'end' ? this.vel.read(pt.now) : 0;
      this.sTarget = clamp(Math.round(this.s), 0, this.N - 1);
      if (phase === 'end') return { idx0: this.idx0, q: this.s - this.idx0, v: this.sv, slotPx: L };
    }
    this.wake();
    return undefined;
  }

  private trail(x0: number, y0: number, x1: number, y1: number, dtMs: number) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    if (d < 0.5) return;
    const k = clamp(((d / Math.max(dtMs, 8)) * 1000) / 1800, 0, 1);
    const n = Math.min(10, Math.ceil(d / 9));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      this.drop(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 23 + 10 * k, -(0.035 + 0.11 * k) * Math.min(1, d / n / 9 + 0.25));
    }
  }

  enter() {
    this.entered = 0;
    this.wake();
  }
  wake() {
    this.awakeUntil = Math.max(this.awakeUntil, performance.now() + 400);
    this.h?.wake();
  }
  sleep() {
    /* nothing is running between frames; the loop simply stops calling render() */
  }

  render(dt: number, v: View, to: Target): Wake {
    const g = this.h.g;
    const gl = this.gl;
    const now = v.time * 1000;
    dt = Math.min(dt, 1 / 20);
    const [pcx, pcy, pw, ph] = this.pool;
    const L = this.spacing;

    // ---- physics: the carousel follows the finger (drag) or settles on a critically damped spring
    if (this.dragging) {
      this.sv = this.vel.read(now);
    } else if (this.s !== this.sTarget || this.sv !== 0) {
      const r = spring(this.s, this.sv, this.sTarget, dt, SETTLE_OMEGA);
      this.s = r.x;
      this.sv = r.v;
      if (Math.abs(this.s - this.sTarget) < 0.0004 && Math.abs(this.sv) < 0.004) {
        this.s = this.sTarget;
        this.sv = 0;
      }
    }
    this.grab += (this.grabT - this.grab) * (1 - Math.exp(-GRAB_FOLLOW * dt));
    if (Math.abs(this.grab - this.grabT) < 0.002) this.grab = this.grabT;
    const tiltT = clamp(this.sv * TILT_V, -0.12, 0.12);
    this.tiltV += (tiltT - this.tiltV) * (1 - Math.exp(-22 * dt));

    // ---- stimuli
    const ci = this.nearest();
    const p = v.p;
    const hr: [number, number, number, number] = p > 0 ? [v.hero.x + v.hero.w / 2, v.hero.y + v.hero.h / 2, v.hero.w, v.hero.h] : [pcx, pcy, pw, ph];
    const asv = Math.abs(this.sv);
    if (asv > 0.12 && v.p === 0) {
      // wake behind the moving product, a small bow wave ahead of it
      const xc = pcx + (ci - this.s) * L;
      const dir = -Math.sign(this.sv); // on-screen direction of motion
      for (let k = 0; k < 2; k++) {
        const y = pcy + (Math.random() - 0.5) * ph * 0.9;
        this.drop(xc - dir * pw * 0.5 * 0.9, y, 16, -Math.min(0.03, asv * 0.008) * (0.6 + Math.random() * 0.8));
        this.drop(xc + dir * pw * 0.5 * 0.9, y, 12, Math.min(0.018, asv * 0.005));
      }
    }
    // rise / sink coupling
    const e = smooth(0, 1, p);
    const rcx = pcx + (hr[0] - pcx) * e, rcy = pcy + (hr[1] - pcy) * e;
    const rw = pw + (hr[2] - pw) * e, rh = ph + (hr[3] - ph) * e;
    let inside = 0, ring = 0;
    const crossUp = this.prevP < 0.34 && p >= 0.34, crossDn = this.prevP >= 0.34 && p < 0.34;
    if (p > 0.001 && p < 0.34 && v.pv > 0) inside = 0.0012 * clamp(v.pv, 0, 3.5);
    if (p > 0.34 && p < 0.8 && v.pv > 0.05) ring = -0.0035 * clamp(v.pv, 0, 3);
    if (crossUp) {
      ring = -0.22;
      this.drop(rcx, rcy, pw * 0.55, 0);
      for (let k = 0; k < 4; k++) this.drop(rcx + (Math.random() - 0.5) * rw, rcy + (Math.random() - 0.5) * rh * 0.5, 10 + Math.random() * 8, 0.35);
    }
    if (crossDn && v.pv < 0) {
      ring = 0.12;
      this.drop(rcx, rcy, pw * 0.5, -0.9);
      for (let k = 0; k < 5; k++) this.drop(rcx + (Math.random() - 0.5) * rw * 1.2, rcy + (Math.random() - 0.5) * rh * 0.9, 12 + Math.random() * 10, -0.4 - Math.random() * 0.3);
    }
    if (inside || ring) this.setRect(rcx, rcy, rw, rh, inside, ring, 10);
    else this.rect[2] = 0;
    this.prevP = p;
    // a hello ripple when the world appears
    if (this.entered >= 0 && this.h.textures.has(v.index)) {
      this.entered += dt;
      if (this.entered > 0.2 && this.entered - dt <= 0.2) this.drop(pcx, pcy, pw * 0.3, -0.07);
      if (this.entered > 0.45 && this.entered - dt <= 0.45) {
        this.drop(pcx - pw * 0.2, pcy + ph * 0.28, 22, -0.22);
        this.drop(pcx + pw * 0.3, pcy - ph * 0.3, 18, -0.16);
      }
      if (this.entered > 0.6) this.entered = -1;
    }

    // ---- sim + render
    g.reset();
    this.acc += Math.min(dt, 0.04) * SIM_HZ;
    const steps = Math.min(8, Math.floor(this.acc));
    this.acc -= steps;
    if (this.dirty || this.energy > 0.012) this.stepSim(Math.max(steps, this.drops.length ? 1 : 0));
    this.dirty = false;
    this.draw(v, to, ci);
    this.energy *= Math.pow(0.5, dt / 0.95);

    const moving = this.dragging || this.s !== this.sTarget || this.sv !== 0 || (p > 0 && p < 1) || v.pv !== 0 || this.grab !== this.grabT || Math.abs(this.tiltV) > 0.002;
    const stim = now < this.awakeUntil || this.energy > 0.012 || this.entered >= 0 || this.drops.length > 0;
    if (moving || stim) return Wake.Active;
    if (!this.flat) {
      this.flatten();
      this.rect[2] = 0;
      g.reset();
      this.draw(v, to, ci); // the final, perfectly flat frame
    }
    void gl;
    return Wake.Sleep;
  }

  private draw(v: View, to: Target, cur: number) {
    const g = this.h.g;
    const gl = this.gl;
    // derive surface
    let P = this.progs.derive;
    gl.useProgram(P.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.surfFbo);
    gl.viewport(0, 0, this.simW, this.simH);
    gl.uniform2f(P.u.uSize, this.simW, this.simH);
    gl.uniform1i(P.u.uState, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    P = this.progs.render;
    gl.useProgram(P.p);
    g.bind(to);
    const u = P.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.surfTex);
    gl.uniform1i(u.uSurf, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.h.textures.tex);
    gl.uniform1i(u.uProd, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(u.uRes, this.W, this.H);
    gl.uniform1f(u.uPx, to.w / this.W);
    gl.uniform1f(u.uTime, v.time);
    gl.uniform1f(u.uSeed, 0.37);
    gl.uniform1f(u.uS, this.s);
    gl.uniform1f(u.uSv, this.sv);
    gl.uniform1f(u.uP, clamp(v.p));
    gl.uniform1f(u.uSlopeK, this.slopeK);
    gl.uniform1f(u.uLapK, this.lapK);
    gl.uniform1f(u.uLayerW, LAYER_W);
    gl.uniform1f(u.uHeroRad, 12);
    gl.uniform1f(u.uPoolRad, 12);
    gl.uniform1f(u.uRestZ, 16);
    gl.uniform1f(u.uSpacing, this.spacing);
    gl.uniform1f(u.uDith, v.p < 0.995 ? 1 : 0);
    gl.uniform1f(u.uTilt, this.tiltV * (1 - smooth(0, 0.05, v.p)));
    gl.uniform1f(u.uGrab, this.grab);
    gl.uniform1i(u.uN, this.N);
    gl.uniform1i(u.uCur, cur);
    gl.uniform3fv(u.uInk, this.inks);
    gl.uniform3fv(u.uTone, v.tone.map((x) => x / 255));
    const a = this.h.products[clamp(Math.floor(this.s), 0, this.N - 1)].ink, b = this.h.products[clamp(Math.ceil(this.s), 0, this.N - 1)].ink;
    const f = this.s - Math.floor(this.s);
    gl.uniform3fv(u.uBgInk, a.map((x, i) => (x + (b[i] - x) * f) / 255));
    const up = (r: number[]) => [r[0], this.H - r[1], r[2], r[3]];
    const pool = this.pool;
    const hero: [number, number, number, number] = v.p > 0 ? [v.hero.x + v.hero.w / 2, v.hero.y + v.hero.h / 2, v.hero.w, v.hero.h] : [pool[0], this.H * 0.2, pool[2], pool[3]];
    gl.uniform4fv(u.uPool, up(pool));
    gl.uniform4fv(u.uHero, up(hero));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose() {
    const gl = this.gl;
    for (const t of this.tex) gl.deleteTexture(t);
    for (const f of this.fbo) gl.deleteFramebuffer(f);
    if (this.surfTex) gl.deleteTexture(this.surfTex);
    if (this.surfFbo) gl.deleteFramebuffer(this.surfFbo);
    this.tex = [];
    this.fbo = [];
    for (const p of Object.values(this.progs)) gl.deleteProgram(p.p);
  }
}
