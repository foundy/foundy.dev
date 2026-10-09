// Raw WebGL2 helpers shared by every transition: programs, the 3D card, shadows, textures, one half-res target.
import { FRAME_ASPECT, imgInfo, imgUrl, type RGB } from '../data';
import type { Env, Rect } from './types';

export const F = 1600; // focal length (css px) of the deck camera
export const CARD_R = 28;

export const GLSL_COMMON = `
float sdRR(vec2 p, vec2 hs, float r){ r=min(r,min(hs.x,hs.y)); vec2 q=abs(p)-hs+r; return length(max(q,0.))+min(max(q.x,q.y),0.)-r; }
vec3 face(sampler2D t, vec4 r, vec3 d0, vec3 d1, vec2 uv, float bias){
  vec2 q=(uv-r.xy)/(r.zw-r.xy);
  vec3 s=texture(t,clamp(q,0.,1.),bias).rgb;
  float k=step(0.,q.x)*step(q.x,1.)*step(0.,q.y)*step(q.y,1.);
  vec3 pad=mix(d0,d1,(r.z-r.x>.999)?uv.y:uv.x);
  return mix(pad,s,k);
}`;

export const QUAD_VS = `#version 300 es
in vec2 aUV; uniform vec4 uRect; uniform vec2 uRes; out vec2 vPx;
void main(){ vPx=mix(uRect.xy,uRect.zw,aUV); gl_Position=vec4(vPx.x/uRes.x*2.-1.,1.-vPx.y/uRes.y*2.,0.,1.); }`;

const CARD_VS = `#version 300 es
in vec2 aUV;
uniform vec2 uRes, uVP, uSize, uTap;
uniform vec3 uC, uRot;
uniform vec4 uBend;
uniform float uF;
out vec2 vUV; out vec3 vN;
vec3 loc(vec2 uv){
  vec2 pl=(uv-.5)*uSize; float z=0.;
  vec2 d=(uv-.5)*2.; float r=length(d);
  float w=smoothstep(.55,1.,r);
  vec2 nv=r>1e-4?d/r:vec2(0.);
  vec2 tp=uTap-.5; float tl=length(tp); vec2 nt=tl>1e-3?tp/tl:vec2(0.,-1.);
  z+=uBend.x*w*(.7+.5*dot(nv,-nt));
  z+=uBend.y*smoothstep(.8,1.05,r)*sin(9.*uv.x+7.*uv.y);
  float hy=(.225-.5)*uSize.y; float dy=hy-pl.y;
  if(uBend.z!=0.&&dy>0.){ pl.y=hy-dy*cos(uBend.z); z-=dy*sin(uBend.z); }
  return vec3(pl,z);
}
mat3 rot(vec3 a){
  float cx=cos(a.x),sx=sin(a.x),cy=cos(a.y),sy=sin(a.y),cz=cos(a.z),sz=sin(a.z);
  mat3 X=mat3(1.,0.,0.,0.,cx,sx,0.,-sx,cx), Y=mat3(cy,0.,-sy,0.,1.,0.,sy,0.,cy), Z=mat3(cz,sz,0.,-sz,cz,0.,0.,0.,1.);
  return Z*Y*X;
}
void main(){
  vec3 l=loc(aUV);
  vec3 dx=loc(aUV+vec2(.01,0.))-l, dy=loc(aUV+vec2(0.,.01))-l;
  mat3 R=rot(uRot);
  vec3 P=R*l+uC;
  float zz=min(P.z,uF-80.);
  float s=uF/(uF-zz);
  vec2 sc=uVP+(P.xy-uVP)*s;
  gl_Position=vec4(sc.x/uRes.x*2.-1.,1.-sc.y/uRes.y*2.,0.,1.);
  vUV=aUV; vN=R*normalize(cross(dx,dy));
}`;

