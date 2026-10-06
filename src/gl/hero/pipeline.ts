/**
 * The hero's GL resources and per-frame passes: velocity -> deviation (the sim), then one display pass whose
 * output depends on the selected stage. Everything GL-object-shaped is created in `build()` so context
 * restoration can simply call it again.
 */
import {
  bindTexture,
  createPair,
  createProgram,
  gpuDone,
  type GLContext,
  type Pair,
  type Program,
} from '../renderer';
import { COMPOSITE_GLSL } from './stages/composite';
import { DEVIATION_FS, FLOW_VIEW, VELOCITY_FS } from './stages/flow';
import { HEADER, SDF_GLSL, SDF_META, SDF_VIEW } from './stages/sdf';
import { WARP_GLSL, WARP_VIEW } from './stages/warp';
import { HeroStage } from './stage';
import type { Theme } from './theme';
import type { Tier } from '../../lib/core/quality';

export interface TierSpec {
  /** devicePixelRatio cap */
  dpr: number;
  /** long side of the velocity / deviation textures */
  vel: number;
  dev: number;
}

export const TIER_SPECS: Record<Tier, TierSpec> = {
  low: { dpr: 1, vel: 64, dev: 256 },
  mid: { dpr: 1.5, vel: 96, dev: 384 },
  high: { dpr: 2, vel: 128, dev: 512 },
};

export interface Layout {
  /** canvas backing store, px */
  w: number;
  h: number;
  /** canvas px per css px */
  px: number;
  /** poster box inside the canvas, canvas px, top-left origin */
  box: [number, number, number, number];
  /** canvas css height (the sim length unit) */
  cssH: number;
  cssW: number;
}

export interface Force {
  /** segment endpoints in height units (x*aspect, y), y up */
  a: [number, number];
  b: [number, number];
  vel: [number, number];
  /** 0..1, 0 = none */
  active: number;
}

export interface FrameInput {
  dt: number;
  time: number;
  force: Force;
}

const VEL_FS = `${HEADER}${SDF_GLSL}${VELOCITY_FS}`;
const DEV_FS = `${HEADER}${SDF_GLSL}${WARP_GLSL}${DEVIATION_FS}`;
const DISPLAY_FS = `${HEADER}uniform sampler2D uV, uD; // velocity, ink deviation
uniform float uAspect, uVMax;
${SDF_GLSL}${WARP_GLSL}${SDF_VIEW}${WARP_VIEW}${FLOW_VIEW}${COMPOSITE_GLSL}
void main(){
#if STAGE == 0
  o = vec4(stageSdf(vUv), 1.0);
#elif STAGE == 1
  o = vec4(stageWarp(vUv), 1.0);
#elif STAGE == 2
  o = vec4(stageFlow(vUv), 1.0);
#else
  o = compositeInk(vUv);
#endif
}`;

const STAGE_ID: Record<HeroStage, number> = { sdf: 0, warp: 1, flow: 2, composite: 3 };

/** peak ink speed (css px/s) the pointer can impart; keeps flicks from throwing ink across the page */
const V_MAX_PX = 1100;
const RELAX = 1.4; // 1/s: how fast deviation decays back to the wordmark

export interface Pipeline {
  readonly stage: HeroStage;
  readonly simSize: { vel: [number, number]; dev: [number, number] };
  setStage(s: HeroStage): void;
  setTheme(t: Theme): void;
  /** (re)allocate size-dependent resources; resets the ink to its rest state */
  resize(layout: Layout, tier: Tier): void;
  frame(f: FrameInput): void;
  /** resolves when the GPU has finished the frames submitted so far */
  done(): Promise<void>;
  /** recreate every GL object (after webglcontextrestored) */
  rebuild(): void;
  dispose(): void;
}

