// LIGHT world: a slide projector in a dark room. A 3D slide tray (cylinder, plate, instanced slide mounts) under a
// volumetric beam that throws the current product on the wall. Everything is a pure function of the tray position,
// the open progress p and the time since the last slide change.
// Sticky spin: the slide under the finger stays under the finger 1:1 from the first pixel (the tray angle is solved
// from the finger so the held slide's projected centre moves exactly with it), then a critically damped spring lands it.
import { SETTLE_OMEGA, Velocity, clamp, lerp, smooth, spring } from '../../core/commit';
import type { Release } from '../../core/commit';
import { innerRect, imgInfo } from '../../core/products';
import type { SpringCfg } from '../../core/state';
import { setU, type Prog, type Target } from '../../gl/context';
import { Wake, type Anchor, type DragPhase, type DragPoint, type Host, type View, type World } from '../types';
import { BEAM, BG, COMP, DUST_FS, DUST_VS, POST, PROJ, QVS, SL_FS, SL_VS, TRAY_FS, TRAY_VS } from './shaders';

export const LIGHT_SPRING: SpringCfg = { open: 7.5, close: 9, snap: 0.01 };
const RUBBER = 0.35;
const ND = 2400; // dust points
const DEG = Math.PI / 180;

// --- tray camera -----------------------------------------------------------------------------
const EL = 0.5, DIST = 7, SE = Math.sin(EL), CE = Math.cos(EL);
export function trayCam(W: number, H: number, cy: number) {
  const s = Math.min(W * 0.46, H * 0.27), F = s * DIST, cx = W / 2;
  const a = (2 * F) / W, b = (2 * F) / H, cxn = (2 * cx) / W - 1, cyn = 1 - (2 * cy) / H;
  const n = 0.5, f = 40, A = (f + n) / (f - n), B = (-2 * f * n) / (f - n);
  const rows = [
    [a, -cxn * SE, -cxn * CE, cxn * DIST],
    [0, b * CE - cyn * SE, -b * SE - cyn * CE, cyn * DIST],
    [0, -A * SE, -A * CE, A * DIST + B],
    [0, -SE, -CE, DIST],
  ];
  const vp = new Float32Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) vp[c * 4 + r] = rows[r][c];
  const proj = (x: number, y: number, z: number): [number, number, number] => {
    const yc = CE * y - SE * z, zc = -SE * y - CE * z + DIST;
    return [cx + (F * x) / zc, cy - (F * yc) / zc, F / zc];
  };
  return { vp, proj, cam: [0, DIST * SE, DIST * CE] as [number, number, number] };
}

function trayMesh(): Float32Array {
  const v: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => v.push(...a, ...b, ...c);
  const S = 96, TAU = Math.PI * 2;
  const ring = (r: number, y: number, i: number) => [Math.sin((i / S) * TAU) * r, y, Math.cos((i / S) * TAU) * r];
  for (let i = 0; i < S; i++) {
    const j = i + 1;
    const nr = (k: number) => [Math.sin((k / S) * TAU), 0, Math.cos((k / S) * TAU)];
    const q = (r: number, y0: number, y1: number, kind: number, n0: number[], n1: number[]) => {
      const a = [...ring(r, y0, i), ...n0, kind], b = [...ring(r, y0, j), ...n1, kind], c = [...ring(r, y1, j), ...n1, kind], d = [...ring(r, y1, i), ...n0, kind];
      tri(a, b, c);
      tri(a, c, d);
    };
    q(1.07, -0.5, 0, 0, nr(i), nr(j));
    q(0.24, 0, 0.3, 2, nr(i), nr(j));
    const up = [0, 1, 0];
    const ann = (r0: number, r1: number, y: number, kind: number) => {
      const a = [...ring(r0, y, i), ...up, kind], b = [...ring(r0, y, j), ...up, kind], c = [...ring(r1, y, j), ...up, kind], d = [...ring(r1, y, i), ...up, kind];
      tri(a, b, c);
      tri(a, c, d);
    };
    ann(0.24, 1.07, 0, 1);
    ann(0, 0.24, 0.3, 2);
  }
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
    const f = (n: number[], p: number[][]) => {
      const m = p.map((q) => [...q, ...n, 3]);
      tri(m[0], m[1], m[2]);
      tri(m[0], m[2], m[3]);
    };
    f([0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]);
    f([0, 0, -1], [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]]);
    f([1, 0, 0], [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]]);
    f([-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]);
    f([0, 1, 0], [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]);
  };
  box(-1.4, 1.4, -1.0, -0.5, -1.25, 1.4);
  return new Float32Array(v);
}

