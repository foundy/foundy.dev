/**
 * WebGL2 plumbing shared by every GL piece on the site: context creation + capability checks, program/target
 * helpers, size observation, a pausable rAF loop (hidden tab / off-screen / idle / context lost) and
 * context loss recovery. No hero-specific knowledge lives here.
 */

export class GLUnavailable extends Error {}

export interface Caps {
  /** RGBA16F render targets are usable (EXT_color_buffer_float or EXT_color_buffer_half_float) */
  floatTargets: boolean;
  /** UNMASKED_RENDERER when exposed, else RENDERER */
  gpu: string;
}

export interface GLContext {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  caps: Caps;
  /** true between webglcontextlost and webglcontextrestored */
  readonly lost: boolean;
  dispose(): void;
}

export interface ContextHooks {
  onLost?: () => void;
  /** GL objects are gone: recreate every program, texture and framebuffer here */
  onRestored?: () => void;
}

export function createContext(canvas: HTMLCanvasElement, hooks: ContextHooks = {}): GLContext {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'default',
  });
  if (!gl) throw new GLUnavailable('webgl2 unavailable');
  const floatTargets = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  if (!floatTargets) throw new GLUnavailable('no half-float render targets');
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  const loseExt = gl.getExtension('WEBGL_lose_context');

  let lost = false;
  const onLost = (e: Event) => {
    e.preventDefault(); // required, or the browser will never restore
    lost = true;
    hooks.onLost?.();
  };
  const onRestored = () => {
    // extensions must be re-enabled on a restored context
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('EXT_color_buffer_half_float');
    lost = false;
    hooks.onRestored?.();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  return {
    gl,
    canvas,
    caps: { floatTargets, gpu },
    get lost() {
      return lost;
    },
    dispose() {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      loseExt?.loseContext();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Programs                                                            */
/* ------------------------------------------------------------------ */
export interface Program {
  p: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

const VERT = `#version 300 es
out vec2 vUv;
void main(){
  vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2));
  vUv = p; gl_Position = vec4(p*2.0-1.0, 0.0, 1.0);
}`;

/** Full-screen triangle program. `defines` are inserted right after `#version`. */
export function createProgram(gl: WebGL2RenderingContext, frag: string, defines = ''): Program {
  const fs = defines ? frag.replace('#version 300 es', `#version 300 es\n${defines}`) : frag;
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const v = compile(gl.VERTEX_SHADER, VERT);
  const f = compile(gl.FRAGMENT_SHADER, fs);
  const p = gl.createProgram()!;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  // reading the status forces a lazily-compiled program to finish, so compile cost lands in init, not frame 1
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = `${gl.getShaderInfoLog(f) ?? ''} ${gl.getProgramInfoLog(p) ?? ''}`.trim();
    gl.deleteProgram(p);
    throw new Error(`glsl: ${log}`);
  }
  gl.deleteShader(v);
  gl.deleteShader(f);
  const u: Program['u'] = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i)!.name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, name);
  }
  return { p, u };
}

/* ------------------------------------------------------------------ */
/* Render targets                                                      */
/* ------------------------------------------------------------------ */
export interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

export function createTarget(gl: WebGL2RenderingContext, w: number, h: number): Target {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null); // zero-initialised
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteTexture(tex);
    gl.deleteFramebuffer(fbo);
    throw new GLUnavailable(`float framebuffer incomplete (0x${status.toString(16)})`);
  }
  return { tex, fbo, w, h };
}

export function deleteTarget(gl: WebGL2RenderingContext, t: Target | null) {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
}

export interface Pair {
  /** read from `read`, write to `write`, then `swap()` */
  read: Target;
  write: Target;
  swap(): void;
  dispose(): void;
}

export function createPair(gl: WebGL2RenderingContext, w: number, h: number): Pair {
  let a = createTarget(gl, w, h);
  let b: Target;
  try {
    b = createTarget(gl, w, h);
  } catch (e) {
    deleteTarget(gl, a);
    throw e;
  }
  return {
    get read() {
      return a;
    },
    get write() {
      return b;
    },
    swap() {
      [a, b] = [b, a];
    },
    dispose() {
      deleteTarget(gl, a);
      deleteTarget(gl, b);
    },
  };
}

export function bindTexture(gl: WebGL2RenderingContext, unit: number, tex: WebGLTexture) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
}

/**
 * Resolves once the GPU has finished everything submitted so far, without stalling the main thread
 * (fence + polling, unlike readPixels). Gives up after `timeoutMs` so a driver that never signals cannot hang us.
 */
export function gpuDone(gl: WebGL2RenderingContext, timeoutMs = 500): Promise<void> {
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  if (!fence) return Promise.resolve();
  const t0 = performance.now();
  return new Promise((resolve) => {
    const poll = () => {
      const st = gl.clientWaitSync(fence, 0, 0);
      if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED || st === gl.WAIT_FAILED || performance.now() - t0 > timeoutMs) {
        gl.deleteSync(fence);
        resolve();
      } else {
        setTimeout(poll, 2);
      }
    };
    poll();
  });
}

/* ------------------------------------------------------------------ */
/* Loop: rAF that sleeps when hidden, off-screen, idle or context lost   */
/* ------------------------------------------------------------------ */
export interface LoopOptions {
  /** observed for visibility */
  target: Element;
  /** draw one frame; return false to go to sleep until `wake()` */
  frame(now: number): boolean;
  /** called when the loop (re)starts after any pause, so clocks can drop the gap */
  onStart?(now: number): void;
  onStop?(): void;
}

export interface Loop {
  /** keep drawing for at least `ms` more milliseconds (0 = draw until `frame` says stop) */
  wake(ms?: number): void;
  /** force an external pause reason (context lost) */
  setBlocked(blocked: boolean): void;
  readonly running: boolean;
  readonly paused: boolean;
  readonly frames: number;
  dispose(): void;
}

export function createLoop(o: LoopOptions): Loop {
  let raf = 0;
  let running = false;
  let wanted = false;
  let hidden = document.hidden;
  let offscreen = false;
  let blocked = false;
  let frames = 0;
  let until = 0;
  let disposed = false;

  const step = (now: number) => {
    raf = 0;
    if (!running || disposed) return;
    frames++;
    const keep = o.frame(now);
    if (!running || disposed) return;
    if (keep || now < until) {
      raf = requestAnimationFrame(step);
    } else {
      running = false;
      wanted = false;
      o.onStop?.();
    }
  };

  const sync = () => {
    const can = wanted && !hidden && !offscreen && !blocked && !disposed;
    if (can && !running) {
      running = true;
      o.onStart?.(performance.now());
      raf = requestAnimationFrame(step);
    } else if (!can && running) {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      o.onStop?.();
    }
  };

  const onVis = () => {
    hidden = document.hidden;
    sync();
  };
  document.addEventListener('visibilitychange', onVis);
  const io = new IntersectionObserver((es) => {
    offscreen = !es[es.length - 1].isIntersecting;
    sync();
  });
  io.observe(o.target);

  return {
    wake(ms = 0) {
      until = Math.max(until, performance.now() + ms);
      wanted = true;
      sync();
    },
    setBlocked(b) {
      blocked = b;
      sync();
    },
    get running() {
      return running;
    },
    get paused() {
      return hidden || offscreen || blocked;
    },
    get frames() {
      return frames;
    },
    dispose() {
      disposed = true;
      running = false;
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
      io.disconnect();
    },
  };
}
