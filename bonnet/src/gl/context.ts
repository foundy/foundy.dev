// ONE WebGL2 context for the whole app. Worlds borrow it: they draw into a Target (the canvas or an offscreen
// RenderTarget) and must leave no state behind (see resetState).
export interface Target {
  fbo: WebGLFramebuffer | null;
  /** device pixels */
  w: number;
  h: number;
}

export type U = Record<string, WebGLUniformLocation | null>;
export interface Prog {
  p: WebGLProgram;
  u: U;
}

export const MAX_PIXELS = 2.2e6; // total canvas pixels; keeps a 3x phone or a 5K desktop at a sane fill cost
export const MAX_DPR = 2;

export class GL {
  readonly gl: WebGL2RenderingContext;
  W = 1;
  H = 1;
  /** effective device pixel ratio (<= MAX_DPR, reduced on very large viewports) */
  dpr = 1;
  lost = false;
  readonly gpu: string;
  readonly vao: WebGLVertexArrayObject;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('no webgl2');
    this.gl = gl;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpu = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    this.vao = gl.createVertexArray()!;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
  }

  /** css size + device pixel ratio; returns the effective dpr */
  resize(W: number, H: number, deviceDpr: number): number {
    let px = Math.min(deviceDpr || 1, MAX_DPR);
    while (W * H * px * px > MAX_PIXELS && px > 1) px = Math.max(1, px - 0.25);
    this.W = W;
    this.H = H;
    this.dpr = px;
    this.canvas.width = Math.max(2, Math.round(W * px));
    this.canvas.height = Math.max(2, Math.round(H * px));
    return px;
  }

  screen(): Target {
    return { fbo: null, w: this.canvas.width, h: this.canvas.height };
  }

  program(vs: string, fs: string, bind?: (p: WebGLProgram) => void): Prog {
    const gl = this.gl;
    const sh = (t: number, s: string) => {
      const o = gl.createShader(t)!;
      gl.shaderSource(o, s);
      gl.compileShader(o);
      if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error((gl.getShaderInfoLog(o) || 'shader') + '\n' + s.split('\n').map((l, i) => i + 1 + ' ' + l).join('\n'));
      return o;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    bind?.(p);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
    const u: U = {};
    const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < nu; i++) {
      const info = gl.getActiveUniform(p, i)!;
      u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  /** every world calls this first: defaults for the pipeline state worlds touch */
  reset() {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
    gl.depthMask(true);
    gl.colorMask(true, true, true, true);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(this.vao);
  }

  bind(t: Target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.w, t.h);
  }
}

/** a colour+depth offscreen target (used to composite two worlds during a switch) */
export class RenderTarget {
  readonly tex: WebGLTexture;
  readonly fbo: WebGLFramebuffer;
  private rb: WebGLRenderbuffer;
  readonly target: Target;
  constructor(private gl: WebGL2RenderingContext, w: number, h: number) {
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.rb = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    this.fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.rb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.target = { fbo: this.fbo, w, h };
  }
  dispose() {
    const gl = this.gl;
    gl.deleteFramebuffer(this.fbo);
    gl.deleteTexture(this.tex);
    gl.deleteRenderbuffer(this.rb);
  }
}

export function setU(gl: WebGL2RenderingContext, pr: Prog, name: string, v: number | number[] | Float32Array) {
  const l = pr.u[name];
  if (l == null) return;
  if (typeof v === 'number') gl.uniform1f(l, v);
  else if (v.length === 2) gl.uniform2fv(l, v);
  else if (v.length === 3) gl.uniform3fv(l, v);
  else if (v.length === 4) gl.uniform4fv(l, v);
  else gl.uniformMatrix4fv(l, false, v);
}

export const FULLSCREEN_VS = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); gl_Position = vec4(p*2.-1., 0., 1.); }`;

/** crossfade of two worlds rendered to offscreen targets (Phase A switch; Phase B swaps in the signature transition) */
export class Compositor {
  private pr: Prog;
  private a: RenderTarget | null = null;
  private b: RenderTarget | null = null;
  private idle = 0;
  constructor(private g: GL) {
    this.pr = g.program(
      FULLSCREEN_VS,
      `#version 300 es
precision highp float;
uniform sampler2D uA, uB; uniform vec2 uRes; uniform float uM;
out vec4 o;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 c = uv - .5;
  // a slow push through the water/light: the outgoing world drifts toward the viewer while it fades, the incoming settles
  vec3 A = texture(uA, .5 + c / (1. + .035 * uM)).rgb;
  vec3 B = texture(uB, .5 + c / (1.035 - .035 * uM)).rgb;
  o = vec4(mix(A, B, uM), 1.);
}`,
    );
  }
  /** targets for the outgoing (a) and incoming (b) world, (re)allocated to the canvas size */
  targets(): [Target, Target] {
    const s = this.g.screen();
    if (this.a && (this.a.target.w !== s.w || this.a.target.h !== s.h)) this.free();
    if (!this.a) {
      this.a = new RenderTarget(this.g.gl, s.w, s.h);
      this.b = new RenderTarget(this.g.gl, s.w, s.h);
    }
    this.idle = 0;
    return [this.a.target, this.b!.target];
  }
  /** release the offscreen memory a few seconds after the last switch */
  tickIdle(dt: number) {
    if (this.a && (this.idle += dt) > 4) this.free();
  }
  free() {
    this.a?.dispose();
    this.b?.dispose();
    this.a = this.b = null;
  }
  draw(mix: number, screen: Target) {
    const gl = this.g.gl;
    if (!this.a || !this.b) return;
    this.g.reset();
    this.g.bind(screen);
    gl.useProgram(this.pr.p);
    gl.uniform2f(this.pr.u.uRes, screen.w, screen.h);
    gl.uniform1f(this.pr.u.uM, mix);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.a.tex);
    gl.uniform1i(this.pr.u.uA, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.b.tex);
    gl.uniform1i(this.pr.u.uB, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }
}