export class LightWorld implements World {
  readonly id = 'light' as const;
  readonly spring = LIGHT_SPRING;
  /** the text waits until the lamp has gone out and the paper is nearly flat: no muddy copy over the bright beam */
  readonly textRange: [number, number] = [0.84, 0.99];
  private h!: Host;
  private gl!: WebGL2RenderingContext;
  private pr!: Record<'bg' | 'proj' | 'beam' | 'comp' | 'post' | 'dust' | 'tray' | 'slide', Prog>;
  private vaoT!: WebGLVertexArrayObject;
  private meshN = 0;
  private bw = 2;
  private bh = 2;
  private fbo: WebGLFramebuffer | null = null;
  private bt: WebGLTexture | null = null;
  private W = 1;
  private H = 1;
  private N = 1; // products
  private slots = 12; // ring positions
  private aspects: number[] = [];
  private inner: [number, number, number, number][] = [];
  private ap = new Float32Array(32 * 4);
  // tray position (slots), velocity (slots/s)
  private pos = 0;
  private vel = 0;
  private target = 0;
  private dragging = false;
  private idx0 = 0;
  private x0 = 0; // projected x of the held slide at pointer down
  private vt = new Velocity();
  // slide-change timeline
  private shown = 0;
  private pending = 0;
  private swapped = true;
  private chT = -1e9;
  private chShutter = 75;
  private chAmp = 10;
  private chBlur = 1;
  private lastChange = -1e9;
  private lastAct = 0;
  private swapAt = 30;
  private introT0 = -1;
  private wantIntro = true;
  private lastTouch = 0;
  private avgS: [number, number, number] = [0.6, 0.55, 0.5];
  private lens: [number, number] = [0, 0];
  /** the wall footprint of the beam: centre x,y and size (css px, y down) */
  private wall: [number, number, number, number] = [0, 0, 1, 1];
  private introDelay = 0;
  private holdUntil = -1;

  init(host: Host) {
    this.h = host;
    const g = host.g;
    const gl = (this.gl = g.gl);
    this.N = host.products.length;
    this.slots = Math.max(12, this.N);
    this.aspects = host.products.map((p) => {
      const i = imgInfo(p.images[0]);
      return i.w / i.h;
    });
    this.inner = host.products.map((p) => innerRect(p.images[0]));
    host.products.forEach((p, i) => i < 32 && this.ap.set(this.cover(p.images[0]), i * 4));
    this.pr = {
      bg: g.program(QVS, BG),
      proj: g.program(QVS, PROJ),
      beam: g.program(QVS, BEAM),
      comp: g.program(QVS, COMP),
      post: g.program(QVS, POST),
      dust: g.program(DUST_VS, DUST_FS),
      tray: g.program(TRAY_VS, TRAY_FS, (p) => {
        gl.bindAttribLocation(p, 0, 'aP');
        gl.bindAttribLocation(p, 1, 'aN');
        gl.bindAttribLocation(p, 2, 'aK');
      }),
      slide: g.program(SL_VS, SL_FS),
    };
    const mesh = trayMesh();
    this.vaoT = gl.createVertexArray()!;
    gl.bindVertexArray(this.vaoT);
    const vb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
    gl.bindVertexArray(null);
    this.meshN = mesh.length / 7;
  }

