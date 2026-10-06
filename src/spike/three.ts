/**
 * Variant A: three (WebGPURenderer + TSL). Same pipeline as raw.ts, written as
 * TSL node graphs; each stage is a separate NodeMaterial rendered through a
 * QuadMesh into half-float render targets. `?gl=webgl2` forces the WebGL2 backend.
 * Composite look: ink only (looks are explored in raw.ts).
 */
import {
  WebGPURenderer,
  QuadMesh,
  NodeMaterial,
  RenderTarget,
  DataTexture,
  Vector2,
  Vector3,
  HalfFloatType,
  RedFormat,
  RGBAFormat,
  LinearFilter,
  ClampToEdgeWrapping,
  LinearSRGBColorSpace,
} from 'three/webgpu';
import {
  Fn,
  uniform,
  texture,
  uv,
  vec2,

  vec4,
  float,
  fract,
  floor,
  dot,
  mix,
  smoothstep,
  exp,
  sqrt,
  min,
  max,
  abs,
  clamp,
  length,
  normalize,
  fwidth,
  step,
  select,
} from 'three/tsl';
import type { FrameState, Renderer, RendererInit } from './common';

type N = any; // TSL node typings fight Fn(([p]) => ...) destructuring, see docs
const RT_LONG_VEL = 96;
const RT_LONG_DENS = 384;

function makeRT(w: number, h: number) {
  return new RenderTarget(w, h, {
    type: HalfFloatType,
    format: RGBAFormat,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
    depthBuffer: false,
    generateMipmaps: false,
  });
}