export function createPipeline(ctx: GLContext, sdf: ImageBitmap | HTMLImageElement, initialStage: HeroStage): Pipeline {
  const { gl } = ctx;
  let stage = initialStage;
  let theme: Theme | null = null;
  let layout: Layout | null = null;
  let tier: Tier = 'mid';

  let sdfTex: WebGLTexture | null = null;
  let vel: Pair | null = null;
  let dev: Pair | null = null;
  let progVel: Program | null = null;
  let progDev: Program | null = null;
  const display = new Map<HeroStage, Program>();
  let fresh = true;

  const needsSim = (s: HeroStage) => s === HeroStage.Flow || s === HeroStage.Composite;

  function ensurePrograms() {
    if (!display.has(stage)) display.set(stage, createProgram(gl, DISPLAY_FS, `#define STAGE ${STAGE_ID[stage]}`));
    if (needsSim(stage) && !progVel) {
      progVel = createProgram(gl, VEL_FS);
      progDev = createProgram(gl, DEV_FS);
    }
  }

  function allocSim() {
    vel?.dispose();
    dev?.dispose();
    vel = dev = null;
    if (!layout || !needsSim(stage)) return;
    const spec = TIER_SPECS[tier];
    const aspect = layout.w / layout.h;
    const long = (n: number): [number, number] =>
      aspect >= 1 ? [n, Math.max(2, Math.round(n / aspect))] : [Math.max(2, Math.round(n * aspect)), n];
    vel = createPair(gl, ...long(spec.vel));
    dev = createPair(gl, ...long(spec.dev));
    fresh = true;
  }

  function build() {
    sdfTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, sdfTex);
    // the PNG holds raw distance values: no colour management, no premultiplication, no flip
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, sdf);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    display.clear();
    progVel = progDev = null;
    ensurePrograms();
    allocSim();
  }
  build();

  const { sdf: S, box: BOX } = SDF_META;

  function setCommon(P: Program) {
    const u = P.u;
    const l = layout!;
    gl.uniform1i(u.uSDF, 0);
    gl.uniform2f(u.uRes, l.w, l.h);
    gl.uniform4f(u.uBox, l.box[0], l.box[1], l.box[2], l.box[3]);
    gl.uniform2f(u.uBoxUnits, BOX[0], BOX[1]);
    gl.uniform1f(u.uPad, S.pad);
    gl.uniform1f(u.uSpread, S.spread);
    gl.uniform1f(u.uPx, l.px);
    gl.uniform1f(u.uWarp, 5);
    if (theme) {
      gl.uniform3fv(u.uPaper, theme.paper);
      gl.uniform3fv(u.uInk, theme.ink);
      gl.uniform3fv(u.uAccent, theme.accent);
      gl.uniform3fv(u.uBlue, theme.blue);
    }
  }

  const draw = () => gl.drawArrays(gl.TRIANGLES, 0, 3);

  return {
    get stage() {
      return stage;
    },
    get simSize() {
      return {
        vel: vel ? ([vel.read.w, vel.read.h] as [number, number]) : ([0, 0] as [number, number]),
        dev: dev ? ([dev.read.w, dev.read.h] as [number, number]) : ([0, 0] as [number, number]),
      };
    },
    setStage(s) {
      if (s === stage) return;
      stage = s;
      ensurePrograms();
      if (needsSim(s) && !vel) allocSim();
    },
    setTheme(t) {
      theme = t;
    },
    resize(l, t) {
      layout = l;
      tier = t;
      allocSim();
    },
    frame({ dt, time, force }) {
      if (!layout) return;
      const l = layout;
      const aspect = l.w / l.h;
      bindTexture(gl, 0, sdfTex!);
      const unitsPerPx = BOX[0] / l.box[2];
      if (needsSim(stage) && vel && dev && progVel && progDev) {
        // freshly (re)allocated targets have zero deviation = rest state; just run a normal step
        const sdt = fresh ? 1 / 60 : Math.min(dt, 1 / 20);
        fresh = false;
        const vmax = V_MAX_PX / l.cssH;
        // 1. velocity
        gl.useProgram(progVel.p);
        setCommon(progVel);
        gl.viewport(0, 0, vel.write.w, vel.write.h);
        gl.bindFramebuffer(gl.FRAMEBUFFER, vel.write.fbo);
        bindTexture(gl, 1, vel.read.tex);
        gl.uniform1i(progVel.u.uV, 1);
        gl.uniform1f(progVel.u.uDt, sdt);
        gl.uniform1f(progVel.u.uAspect, aspect);
        gl.uniform1f(progVel.u.uActive, force.active);
        gl.uniform1f(progVel.u.uRadius, Math.min(Math.max(0.022 * l.cssW, 22), 44) / l.cssH);
        gl.uniform1f(progVel.u.uVMax, vmax);
        gl.uniform2f(progVel.u.uA, force.a[0], force.a[1]);
        gl.uniform2f(progVel.u.uB, force.b[0], force.b[1]);
        gl.uniform2f(progVel.u.uPVel, force.vel[0], force.vel[1]);
        draw();
        vel.swap();
        // 2. deviation
        gl.useProgram(progDev.p);
        setCommon(progDev);
        gl.uniform1f(progDev.u.uTime, time);
        gl.viewport(0, 0, dev.write.w, dev.write.h);
        gl.bindFramebuffer(gl.FRAMEBUFFER, dev.write.fbo);
        bindTexture(gl, 1, vel.read.tex);
        bindTexture(gl, 2, dev.read.tex);
        gl.uniform1i(progDev.u.uV, 1);
        gl.uniform1i(progDev.u.uD, 2);
        gl.uniform1f(progDev.u.uDt, sdt);
        gl.uniform1f(progDev.u.uAspect, aspect);
        gl.uniform1f(progDev.u.uRelax, RELAX);
        // soft rest edge sized to one deviation texel, so the correction term is smooth at sim resolution
        gl.uniform1f(progDev.u.uSoft, Math.max(unitsPerPx * 0.75, (l.w / dev.read.w) * unitsPerPx * 0.75));
        draw();
        dev.swap();
      }
      // 3. display
      const P = display.get(stage)!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, l.w, l.h);
      gl.useProgram(P.p);
      setCommon(P);
      gl.uniform1f(P.u.uTime, time);
      // light ink on dark paper glows more readily than dark on light, so keep the bleed quieter there
      const paperLum = theme ? 0.2126 * theme.paper[0] + 0.7152 * theme.paper[1] + 0.0722 * theme.paper[2] : 1;
      gl.uniform1f(P.u.uBleed, paperLum < 0.3 ? 0.1 : 0.17);
      gl.uniform1f(P.u.uAspect, aspect);
      gl.uniform1f(P.u.uVMax, V_MAX_PX / l.cssH);
      if (vel && dev) {
        bindTexture(gl, 1, vel.read.tex);
        bindTexture(gl, 2, dev.read.tex);
        gl.uniform1i(P.u.uV, 1);
        gl.uniform1i(P.u.uD, 2);
      }
      draw();
    },
    done() {
      return gpuDone(gl);
    },
    dispose() {
      vel?.dispose();
      dev?.dispose();
      if (sdfTex) gl.deleteTexture(sdfTex);
      for (const p of [progVel, progDev, ...display.values()]) if (p) gl.deleteProgram(p.p);
      display.clear();
    },
    rebuild() {
      // every old object died with the context: forget them instead of deleting
      vel = dev = null;
      sdfTex = null;
      progVel = progDev = null;
      build();
    },
  };
}