  /** slide aperture window in the 4:5 layer: a square cover crop of the photo, biased up for tall images (faces) */
  private cover(path: string): [number, number, number, number] {
    const [u0, v0, u1, v1] = innerRect(path);
    const iw = (u1 - u0) * 768, ih = (v1 - v0) * 960;
    const side = Math.min(iw, ih);
    const du = side / 768, dv = side / 960;
    const x = u0 + (u1 - u0 - du) / 2;
    const y = v0 + (v1 - v0 - dv) * 0.3;
    return [x, y, x + du, y + dv];
  }

  resize(W: number, H: number, dpr: number) {
    const gl = this.gl;
    this.W = W;
    this.H = H;
    void dpr;
    const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    this.bw = Math.max(2, Math.round(cw / 2));
    this.bh = Math.max(2, Math.round(ch / 2));
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    if (this.bt) gl.deleteTexture(this.bt);
    this.bt = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.bt);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.bw, this.bh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.bt, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.wake();
  }

  // ---- geometry helpers --------------------------------------------------------------------------
  private cam() {
    return trayCam(this.W, this.H, this.H * 0.815);
  }
  /** screen x of the centre of slide i when the tray is at position `pos` (mirrors SL_VS) */
  private slideXY(i: number, pos: number, cam = this.cam()): [number, number] {
    const a = (Math.PI * 2) / this.slots;
    let ph = (i - pos) * a;
    ph -= Math.PI * 2 * Math.floor((ph + Math.PI) / (Math.PI * 2));
    const gw = Math.exp(-Math.pow(ph / (0.55 * a), 2));
    const hw = 0.235, hh = 0.47, lift = 0.015 + 0.17 * gw;
    // centre of the slide quad: c = (.5,.5)
    const rx = Math.sin(ph), rz = Math.cos(ph);
    const R = 1 + 0.02 * gw + (0.5 * hh) * (0.05 - 0.07 * gw);
    void hw;
    const [x, y] = cam.proj(rx * R, lift + 0.5 * hh, rz * R);
    return [x, y];
  }
  /** px per slot at the gate */
  slotPx() {
    const c = this.cam();
    return Math.abs(this.slideXY(0, 0.5, c)[0] - this.slideXY(0, -0.5, c)[0]);
  }
  /** tray position at which slide `idx` is centred at screen x (monotonic in phase within +-80 deg) */
  private solve(idx: number, x: number): number {
    const a = (Math.PI * 2) / this.slots;
    const cam = this.cam();
    const lim = 80 * DEG;
    const xAt = (ph: number) => this.slideXY(idx, idx - ph / a, cam)[0];
    const xl = xAt(-lim), xr = xAt(lim);
    let ph: number;
    if (x <= xl) ph = -lim + (x - xl) / (this.slotPx() / a);
    else if (x >= xr) ph = lim + (x - xr) / (this.slotPx() / a);
    else {
      let lo = -lim, hi = lim;
      for (let k = 0; k < 22; k++) {
        const mid = (lo + hi) / 2;
        if (xAt(mid) < x) lo = mid;
        else hi = mid;
      }
      ph = (lo + hi) / 2;
    }
    return idx - ph / a;
  }

  // ---- World -------------------------------------------------------------------------------------
  setIndex(i: number, immediate = false) {
    if (this.dragging) return;
    this.target = i;
    if (immediate) {
      this.pos = i;
      this.vel = 0;
      this.lastAct = i;
      this.shown = this.pending = i;
      this.swapped = true;
      this.chT = -1e9;
    }
    this.wake();
  }
  nearest() {
    return clamp(Math.round(this.pos), 0, this.N - 1);
  }
  settled() {
    return !this.dragging && this.pos === this.target && this.vel === 0;
  }
  probe() {
    const i = this.dragging ? this.idx0 : this.nearest();
    const [x, y] = this.slideXY(i, this.pos);
    return { x, y };
  }
  hit(x: number, y: number): 'open' | 'prev' | 'next' | 'none' {
    if (y < this.H * 0.6 || Math.abs(x - this.W / 2) < this.W * 0.2) return 'open';
    return x < this.W / 2 ? 'prev' : 'next';
  }

  drag(phase: DragPhase, pt: DragPoint): Release | undefined {
    if (phase === 'start') {
      this.dragging = true;
      this.idx0 = this.nearest();
      this.x0 = this.slideXY(this.idx0, this.pos)[0];
      this.target = this.pos;
      this.vt.reset();
      this.vt.push(this.pos, pt.now);
      this.lastTouch = pt.now;
    } else if (phase === 'move' && this.dragging) {
      let ps = this.solve(this.idx0, this.x0 + pt.dx);
      if (ps < 0) ps *= RUBBER;
      else if (ps > this.N - 1) ps = this.N - 1 + (ps - (this.N - 1)) * RUBBER;
      this.pos = ps;
      this.vt.push(ps, pt.now);
      this.lastTouch = pt.now;
    } else if ((phase === 'end' || phase === 'cancel') && this.dragging) {
      this.dragging = false;
      this.vel = phase === 'end' ? this.vt.read(pt.now) : 0;
      this.target = clamp(Math.round(this.pos), 0, this.N - 1);
      if (phase === 'end') return { idx0: this.idx0, q: this.pos - this.idx0, v: this.vel, slotPx: this.slotPx() };
    }
    this.wake();
    return undefined;
  }

  enter(o?: { delayMs?: number; quiet?: boolean }) {
    this.wantIntro = true;
    this.introDelay = o?.delayMs ?? 0;
    this.holdUntil = -1;
    this.introT0 = -1;
    this.wake();
  }
  anchor(): Anchor {
    const [x, y, w, h] = this.wall;
    return { x, y, w, h, lens: { x: this.lens[0], y: this.lens[1] } };
  }
  wake() {
    this.lastTouch = performance.now();
    this.h?.wake();
  }
  sleep() {}

  private trigger(now: number, act: number) {
    const gap = now - this.lastChange;
    this.lastChange = now;
    const strobe = gap < 170;
    this.chShutter = strobe ? 30 : 75;
    this.chAmp = strobe ? 3 : 10;
    this.chBlur = strobe ? 0.3 : 1;
    this.chT = now;
    this.pending = clamp(act, 0, this.N - 1);
    this.swapped = false;
    this.swapAt = strobe ? 12 : this.chShutter * 0.4;
    try {
      navigator.vibrate?.(6);
    } catch {
      /* not supported */
    }
  }

  render(dt: number, v: View, to: Target): Wake {
    const g = this.h.g;
    const now = v.time * 1000;
    const W = this.W, H = this.H;
    dt = clamp(dt, 0, 0.05);

    // ---- physics
    if (this.dragging) this.vel = this.vt.read(now);
    else if (this.pos !== this.target || this.vel !== 0) {
      const r = spring(this.pos, this.vel, this.target, dt, SETTLE_OMEGA);
      this.pos = r.x;
      this.vel = r.v;
      if (Math.abs(this.pos - this.target) < 1e-3 && Math.abs(this.vel) < 0.01) (this.pos = this.target), (this.vel = 0);
    }
    const act = this.nearest();
    if (act !== this.lastAct) {
      this.lastAct = act;
      if (v.p === 0) this.trigger(now, act);
      else this.shown = this.pending = act;
    }
    if (!this.swapped && now - this.chT >= this.swapAt) {
      this.shown = this.pending;
      this.swapped = true;
    }
    if (v.p > 0 && this.shown !== v.index) this.shown = this.pending = v.index;
    const ready = this.h.textures.has(this.shown);
    // the switch transition can ask for the welcome to wait until the room is revealed
    let hold = false;
    if (this.wantIntro && ready && this.introDelay > 0) {
      if (this.holdUntil < 0) this.holdUntil = now + this.introDelay;
      hold = now < this.holdUntil;
    }
    if (this.wantIntro && ready && !hold) {
      this.introT0 = now;
      this.wantIntro = false;
      this.chT = now;
      this.lastChange = now - 1000;
      this.chShutter = 140;
      this.swapped = true;
    }

    // ---- frame
    const t = v.time;
    const age = now - this.chT;
    const pvis = Math.min(1, v.p * 1.0101);
    const gm = smooth(0, 1, pvis) * 0.5 + pvis * 0.5;
    const light = smooth(0.16, 0.98, pvis);
    let rush = 0, bright = 1, dy = 0, blur = 0, scale = 1;
    if (age < 900) {
      if (age < this.chShutter) bright = age < this.swapAt ? 1 - smooth(0, this.swapAt, age) : 0;
      else {
        const a = (age - this.chShutter) / 1000;
        bright = smooth(0, 0.034, a);
        rush = this.chBlur * 0.28 * Math.exp(-a * 11);
        dy = -this.chAmp * Math.exp(-22 * a) * Math.cos(38 * a);
        blur = this.chBlur * Math.pow(1 - smooth(0, 0.27, a), 2);
        scale = 1 + 0.02 * blur;
      }
    }
    if (!ready || hold) bright = 0;
    const intro = this.introT0 >= 0 ? smooth(0, 1.3, (now - this.introT0) / 1000) : 0;
    const flick = (0.012 * Math.sin(t * 61) + 0.008 * Math.sin(t * 23.7 + 1.3) + 0.006 * Math.sin(t * 97.3) + 0.01 * Math.sin(t * 0.9)) * (1 - gm);

    // wall quad: the photo's own aspect while projected, morphing into the DOM hero (4:5 frame) as it lands
    const a = this.aspects[this.shown] ?? 1;
    const bw = Math.min(W * 0.84, 720, H * 0.46 * 1.2), bh = H * 0.46;
    let ww = bw, wh = ww / a;
    if (wh > bh) (wh = bh), (ww = wh * a);
    const cyW = H * 0.345, cx = W / 2;
    this.wall = [cx, cyW, ww, wh];
    const wTop: [number, number, number] = [cx - (ww * 1.045) / 2, cx + (ww * 1.045) / 2, cyW - wh / 2];
    const wBot: [number, number, number] = [cx - (ww * 0.985) / 2, cx + (ww * 0.985) / 2, cyW + wh / 2];
    const hero = v.hero;
    const top = (v.p > 0 ? [lerp(wTop[0], hero.x, gm), lerp(wTop[1], hero.x + hero.w, gm), lerp(wTop[2], hero.y, gm)] : wTop) as [number, number, number];
    const bot = (v.p > 0 ? [lerp(wBot[0], hero.x, gm), lerp(wBot[1], hero.x + hero.w, gm), lerp(wBot[2], hero.y + hero.h, gm)] : wBot) as [number, number, number];
    const inn = this.inner[this.shown] ?? [0, 0, 1, 1];
    const win = [lerp(inn[0], 0, gm), lerp(inn[1], 0, gm), lerp(inn[2], 1, gm), lerp(inn[3], 1, gm)];
    // colour of the current slide
    const av = this.h.textures.avg[this.shown] ?? [0.6, 0.55, 0.5];
    for (let i = 0; i < 3; i++) this.avgS[i] += (av[i] - this.avgS[i]) * (1 - Math.exp(-5 * 0.048));
    const mx = Math.max(this.avgS[0], this.avgS[1], this.avgS[2], 0.3);
    const tint = [0, 1, 2].map((i) => lerp(i === 0 ? 1.0 : i === 1 ? 0.93 : 0.8, clamp(this.avgS[i] / mx), 0.38)) as [number, number, number];
    // tray + lens
    const kick = age < 400 ? 5 * Math.exp(-age / 70) * Math.sin((Math.min(age, 140) / 140) * Math.PI) * (this.chShutter > 50 ? 1 : 0.4) : 0;
    const trayCy = H * 0.815 + gm * H * 0.5 + kick;
    const cam = trayCam(W, H, trayCy);
    const L = cam.proj(0, 0.72, 1.03);
    this.lens = [L[0], L[1]];
    const r0 = 0.155 * L[2];
    const sB = smooth(0.08, 0.92, pvis);
    const beamTL: [number, number] = [lerp(bot[0], -0.3 * W, sB), lerp(bot[2], -0.2 * H, sB)];
    const beamTR: [number, number] = [lerp(bot[1], 1.3 * W, sB), lerp(bot[2], -0.2 * H, sB)];
    const vB = lerp(top[2], -0.2 * H, sB);
    const open = 1 - smooth(0.5, 1, pvis);
    const flash = Math.pow(Math.sin(Math.PI * pvis), 2) * 0.5;
    const quad: [number, number, number, number] = [(top[0] + top[1]) / 2, (top[2] + bot[2]) / 2, (top[1] - top[0]) / 2, (bot[2] - top[2]) / 2];

    const gl = this.gl;
    const pr = this.pr;
    g.reset();
    g.bind(to);
    gl.bindVertexArray(g.vao);
    const full = (p: Prog) => {
      setU(gl, p, 'uRes', [W, H]);
      setU(gl, p, 'uBox', [0, 0, W, H]);
    };
    const strip = () => gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const paper = v.tone.map((x) => x / 255);
    // room
    gl.useProgram(pr.bg.p);
    full(pr.bg);
    setU(gl, pr.bg, 'uLight', light);
    setU(gl, pr.bg, 'uProjI', bright * (1 - light) * intro);
    setU(gl, pr.bg, 'uQ', quad);
    setU(gl, pr.bg, 'uAvg', this.avgS);
    setU(gl, pr.bg, 'uPaper', paper);
    setU(gl, pr.bg, 'uHor', H * 0.625);
    setU(gl, pr.bg, 'uTime', t);
    strip();
    // wall projection
    const fb = bright * (0.15 + 0.85 * intro);
    if (fb > 0.001) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(pr.proj.p);
      const pad = 40 + Math.abs(dy);
      const x0 = Math.min(top[0], bot[0]) - pad, x1 = Math.max(top[1], bot[1]) + pad;
      setU(gl, pr.proj, 'uRes', [W, H]);
      setU(gl, pr.proj, 'uBox', [x0, top[2] - pad, x1, bot[2] + pad]);
      setU(gl, pr.proj, 'uTop', top);
      setU(gl, pr.proj, 'uBot', bot);
      setU(gl, pr.proj, 'uTint', tint);
      setU(gl, pr.proj, 'uWin', win);
      setU(gl, pr.proj, 'uLayer', this.shown);
      setU(gl, pr.proj, 'uRad', 12 * gm);
      const vig = 1 - smooth(0.2, 1, pvis);
      const U: Record<string, number> = { uBlur: blur, uBright: fb, uVig: vig, uFringe: 1 - gm, uExpo: (1 + 0.5 * flash + rush) * (1 + 0.5 * (1 - intro)), uBloom: (0.85 + 1.2 * flash) * (1 - smooth(0.8, 1, pvis)), uDy: (dy + 0.3 * Math.sin(t * 41) + 0.2 * Math.sin(t * 17.3)) * (1 - gm), uScale: scale, uAlpha: 1, uFlick: flick, uSeed: this.shown / this.N, uTime: t };
      for (const k in U) setU(gl, pr.proj, k, U[k]);
      gl.uniform1i(pr.proj.u.uA, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.h.textures.tex);
      strip();
      gl.disable(gl.BLEND);
    }
    // tray (3D)
    const gate: [number, number, number] = [0, 0.7, 1.2];
    if (trayCy < H + 200) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      const lit = bright * (1 - light) * intro;
      const common = (p: Prog) => {
        setU(gl, p, 'uVP', cam.vp);
        setU(gl, p, 'uCam', cam.cam);
        setU(gl, p, 'uGate', gate);
        setU(gl, p, 'uCol', tint);
        setU(gl, p, 'uAvg', this.avgS);
        setU(gl, p, 'uPos', this.pos);
        setU(gl, p, 'uN', this.slots);
        setU(gl, p, 'uLit', lit * 0.85 + 0.15 * (1 - light) * intro);
        setU(gl, p, 'uLight', light);
        setU(gl, p, 'uFlick', flick);
      };
      gl.useProgram(pr.tray.p);
      common(pr.tray);
      gl.bindVertexArray(this.vaoT);
      gl.drawArrays(gl.TRIANGLES, 0, this.meshN);
      gl.bindVertexArray(g.vao);
      gl.useProgram(pr.slide.p);
      common(pr.slide);
      gl.uniform4fv(pr.slide.u.uAp, this.ap);
      gl.uniform1i(pr.slide.u.uAtlas, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.h.textures.tex);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Math.min(this.N, 32));
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
    }
    // beam @ half res
    const beamGain = (0.8 + rush) * bright * open * intro;
    if (beamGain > 0.002) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.viewport(0, 0, this.bw, this.bh);
      gl.useProgram(pr.beam.p);
      full(pr.beam);
      setU(gl, pr.beam, 'uL', this.lens);
      setU(gl, pr.beam, 'uTL', beamTL);
      setU(gl, pr.beam, 'uTR', beamTR);
      setU(gl, pr.beam, 'uR0', r0);
      setU(gl, pr.beam, 'uTime', t);
      setU(gl, pr.beam, 'uQ', quad);
      setU(gl, pr.beam, 'uGain', beamGain);
      setU(gl, pr.beam, 'uYT', vB);
      setU(gl, pr.beam, 'uCol', tint);
      strip();
      g.bind(to);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(pr.comp.p);
      full(pr.comp);
      gl.uniform1i(pr.comp.u.uT, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.bt);
      strip();
      gl.useProgram(pr.dust.p);
      setU(gl, pr.dust, 'uRes', [W, H]);
      setU(gl, pr.dust, 'uL', this.lens);
      setU(gl, pr.dust, 'uTL', beamTL);
      setU(gl, pr.dust, 'uTR', beamTR);
      setU(gl, pr.dust, 'uR0', r0);
      setU(gl, pr.dust, 'uYT', vB);
      setU(gl, pr.dust, 'uTime', t);
      setU(gl, pr.dust, 'uDpr', to.w / W);
      setU(gl, pr.dust, 'uFade', bright * open * intro);
      setU(gl, pr.dust, 'uVel', this.vel);
      setU(gl, pr.dust, 'uCol', tint);
      gl.drawArrays(gl.POINTS, 0, ND);
      gl.disable(gl.BLEND);
    }
    // grain + vignette
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.SRC_ALPHA);
    gl.useProgram(pr.post.p);
    full(pr.post);
    setU(gl, pr.post, 'uGrain', 1);
    setU(gl, pr.post, 'uVig', 0.85);
    setU(gl, pr.post, 'uLight', light);
    setU(gl, pr.post, 'uTime', t);
    strip();
    gl.disable(gl.BLEND);

    // ---- sleep policy
    const moving = this.dragging || this.pos !== this.target || this.vel !== 0 || (v.p > 0 && v.p < 1) || v.pv !== 0;
    const recent = hold || age < 900 || (this.introT0 >= 0 && now - this.introT0 < 2200) || this.wantIntro;
    if (moving || recent || now - this.lastTouch < 400) return Wake.Active;
    if (now - this.lastTouch < 10000 && v.p === 0) return Wake.Idle; // the lamp hums: dust + flicker at ~30 fps
    return Wake.Sleep;
  }

  dispose() {
    const gl = this.gl;
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    if (this.bt) gl.deleteTexture(this.bt);
    gl.deleteVertexArray(this.vaoT);
    for (const p of Object.values(this.pr)) gl.deleteProgram(p.p);
  }
}