const CARD_FS = `#version 300 es
precision highp float;
in vec2 vUV; in vec3 vN;
uniform sampler2D uT0,uT1;
uniform vec4 uR0,uR1,uSpec;
uniform vec3 uD0,uE0,uD1,uE1;
uniform vec2 uSize;
uniform float uMix,uRad,uBias,uDim,uAlpha,uRake,uDpr;
out vec4 o;
${GLSL_COMMON}
void main(){
  vec3 c=face(uT0,uR0,uD0,uE0,vUV,uBias);
  if(uMix>0.001) c=mix(c,face(uT1,uR1,uD1,uE1,vUV,uBias),uMix);
  vec2 pl=(vUV-.5)*uSize;
  float a=clamp(.5-sdRR(pl,uSize*.5,uRad)*uDpr,0.,1.);
  float s=dot(vUV-.5,vec2(cos(uSpec.w),sin(uSpec.w)));
  float b=(s-uSpec.x)/uSpec.y;
  c+=exp(-b*b)*uSpec.z;
  if(uRake>0.){
    vec3 H=normalize(normalize(vec3(-.55,-.45,.5))+vec3(0.,0.,1.));
    float t=dot(normalize(vN),H)-H.z;
    float g=(t+.05)/.03;
    c+=exp(-g*g)*uRake*.5;
  }
  c*=1.-uDim;
  o=vec4(c,a*uAlpha);
}`;

const SHADOW_FS = `#version 300 es
precision highp float;
in vec2 vPx; uniform vec4 uBox; uniform float uRad,uBlur,uAlpha; out vec4 o;
${GLSL_COMMON}
void main(){ vec2 c=(uBox.xy+uBox.zw)*.5; float d=sdRR(vPx-c,(uBox.zw-uBox.xy)*.5,uRad); o=vec4(0.,0.,0.,uAlpha*exp(-max(d,0.)/uBlur)); }`;

export interface Tex {
  t: WebGLTexture;
  path: string;
  /** frame-uv rect of the contained image */
  rect: [number, number, number, number];
  dom: RGB; // 0..1 pad colour 0
  dom2: RGB; // 0..1 pad colour 1
  bytes: number;
}

export interface CardOpts {
  tex: Tex | null;
  tex2?: Tex | null;
  mix?: number;
  cx: number;
  cy: number;
  cz?: number;
  w: number;
  h: number;
  rx?: number;
  ry?: number;
  rz?: number;
  radius?: number;
  alpha?: number;
  dim?: number;
  bias?: number;
  spec?: [number, number, number, number];
  rake?: number;
  bend?: [number, number, number];
  tap?: [number, number];
}

export function containRect(w: number, h: number): [number, number, number, number] {
  const a = w / h;
  const rw = a >= FRAME_ASPECT ? 1 : a / FRAME_ASPECT;
  const rh = a >= FRAME_ASPECT ? FRAME_ASPECT / a : 1;
  return [0.5 - rw / 2, 0.5 - rh / 2, 0.5 + rw / 2, 0.5 + rh / 2];
}

export class Prog {
  private locs = new Map<string, WebGLUniformLocation | null>();
  constructor(readonly gl: WebGL2RenderingContext, readonly p: WebGLProgram) {}
  private loc(n: string) {
    let l = this.locs.get(n);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.p, n);
      this.locs.set(n, l);
    }
    return l;
  }
  f(n: string, ...v: number[]) {
    const l = this.loc(n);
    if (!l) return this;
    const g = this.gl;
    if (v.length === 1) g.uniform1f(l, v[0]);
    else if (v.length === 2) g.uniform2f(l, v[0], v[1]);
    else if (v.length === 3) g.uniform3f(l, v[0], v[1], v[2]);
    else g.uniform4f(l, v[0], v[1], v[2], v[3]);
    return this;
  }
  i(n: string, v: number) {
    const l = this.loc(n);
    if (l) this.gl.uniform1i(l, v);
    return this;
  }
}

