import { DERIVE, RENDER, SIM, VERT } from './shaders';

export interface Frame {
  W: number; H: number; // css px
  s: number; sv: number; cur: number; p: number;
  pool: [number, number, number, number]; // cx, cy, w, h  (css px, y DOWN)
  hero: [number, number, number, number];
  poolRad: number; heroRad: number; spacing: number;
  tone: [number, number, number]; bgInk: [number, number, number];
  reduce: boolean; time: number; dither: boolean;
}

type U = Record<string, WebGLUniformLocation | null>;
const LAYER_W = 896;
export const LAYER_H = 1120;
export const LAYER_WIDTH = LAYER_W;

export class Water {
  gl: WebGL2RenderingContext;
  ok = true;
  mode: 'f32' | 'f16' | 'u8' = 'u8';
  gpu = '';
  simW = 0; simH = 0; cell = 2;
  private progs: Record<string, { p: WebGLProgram; u: U }> = {};
  private tex: WebGLTexture[] = [];
  private fbo: WebGLFramebuffer[] = [];
  private surfTex!: WebGLTexture; private surfFbo!: WebGLFramebuffer;
  private prodTex!: WebGLTexture;
  private cur = 0;
  private drops: number[] = [];
  private cw = 0; private ch = 0;
  rect = new Float32Array(4); rectP = new Float32Array(4);
  private vao: WebGLVertexArrayObject;
  private inks: Float32Array;
  slopeK = 15; lapK = 14;
  private mobile: boolean;
  /** rough estimate of live wave energy (CPU side) so the loop can sleep without a GPU read-back */
  energy = 0;