export function createThree({ canvas, sdf, theme, query }: RendererInit): Renderer {
  const renderer = new WebGPURenderer({
    canvas,
    antialias: false,
    alpha: false,
    forceWebGL: query.forceWebGL,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = LinearSRGBColorSpace; // write palette values as-is, like raw.ts
  renderer.setPixelRatio(1);

  const stageId = { sdf: 0, warp: 1, flow: 2, composite: 3 }[query.stage];
  const needsSim = stageId >= 2;

  let backendName = 'unknown';
  let gpuInfo = '';
  let aspect = 1;
  let resW = 2;
  let resH = 2;
  let dpr = 1;
  let fresh = true;

  // ---- uniforms -------------------------------------------------------
  const uAspect = uniform(1);
  const uSdfAspect = uniform(sdf.width / sdf.height);
  const uFit = uniform(1);
  const uWarp = uniform(0.012);
  const uEdge = uniform(0.04);
  const uTime = uniform(0);
  const uDt = uniform(1 / 60);
  const uA = uniform(new Vector2());
  const uB = uniform(new Vector2());
  const uPVel = uniform(new Vector2());
  const uActive = uniform(0);
  const uRes = uniform(new Vector2(2, 2));
  const uDpr = uniform(1);
  const uSdfRadius = uniform(sdf.radius);
  const c3 = (c: number[]) => uniform(new Vector3(c[0], c[1], c[2]));
  const uPaper = c3(theme.paper);
  const uInk = c3(theme.ink);
  const uAccent = c3(theme.accent);
  const uBlue = c3(theme.blue);

  // ---- textures -------------------------------------------------------
  const sdfTex = new DataTexture(sdf.data, sdf.width, sdf.height, RedFormat, HalfFloatType);
  sdfTex.minFilter = LinearFilter;
  sdfTex.magFilter = LinearFilter;
  sdfTex.wrapS = sdfTex.wrapT = ClampToEdgeWrapping;
  sdfTex.generateMipmaps = false;
  sdfTex.needsUpdate = true;
  const sdfNode = texture(sdfTex);

  let velRT: [RenderTarget, RenderTarget] | null = null;
  let densRT: [RenderTarget, RenderTarget] | null = null;
  let vi = 0;
  let di = 0;
  const velNode = texture(new RenderTarget(2, 2).texture);
  const densNode = texture(new RenderTarget(2, 2).texture);

  // ---- TSL helpers ------------------------------------------------------
  // Field coordinates: "up" space (y up) like the GLSL version. The quad's uv() has y down
  // and render-target texels are addressed with that same uv, so flip on the way in and out.
  const toUp = (U: N) => vec2(U.x, float(1).sub(U.y));
  const fld = (node: typeof velNode, up: N) => node.sample(vec2(up.x, float(1).sub(up.y)));

  const sdfUV = (up: N) => {
    const p = up.sub(0.5).mul(vec2(uAspect, 1));
    return p.div(vec2(uSdfAspect, 1).mul(uFit)).add(0.5);
  };
  const hash: (p: N) => N = Fn(([p_]: [N]) => {
    const p: N = fract(p_.mul(vec2(123.34, 456.21))).toVar();
    p.addAssign(dot(p, p.add(45.32)));
    return fract(p.x.mul(p.y));
  });
  const vnoise: (p: N) => N = Fn(([p]: [N]) => {
    const i = floor(p);
    const f0 = fract(p);
    const f: N = f0.mul(f0).mul(float(3).sub(f0.mul(2)));
    return mix(
      mix(hash(i), hash(i.add(vec2(1, 0))), f.x),
      mix(hash(i.add(vec2(0, 1))), hash(i.add(vec2(1, 1))), f.x),
      f.y,
    );
  });
  const fbm2: (p: N) => N = Fn(([p]: [N]) =>
    vnoise(p).mul(0.65).add(vnoise(p.mul(2.03).add(17.1)).mul(0.35)),
  );
  const restInk = (up: N) => {
    const q0 = sdfUV(up);
    const base = q0.mul(vec2(5, 2));
    const w = vec2(
      fbm2(base.add(vec2(0, uTime.mul(0.05)))),
      fbm2(base.add(vec2(31.7, uTime.mul(-0.04)))),
    ).sub(0.5);
    const q = q0.add(w.mul(uWarp));
    const s = sdfNode.sample(q).r;
    return smoothstep(float(0.5).sub(uEdge), float(0.5).add(uEdge), s);
  };

  const segDist: (p: N, a: N, b: N) => N = Fn(([p, a, b]: [N, N, N]) => {
    const pa = p.sub(a);
    const ba = b.sub(a);
    const h = clamp(dot(pa, ba).div(max(dot(ba, ba), 1e-6)), 0, 1);
    return length(pa.sub(ba.mul(h)));
  });

  // ---- passes -----------------------------------------------------------
  const velMat = new NodeMaterial();
  velMat.fragmentNode = Fn(() => {
    const up = toUp(uv());
    const v = fld(velNode, up).xy;
    const back = up.sub(v.mul(uDt).div(vec2(uAspect, 1)));
    const vn = fld(velNode, back).xy.mul(exp(uDt.mul(-2.2))).toVar();
    const P = vec2(up.x.mul(uAspect), up.y);
    const d = segDist(P, uA, uB);
    const g = exp(d.mul(d).div(2 * 0.055 * 0.055).negate()).mul(uActive);
    const target = clamp(uPVel, -3, 3);
    vn.assign(mix(vn, target, g.mul(float(1).sub(exp(uDt.mul(-18))))));
    return vec4(vn, 0, 1);
  })();

  const densMat = new NodeMaterial();
  densMat.fragmentNode = Fn(() => {
    const up = toUp(uv());
    const v = fld(velNode, up).xy;
    const back = up.sub(v.mul(uDt).div(vec2(uAspect, 1)));
    const d = fld(densNode, back).r;
    const rest = restInk(up);
    const dn = mix(d, rest, float(1).sub(exp(uDt.mul(-1.4))));
    return vec4(dn, 0, 0, 1);
  })();

  const dispMat = new NodeMaterial();
  const px = (frag: N) => frag;
  void px;
  dispMat.fragmentNode = Fn(() => {
    const U = uv();
    const up = toUp(U);
    const frag = vec2(U.x, float(1).sub(U.y)).mul(uRes); // pixel coords, y up
    if (stageId === 0) {
      const q = sdfUV(up);
      const s = sdfNode.sample(q).r;
      const dist = s.sub(0.5).mul(2).mul(uSdfRadius);
      const w = fwidth(dist);
      const iso = abs(fract(dist.div(4).add(0.5)).sub(0.5)).mul(4);
      const lines = float(1)
        .sub(smoothstep(0, w.mul(1.1), iso))
        .mul(float(1).sub(smoothstep(uSdfRadius.sub(3), uSdfRadius.sub(1), abs(dist))));
      const edge = float(1).sub(smoothstep(0, w.mul(1.4), abs(dist)));
      let col = mix(uPaper, uInk, step(0, dist).mul(0.07));
      col = mix(col, uBlue, lines.mul(0.35));
      col = mix(col, uBlue, edge);
      return vec4(col, 1);
    }
    if (stageId === 1) {
      const r = restInk(up);
      const s = sdfNode.sample(sdfUV(up)).r;
      const ref = float(1).sub(smoothstep(0, fwidth(s).mul(1.5), abs(s.sub(0.5))));
      let col = mix(uPaper, uInk, r);
      col = mix(col, uBlue, ref.mul(0.55).mul(float(1).sub(r.mul(0.6))));
      return vec4(col, 1);
    }
    const d = fld(densNode, up).r;
    if (stageId === 2) {
      let col = mix(uPaper, uInk, d.mul(0.28));
      const P = vec2(up.x.mul(uAspect), up.y);
      const st = 0.05;
      const c = floor(P.div(st)).add(0.5).mul(st);
      const v = fld(velNode, c.div(vec2(uAspect, 1))).xy;
      const lv = length(v);
      const len = min(lv.mul(0.035), st * 0.48);
      const dir = select(lv.greaterThan(1e-4), normalize(v), vec2(0, 0));
      const a0 = c.sub(dir.mul(len));
      const b0 = c.add(dir.mul(len));
      const pa = P.sub(a0);
      const ba = b0.sub(a0);
      const h = clamp(dot(pa, ba).div(max(dot(ba, ba), 1e-8)), 0, 1);
      const dd = length(pa.sub(ba.mul(h)));
      const pxu = float(1).div(uRes.y.div(uDpr));
      const line = float(1)
        .sub(smoothstep(pxu.mul(0.6), pxu.mul(1.4), dd))
        .mul(step(1e-4, lv));
      const dotv = float(1).sub(smoothstep(pxu.mul(1.0), pxu.mul(2.2), length(P.sub(c))));
      const hot = clamp(lv.mul(0.35), 0, 1);
      col = mix(col, mix(uBlue, uAccent, hot), max(line, dotv.mul(0.6)));
      return vec4(col, 1);
    }
    // composite: ink look (same maths as GLSL LOOK 0)
    const g = hash(frag.add(0.37)).sub(0.5);
    const fiber = vnoise(frag.div(uDpr.mul(3))).mul(0.6).add(vnoise(frag.div(uDpr.mul(23))).mul(0.4));
    const paper = uPaper.mul(float(1).add(g.mul(0.045)).add(fiber.sub(0.5).mul(0.05)));
    const tooth = vnoise(frag.div(uDpr.mul(1.6))).mul(0.6).add(vnoise(frag.div(uDpr.mul(5))).mul(0.4));
    const a = smoothstep(0.4, 0.6, d.add(tooth.sub(0.5).mul(0.3)));
    // 9-tap bleed halo
    const r = uDpr.mul(7).div(uRes);
    const t = (ox: number, oy: number) => fld(densNode, up.add(r.mul(vec2(ox, oy)))).r;
    const b = d
      .mul(0.2)
      .add(t(1, 0).mul(0.1))
      .add(t(-1, 0).mul(0.1))
      .add(t(0, 1).mul(0.1))
      .add(t(0, -1).mul(0.1))
      .add(t(0.7, 0.7).mul(0.1))
      .add(t(-0.7, 0.7).mul(0.1))
      .add(t(0.7, -0.7).mul(0.1))
      .add(t(-0.7, -0.7).mul(0.1));
    const halo = smoothstep(0, 0.75, b).mul(0.2).mul(float(0.55).add(tooth.mul(0.45)));
    let col = mix(paper, uInk, halo);
    col = mix(col, uInk, a.mul(0.97));
    void sqrt;
    return vec4(col, 1);
  })();

  const syncBuf = new Uint8Array(4);
  const quad = new QuadMesh(velMat);

  function allocSim() {
    velRT?.forEach((r) => r.dispose());
    densRT?.forEach((r) => r.dispose());
    const long = (n: number): [number, number] =>
      aspect >= 1 ? [n, Math.max(2, Math.round(n / aspect))] : [Math.max(2, Math.round(n * aspect)), n];
    const [vw, vh] = long(RT_LONG_VEL);
    const [dw, dh] = long(RT_LONG_DENS);
    velRT = [makeRT(vw, vh), makeRT(vw, vh)];
    densRT = [makeRT(dw, dh), makeRT(dw, dh)];
    vi = di = 0;
    fresh = true;
  }

  const pass = (mat: NodeMaterial, target: RenderTarget | null) => {
    quad.material = mat;
    renderer.setRenderTarget(target);
    quad.render(renderer);
  };

  return {
    get backend() {
      return backendName;
    },
    get gpuInfo() {
      return gpuInfo;
    },
    async init() {
      await renderer.init();
      const be = renderer.backend as unknown as {
        isWebGPUBackend?: boolean;
        device?: GPUDevice;
        adapter?: GPUAdapter & { info?: GPUAdapterInfo };
        gl?: WebGL2RenderingContext;
      };
      if (be.isWebGPUBackend) {
        const i = be.adapter?.info;
        backendName = 'webgpu (three TSL)';
        gpuInfo = `webgpu ${i ? `${i.vendor} ${i.architecture} ${i.description}`.trim() : 'adapter info n/a'}`;
      } else {
        backendName = 'webgl2 (three TSL fallback)';
        const gl = be.gl;
        const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
        gpuInfo = `webgl2 ${gl ? (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : '?'}`;
      }
      if (needsSim && !velRT) allocSim();
      // compile all pipelines before the first frame so init time includes it
      const mats: NodeMaterial[] = needsSim ? [velMat, densMat, dispMat] : [dispMat];
      for (const m of mats) {
        quad.material = m;
        await renderer.compileAsync(quad, quad.camera);
      }
    },
    resize(w, h, d) {
      dpr = d;
      uDpr.value = d;
      if (w === resW && h === resH) return;
      resW = w;
      resH = h;
      aspect = w / h;
      renderer.setSize(w, h, false);
      uRes.value.set(w, h);
      if (needsSim) allocSim();
    },
    frame(s: FrameState) {
      aspect = s.aspect;
      uAspect.value = aspect;
      uFit.value = Math.min(aspect / (sdf.width / sdf.height), 1) * 0.98;
      uTime.value = s.time;
      uA.value.set(s.a[0], s.a[1]);
      uB.value.set(s.b[0], s.b[1]);
      uPVel.value.set(s.vel[0], s.vel[1]);
      uActive.value = s.active;
      void dpr;
      if (needsSim && velRT && densRT) {
        const dt = fresh ? 100 : s.dt;
        fresh = false;
        uDt.value = Math.min(dt, 1 / 20);
        velNode.value = velRT[vi].texture;
        pass(velMat, velRT[1 - vi]);
        vi = 1 - vi;
        uDt.value = dt;
        velNode.value = velRT[vi].texture;
        densNode.value = densRT[di].texture;
        pass(densMat, densRT[1 - di]);
        di = 1 - di;
        densNode.value = densRT[di].texture;
      }
      pass(dispMat, null);
    },
    async gpuSync() {
      const be = renderer.backend as unknown as { isWebGPUBackend?: boolean; device?: GPUDevice; gl?: WebGL2RenderingContext };
      if (be.isWebGPUBackend && be.device) await be.device.queue.onSubmittedWorkDone();
      else be.gl?.readPixels(0, 0, 1, 1, be.gl.RGBA, be.gl.UNSIGNED_BYTE, syncBuf);
    },
    dispose() {
      velRT?.forEach((r) => r.dispose());
      densRT?.forEach((r) => r.dispose());
      sdfTex.dispose();
      velMat.dispose();
      densMat.dispose();
      dispMat.dispose();
      void renderer.dispose();
    },
  };
}