export interface Target {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

export class Gfx {
  readonly gl: WebGL2RenderingContext;
  W = 1;
  H = 1;
  vpY = 0.5; // vanishing point y as a fraction of H
  dpr = 1;
  tapUV: [number, number] = [0.5, 0.5];
  private progs = new Map<string, Prog>();
  private quad: WebGLVertexArrayObject;
  private grid: WebGLVertexArrayObject;
  private gridN: number;
  private blank: Tex;
  private tex = new Map<string, Tex>();
  private pending = new Set<string>();
  private ready: { path: string; bm: ImageBitmap }[] = [];
  onReady: () => void = () => {};
  private target: Target | null = null;
  readonly renderer: string;
  private cur: Prog | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('no webgl2');
    this.gl = gl;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    this.renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    // unit quad (strip) and a 20x24 grid for the bendable card
    this.quad = gl.createVertexArray()!;
    gl.bindVertexArray(this.quad);
    this.attr(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]));
    this.grid = gl.createVertexArray()!;
    gl.bindVertexArray(this.grid);
    const NX = 20, NY = 24;
    const v: number[] = [];
    for (let y = 0; y <= NY; y++) for (let x = 0; x <= NX; x++) v.push(x / NX, y / NY);
    this.attr(new Float32Array(v));
    const idx: number[] = [];
    for (let y = 0; y < NY; y++)
      for (let x = 0; x < NX; x++) {
        const a = y * (NX + 1) + x;
        idx.push(a, a + 1, a + NX + 1, a + 1, a + NX + 2, a + NX + 1);
      }
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    this.gridN = idx.length;
    gl.bindVertexArray(null);
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([200, 200, 200, 255]));
    this.blank = { t, path: '', rect: [0, 0, 1, 1], dom: [0.8, 0.8, 0.8], dom2: [0.8, 0.8, 0.8], bytes: 4 };
  }

  private attr(data: Float32Array) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }

  prog(key: string, vs: string, fs: string): Prog {
    let p = this.progs.get(key);
    if (p) return p;
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`${key}: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const pr = gl.createProgram()!;
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(pr, 0, 'aUV');
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(`${key}: ${gl.getProgramInfoLog(pr)}`);
    p = new Prog(gl, pr);
    this.progs.set(key, p);
    return p;
  }

  /** compile a rect-quad fragment program (vertex shader is QUAD_VS, fragment gets vPx in css px) */
  rectProg(key: string, fs: string) {
    return this.prog(key, QUAD_VS, fs);
  }

  use(p: Prog) {
    this.gl.useProgram(p.p);
    this.cur = p;
    p.f('uRes', this.W, this.H).f('uDpr', this.dpr);
    return p;
  }

  blend(mode: 'straight' | 'pre') {
    const gl = this.gl;
    if (mode === 'straight') gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** draw the unit quad over css rect [x0,y0,x1,y1] with the current program */
  rect(x0: number, y0: number, x1: number, y1: number) {
    const gl = this.gl;
    this.cur!.f('uRect', x0, y0, x1, y1);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  full() {
    this.rect(0, 0, this.W, this.H);
  }

  bg(c: RGB) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(c[0] / 255, c[1] / 255, c[2] / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  shadow(r: Rect, radius: number, blur: number, alpha: number, dy: number) {
    if (alpha <= 0.002) return;
    const m = blur * 3 + 4;
    this.blend('straight');
    const p = this.use(this.prog('shadow', QUAD_VS, SHADOW_FS));
    p.f('uBox', r.x, r.y + dy, r.x + r.w, r.y + r.h + dy).f('uRad', radius).f('uBlur', blur).f('uAlpha', alpha);
    this.rect(r.x - m, r.y + dy - m, r.x + r.w + m, r.y + r.h + dy + m);
  }

  card(o: CardOpts) {
    const gl = this.gl;
    const p = this.use(this.prog('card', CARD_VS, CARD_FS));
    const t0 = o.tex ?? this.blank;
    const t1 = o.tex2 ?? t0;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t0.t);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, t1.t);
    p.i('uT0', 0).i('uT1', 1);
    p.f('uVP', this.W / 2, this.H * this.vpY).f('uF', F).f('uSize', o.w, o.h).f('uC', o.cx, o.cy, o.cz ?? 0).f('uRot', o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
    const b = o.bend ?? [0, 0, 0];
    p.f('uBend', b[0], b[1], b[2], 0).f('uTap', ...(o.tap ?? this.tapUV));
    p.f('uR0', ...t0.rect).f('uR1', ...t1.rect).f('uD0', ...t0.dom).f('uE0', ...t0.dom2).f('uD1', ...t1.dom).f('uE1', ...t1.dom2);
    p.f('uMix', o.mix ?? 0).f('uRad', o.radius ?? CARD_R).f('uBias', o.bias ?? 0).f('uDim', o.dim ?? 0).f('uAlpha', o.alpha ?? 1);
    p.f('uSpec', ...(o.spec ?? [0, 1, 0, 0])).f('uRake', o.rake ?? 0);
    this.blend('straight');
    gl.bindVertexArray(this.grid);
    gl.drawElements(gl.TRIANGLES, this.gridN, gl.UNSIGNED_SHORT, 0);
  }

  /** the back cards of the stack. rec = extra "recede" applied by a transition (all optional, 0 = rest pose). */
  backs(e: Env, rec: { z?: number; s?: number; dim?: number; bias?: number; alpha?: number } = {}, wob = 0) {
    const v = e.deck;
    const n = this.count;
    const dir = v.to > v.from ? 1 : v.to < v.from ? -1 : 0;
    let b1: number, step: number, dp: number;
    if (dir !== 0) {
      b1 = v.to;
      step = dir;
      dp = v.dyeP;
    } else {
      const up = v.from + 1 < n;
      b1 = up ? v.from + 1 : v.from - 1;
      step = up ? 1 : -1;
      dp = 0;
    }
    const list = [
      { i: b1 + 2 * step, d: 3 - dp, a: dp },
      { i: b1 + step, d: 2 - dp, a: 1 },
      { i: b1, d: 1 - dp, a: 1 },
    ];
    const ra = rec.alpha ?? 1;
    for (const c of list) {
      if (c.i < 0 || c.i >= n || c.a <= 0 || ra <= 0) continue;
      const d = c.d;
      this.card({
        tex: this.get(this.paths[c.i]),
        cx: e.slot.x + e.slot.w / 2,
        cy: e.slot.y + e.slot.h / 2 - 26 * d,
        cz: -40 * d + (rec.z ?? 0) * Math.min(d, 1) + wob,
        w: e.slot.w * (1 - (0.06 * d + (rec.s ?? 0) * Math.min(d, 1))),
        h: e.slot.h * (1 - (0.06 * d + (rec.s ?? 0) * Math.min(d, 1))),
        dim: 0.11 * d + (rec.dim ?? 0) * Math.min(d, 1),
        bias: Math.min(4.5, 1.5 * d + (rec.bias ?? 0) * Math.min(d, 1)),
        alpha: c.a * ra,
      });
    }
  }

  /** the front card at its deck pose (drag translation, +-10deg tilt, specular sheet). */
  front(e: Env, opts: Partial<CardOpts> = {}, wob = 0) {
    const v = e.deck;
    const s = e.slot;
    const k = Math.max(-1, Math.min(1, v.dx / s.w));
    const rz = (k * 10 * Math.PI) / 180;
    // pivot below the card so the tilt reads as a hand-held card
    const px = s.x + s.w / 2, py = s.y + s.h * 1.1;
    const cx = s.x + s.w / 2 + v.dx, cy = s.y + s.h / 2;
    const ox = cx - (px + v.dx), oy = cy - py;
    const c = Math.cos(rz), sn = Math.sin(rz);
    const out = Math.abs(v.dyeP) > 0 && v.to !== v.from ? smoothstepJS(0.55, 1, v.dyeP) : 0;
    const press = 1 - out;
    this.card({
      tex: this.get(this.paths[v.from]),
      cx: px + v.dx + ox * c - oy * sn,
      cy: py + ox * sn + oy * c,
      cz: wob,
      w: s.w,
      h: s.h,
      rz,
      alpha: press,
      spec: [-k * 0.7 + 0.15, 0.17, 0.045 + 0.1 * Math.abs(k), 0.5],
      ...opts,
    });
  }

  get blankTex() {
    return this.blank;
  }
  texOrBlank(t: Tex | null) {
    return (t ?? this.blank).t;
  }
  /** textures for the front card: the hero's current image fades to the deck image as p -> 0 */
  cardTex(e: Env): { tex: Tex | null; tex2?: Tex | null; mix?: number } {
    const d = this.get(this.paths[e.deck.from]);
    const h = e.heroPath ? this.get(e.heroPath) : null;
    if (!h || h === d) return { tex: d };
    return { tex: h, tex2: d, mix: 1 - smoothstepJS(0.15, 0.6, e.p) };
  }

  // ---- half-res target (ink) ------------------------------------------------------------------
  targetFor(scale: number): Target {
    const gl = this.gl;
    const w = Math.max(1, Math.round(this.W * this.dpr * scale)), h = Math.max(1, Math.round(this.H * this.dpr * scale));
    if (this.target && this.target.w === w && this.target.h === h) return this.target;
    if (this.target) {
      gl.deleteFramebuffer(this.target.fb);
      gl.deleteTexture(this.target.tex);
    }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.target = { fb, tex, w, h };
    return this.target;
  }
  bindTarget(t: Target | null) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null);
    gl.viewport(0, 0, t ? t.w : this.canvas.width, t ? t.h : this.canvas.height);
  }

  // ---- textures --------------------------------------------------------------------------------
  paths: string[] = []; // front image per product (deck order)
  count = 0;
  setPaths(p: string[]) {
    this.paths = p;
    this.count = p.length;
  }
  get(path: string): Tex | null {
    return this.tex.get(path) ?? null;
  }
  has(path: string) {
    return this.tex.has(path);
  }
  /** make sure `want` are (being) loaded and everything else is evicted */
  want(want: string[]) {
    const keep = new Set(want);
    for (const [k, t] of this.tex) if (!keep.has(k)) (this.gl.deleteTexture(t.t), this.tex.delete(k));
    for (const path of want) {
      if (this.tex.has(path) || this.pending.has(path)) continue;
      this.pending.add(path);
      fetch(imgUrl(path))
        .then((r) => r.blob())
        .then((b) => createImageBitmap(b))
        .then((bm) => {
          this.pending.delete(path);
          if (!keep.has(path) && !this.wanted(path)) return bm.close();
          this.ready.push({ path, bm });
          this.onReady();
        })
        .catch(() => this.pending.delete(path));
    }
    this.wantSet = keep;
  }
  private wantSet = new Set<string>();
  private wanted(p: string) {
    return this.wantSet.has(p);
  }
  get busyUploads() {
    return this.ready.length;
  }
  /** upload at most one decoded bitmap (called by the engine between animations, never on the tap frame) */
  pump(): boolean {
    const j = this.ready.shift();
    if (!j) return false;
    if (this.wantSet.has(j.path) && !this.tex.has(j.path)) {
      const gl = this.gl;
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, j.bm);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const info = imgInfo(j.path);
      this.tex.set(j.path, {
        t,
        path: j.path,
        rect: containRect(info.w, info.h),
        dom: [info.c0[0] / 255, info.c0[1] / 255, info.c0[2] / 255],
        dom2: [info.c1[0] / 255, info.c1[1] / 255, info.c1[2] / 255],
        bytes: Math.round(j.bm.width * j.bm.height * 4 * 1.34),
      });
    }
    j.bm.close();
    return true;
  }
  stats() {
    let bytes = 0;
    for (const t of this.tex.values()) bytes += t.bytes;
    return { textures: this.tex.size, mb: bytes / 1048576 };
  }

  resize(W: number, H: number, vpY: number) {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = W;
    this.H = H;
    this.vpY = vpY;
    const c = this.canvas;
    c.width = Math.round(W * this.dpr);
    c.height = Math.round(H * this.dpr);
  }
}

export const smoothstepJS = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