  constructor(private canvas: HTMLCanvasElement, private n: number, inks: [number, number, number][]) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('no webgl2');
    this.gl = gl;
    this.mobile = matchMedia('(hover: none)').matches || Math.min(screen.width, screen.height) < 700;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpu = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    this.vao = gl.createVertexArray()!;
    this.inks = new Float32Array(24);
    inks.forEach((c, i) => c.forEach((v, j) => (this.inks[i * 3 + j] = v / 255)));
    this.pickFormat();
    const defs = this.mode === 'u8' ? '' : '#define FLOATTEX\n';
    const mk = (name: string, fs: string) => {
      const withDefs = fs.replace('precision highp float;', 'precision highp float;\n' + defs);
      this.progs[name] = this.program(VERT, withDefs);
    };
    mk('sim', SIM); mk('derive', DERIVE); mk('render', RENDER);
    this.prodTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.prodTex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.floor(Math.log2(LAYER_W)) + 1, gl.RGBA8, LAYER_W, LAYER_H, Math.max(n, 1));
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private pickFormat() {
    const gl = this.gl;
    const cbf = gl.getExtension('EXT_color_buffer_float');
    const cbh = gl.getExtension('EXT_color_buffer_half_float');
    const test = (ifmt: number, type: number) => {
      const t = gl.createTexture()!; const f = gl.createFramebuffer()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, 4, 4, 0, gl.RGBA, type, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(f); gl.deleteTexture(t);
      return ok;
    };
    if (cbf && test(gl.RGBA32F, gl.FLOAT)) this.mode = 'f32';
    else if ((cbf || cbh) && test(gl.RGBA16F, gl.HALF_FLOAT)) this.mode = 'f16';
    else this.mode = 'u8';
    if (new URLSearchParams(location.search).get('fmt') === 'u8') this.mode = 'u8';
  }

  private program(vs: string, fs: string) {
    const gl = this.gl;
    const sh = (t: number, s: string) => {
      const o = gl.createShader(t)!; gl.shaderSource(o, s); gl.compileShader(o);
      if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o) || 'shader');
      return o;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
    const u: U = {};
    const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < nu; i++) {
      const info = gl.getActiveUniform(p, i)!;
      const name = info.name.replace('[0]', '');
      u[name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  private mkTarget(w: number, h: number, ifmt: number, fmt: number, type: number, filter: number) {
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
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    return { t, f };
  }

  resize(W: number, H: number, dpr: number) {
    const gl = this.gl;
    // cap total pixels (~1.7M) so a 3x phone does not run a 2.9M-pixel water shader
    let px = Math.min(dpr, 2);
    while (W * H * px * px > 1.8e6 && px > 1) px = Math.max(1, px - 0.25);
    this.cw = Math.round(W * px); this.ch = Math.round(H * px);
    this.canvas.width = this.cw; this.canvas.height = this.ch;
    const area = this.mobile ? 72000 : 150000;
    this.cell = Math.sqrt((W * H) / area);
    this.simW = Math.max(32, Math.round(W / this.cell)); this.simH = Math.max(32, Math.round(H / this.cell));
    for (const t of this.tex) gl.deleteTexture(t);
    for (const f of this.fbo) gl.deleteFramebuffer(f);
    if (this.surfTex) { gl.deleteTexture(this.surfTex); gl.deleteFramebuffer(this.surfFbo); }
    this.tex = []; this.fbo = [];
    const m = this.mode;
    const spec = m === 'f32' ? [gl.RGBA32F, gl.RGBA, gl.FLOAT] : m === 'f16' ? [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT] : [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE];
    for (let i = 0; i < 2; i++) {
      const r = this.mkTarget(this.simW, this.simH, spec[0], spec[1], spec[2], gl.NEAREST);
      this.tex.push(r.t); this.fbo.push(r.f);
    }
    if (m === 'u8') this.clearState();
    const sp = m === 'u8' ? [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE] : [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT];
    const s = this.mkTarget(this.simW, this.simH, sp[0], sp[1], sp[2], gl.LINEAR);
    this.surfTex = s.t; this.surfFbo = s.f;
    if (m === 'u8') this.fillSurfFlat();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.drops.length = 0;
  }

  /** u8 mode: zero is not byte 0, so state/surface must be seeded explicitly */
  private clearState() {
    const gl = this.gl;
    const z = new Uint8Array(this.simW * this.simH * 4);
    for (let i = 0; i < z.length; i += 4) { z[i] = 128; z[i + 1] = 0; z[i + 2] = 128; z[i + 3] = 0; }
    for (const t of this.tex) { gl.bindTexture(gl.TEXTURE_2D, t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.simW, this.simH, gl.RGBA, gl.UNSIGNED_BYTE, z); }
  }
  private fillSurfFlat() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.surfFbo);
    gl.clearColor(0.5, 0.5, 0.5, 0.5); gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** wipe the sim to a perfectly flat state (used when the water has fully settled) */
  flatten() {
    const gl = this.gl;
    if (this.mode === 'u8') { this.clearState(); this.fillSurfFlat(); }
    else for (const f of this.fbo.concat(this.surfFbo)) { gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.drops.length = 0;
  }

  /** impulse; x,y css px (y DOWN), radius css px, strength in sim velocity units (negative = pressed down) */
  drop(x: number, y: number, radius: number, strength: number) {
    if (this.drops.length > 4 * 40) return;
    this.energy += Math.abs(strength) * (radius / 17);
    this.drops.push(x / this.cell, this.simH - y / this.cell, Math.max(2, radius / this.cell), strength);
  }

  setRect(x: number, y: number, w: number, h: number, inside: number, ring: number, rad: number) {
    const c = this.cell;
    this.rect.set([x / c, this.simH - y / c, w / 2 / c, h / 2 / c]);
    this.rectP.set([inside, ring, 5, rad / c]);
    this.energy += Math.abs(inside) * 120 + Math.abs(ring) * 4;
  }
  clearRect() { this.rect[2] = 0; }

  uploadLayer(i: number, src: CanvasImageSource) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.prodTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, LAYER_W, LAYER_H, 1, gl.RGBA, gl.UNSIGNED_BYTE, src as TexImageSource);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  }

  /** run `steps` fixed sim steps. Returns when done. */
  step(steps: number, c2: number, damp: number) {
    const gl = this.gl;
    const P = this.progs.sim;
    gl.useProgram(P.p);
    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, this.simW, this.simH);
    gl.uniform2f(P.u.uSize, this.simW, this.simH);
    gl.uniform1f(P.u.uC2, c2); gl.uniform1f(P.u.uDamp, damp);
    gl.uniform1i(P.u.uState, 0);
    for (let s = 0; s < steps; s++) {
      const n = Math.min(16, this.drops.length / 4);
      const buf = new Float32Array(64);
      for (let i = 0; i < n * 4; i++) buf[i] = this.drops[i];
      this.drops.splice(0, n * 4);
      gl.uniform1i(P.u.uN, n);
      gl.uniform4fv(P.u.uDrops, buf);
      gl.uniform4fv(P.u.uRect, this.rect); gl.uniform4fv(P.u.uRectP, this.rectP);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[1 - this.cur]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.cur = 1 - this.cur;
    }
  }

  render(f: Frame, inks: boolean) {
    const gl = this.gl;
    void inks;
    // derive surface
    let P = this.progs.derive;
    gl.useProgram(P.p); gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.surfFbo);
    gl.viewport(0, 0, this.simW, this.simH);
    gl.uniform2f(P.u.uSize, this.simW, this.simH); gl.uniform1i(P.u.uState, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    P = this.progs.render;
    gl.useProgram(P.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.cw, this.ch);
    const u = P.u;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.surfTex); gl.uniform1i(u.uSurf, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.prodTex); gl.uniform1i(u.uProd, 1);
    gl.uniform2f(u.uRes, f.W, f.H); gl.uniform1f(u.uPx, this.cw / f.W);
    gl.uniform1f(u.uTime, f.time); gl.uniform1f(u.uSeed, 0.37);
    gl.uniform1f(u.uS, f.s); gl.uniform1f(u.uSv, f.sv); gl.uniform1f(u.uP, f.p);
    gl.uniform1f(u.uReduce, f.reduce ? 1 : 0);
    gl.uniform1f(u.uSlopeK, this.slopeK); gl.uniform1f(u.uLapK, this.lapK);
    gl.uniform1f(u.uLayerW, LAYER_W); gl.uniform1f(u.uHeroRad, f.heroRad); gl.uniform1f(u.uPoolRad, f.poolRad);
    gl.uniform1f(u.uRestZ, 16); gl.uniform1f(u.uSpacing, f.spacing); gl.uniform1f(u.uDith, f.dither ? 1 : 0);
    gl.uniform1i(u.uN, this.n); gl.uniform1i(u.uCur, f.cur);
    gl.uniform3fv(u.uInk, this.inks);
    gl.uniform3fv(u.uTone, f.tone.map((v) => v / 255)); gl.uniform3fv(u.uBgInk, f.bgInk.map((v) => v / 255));
    const up = (r: number[]) => [r[0], f.H - r[1], r[2], r[3]];
    gl.uniform4fv(u.uPool, up(f.pool)); gl.uniform4fv(u.uHero, up(f.hero));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** debug: max |slope|, max |h|, max |lap| of the derived surface (float modes only) */
  peek() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.surfFbo);
    const n = this.simW * this.simH;
    const b = new Float32Array(n * 4);
    gl.readPixels(0, 0, this.simW, this.simH, gl.RGBA, gl.FLOAT, b);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let g = 0, h = 0, l = 0, at = 0;
    for (let i = 0; i < n; i++) { g = Math.max(g, Math.hypot(b[i * 4], b[i * 4 + 1])); if (Math.abs(b[i * 4 + 2]) > h) { h = Math.abs(b[i * 4 + 2]); at = i; } l = Math.max(l, Math.abs(b[i * 4 + 3])); }
    return { grad: g, h, lap: l, x: at % this.simW, y: Math.floor(at / this.simW), W: this.simW, H: this.simH };
  }

}
