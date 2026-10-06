/**
 * Variant B: raw WebGL2 + hand-written GLSL, ping-pong framebuffers, no library.
 * Stages: sdf (texture) -> warp (noise offset lookup) -> flow (velocity grid +
 * semi-Lagrangian ink advection) -> composite (3 looks).
 */
import type { FrameState, Renderer, RendererInit, RGB } from './common';

const VS = `#version 300 es
out vec2 vUv;
void main(){
  vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2));
  vUv = p; gl_Position = vec4(p*2.0-1.0, 0.0, 1.0);
}`;

const HEAD = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
uniform sampler2D uSDF;
uniform float uAspect, uSdfAspect, uFit, uWarp, uEdge, uTime;
vec2 sdfUV(vec2 uv){ vec2 p=(uv-0.5)*vec2(uAspect,1.0); return p/(vec2(uSdfAspect,1.0)*uFit)+0.5; }
float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
}
float fbm2(vec2 p){ return vnoise(p)*0.65 + vnoise(p*2.03+17.1)*0.35; }
float restInk(vec2 uv, float t){
  vec2 q = sdfUV(uv);
  vec2 w = vec2(fbm2(q*vec2(5.0,2.0)+vec2(0.0,t*0.05)), fbm2(q*vec2(5.0,2.0)+vec2(31.7,-t*0.04))) - 0.5;
  q += w*uWarp;
  return smoothstep(0.5-uEdge, 0.5+uEdge, texture(uSDF,q).r);
}
`;

const FS_VEL = `${HEAD}
uniform sampler2D uV;
uniform float uDt;
uniform vec2 uA, uB, uPVel;
uniform float uActive;
out vec4 o;
float segDist(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/max(dot(ba,ba),1e-6),0.0,1.0); return length(pa-ba*h); }
void main(){
  vec2 uv = vUv;
  vec2 v = texture(uV, uv).xy;
  vec2 back = uv - v*uDt/vec2(uAspect,1.0);
  vec2 vn = texture(uV, back).xy * exp(-uDt*2.2);
  vec2 P = vec2(uv.x*uAspect, uv.y);
  float d = segDist(P, uA, uB);
  float g = exp(-d*d/(2.0*0.055*0.055)) * uActive;
  vn = mix(vn, clamp(uPVel, -3.0, 3.0), g*(1.0-exp(-uDt*18.0)));
  o = vec4(vn, 0.0, 1.0);
}`;

const FS_DENS = `${HEAD}
uniform sampler2D uV, uD;
uniform float uDt;
out vec4 o;
void main(){
  vec2 uv = vUv;
  vec2 v = texture(uV, uv).xy;
  vec2 back = uv - v*uDt/vec2(uAspect,1.0);
  float d = texture(uD, back).r;
  float rest = restInk(uv, uTime);
  d = mix(d, rest, 1.0-exp(-uDt*1.4));
  o = vec4(d, 0.0, 0.0, 1.0);
}`;

const FS_DISP = `${HEAD}
uniform sampler2D uV, uD;
uniform vec2 uRes;
uniform float uDpr, uSdfRadius;
uniform vec3 uPaper, uSunk, uInk, uInkSoft, uInkMuted, uAccent, uBlue;
out vec4 o;

vec3 paperTex(vec2 frag){
  float g = hash(frag + 0.37) - 0.5;
  float fiber = vnoise(frag/(3.0*uDpr)) * 0.6 + vnoise(frag/(23.0*uDpr)) * 0.4;
  return uPaper * (1.0 + g*0.045 + (fiber-0.5)*0.05);
}
float blurD(vec2 uv, float rpx){
  vec2 r = rpx*uDpr/uRes;
  float s = texture(uD, uv).r*0.2;
  s += texture(uD, uv+r*vec2( 1.0, 0.0)).r*0.1; s += texture(uD, uv+r*vec2(-1.0, 0.0)).r*0.1;
  s += texture(uD, uv+r*vec2( 0.0, 1.0)).r*0.1; s += texture(uD, uv+r*vec2( 0.0,-1.0)).r*0.1;
  s += texture(uD, uv+r*vec2( 0.7, 0.7)).r*0.1; s += texture(uD, uv+r*vec2(-0.7, 0.7)).r*0.1;
  s += texture(uD, uv+r*vec2( 0.7,-0.7)).r*0.1; s += texture(uD, uv+r*vec2(-0.7,-0.7)).r*0.1;
  return s;
}

void main(){
  vec2 uv = vUv;
  vec2 frag = gl_FragCoord.xy;
  vec3 col;
#if STAGE == 0
  /* SDF: distance field, contour hairlines every 4 sdf px, edge in blueprint blue */
  vec2 q = sdfUV(uv);
  float s = texture(uSDF, q).r;
  float dist = (s-0.5)*2.0*uSdfRadius;       // sdf px, + inside
  float w = fwidth(dist);
  float iso = abs(fract(dist/4.0+0.5)-0.5)*4.0;
  float lines = (1.0 - smoothstep(0.0, w*1.1, iso)) * (1.0 - smoothstep(uSdfRadius-3.0, uSdfRadius-1.0, abs(dist)));
  float edge = 1.0 - smoothstep(0.0, w*1.4, abs(dist));
  col = mix(uPaper, uSunk, smoothstep(-1.0, 1.0, dist*0.5)*0.0);
  col = mix(col, uInk, step(0.0, dist)*0.07);
  col = mix(col, uBlue, lines*0.35);
  col = mix(col, uBlue, edge);
#elif STAGE == 1
  /* Warp: rest ink through the 2-octave noise offset; unwarped edge as hairline */
  float r = restInk(uv, uTime);
  vec2 q = sdfUV(uv);
  float s = texture(uSDF,q).r;
  float ref = 1.0 - smoothstep(0.0, fwidth(s)*1.5, abs(s-0.5));
  col = mix(uPaper, uInk, r);
  col = mix(col, uBlue, ref*0.55*(1.0-r*0.6));
#elif STAGE == 2
  /* Flow: ink density (soft) + velocity arrows every 0.05 canvas heights */
  float d = texture(uD, uv).r;
  col = mix(uPaper, uInk, d*0.28);
  vec2 P = vec2(uv.x*uAspect, uv.y);
  float step_ = 0.05;
  vec2 c = (floor(P/step_)+0.5)*step_;
  vec2 v = texture(uV, c/vec2(uAspect,1.0)).xy;
  float len = min(length(v)*0.035, step_*0.48);
  vec2 dir = length(v) > 1e-4 ? normalize(v) : vec2(0.0);
  vec2 a0 = c - dir*len, b0 = c + dir*len;
  vec2 pa = P-a0, ba = b0-a0;
  float h = clamp(dot(pa,ba)/max(dot(ba,ba),1e-8),0.0,1.0);
  float dd = length(pa-ba*h);
  float px = 1.0/(uRes.y/uDpr);
  float line = (1.0-smoothstep(0.6*px, 1.4*px, dd)) * step(1e-4, length(v));
  float dot_ = 1.0 - smoothstep(1.0*px, 2.2*px, length(P-c));
  float hot = clamp(length(v)*0.35, 0.0, 1.0);
  col = mix(col, mix(uBlue, uAccent, hot), max(line, dot_*0.6));
#else
  float d = texture(uD, uv).r;
  vec3 paper = paperTex(frag);
  #if LOOK == 0
  /* INK: soft bleed halo + tooth-thresholded body */
  float tooth = vnoise(frag/(1.6*uDpr))*0.6 + vnoise(frag/(5.0*uDpr))*0.4;
  float a = smoothstep(0.40, 0.60, d + (tooth-0.5)*0.30);
  float b = blurD(uv, 7.0);
  float halo = smoothstep(0.0, 0.75, b) * 0.20 * (0.55+0.45*tooth);
  col = mix(paper, uInk, halo);
  col = mix(col, uInk, a*0.97);
  #elif LOOK == 1
  /* REFRACT: the wordmark as a glass slab bending a ruled grid */
  vec2 e = 5.0*uDpr/uRes;
  vec2 q = sdfUV(uv);
  float s0 = texture(uSDF, q).r;
  // dome height from the SDF (0 at the edge, 1 at 24px deep), modulated by flowing density
  vec2 qe = e/ (vec2(uSdfAspect,1.0)*uFit) * vec2(uAspect,1.0);
  #define DOME(qq) pow(smoothstep(0.5, 0.98, texture(uSDF, qq).r), 0.8)
  float hx = DOME(q+vec2(qe.x,0.0)) - DOME(q-vec2(qe.x,0.0));
  float hy = DOME(q+vec2(0.0,qe.y)) - DOME(q-vec2(0.0,qe.y));
  vec2 n = vec2(hx, hy);
  // flowing ink adds a second, wider bump so a swipe visibly drags the glass
  vec2 e2 = 9.0*uDpr/uRes;
  vec2 gd = vec2(texture(uD, uv+vec2(e2.x,0.0)).r - texture(uD, uv-vec2(e2.x,0.0)).r,
                 texture(uD, uv+vec2(0.0,e2.y)).r - texture(uD, uv-vec2(0.0,e2.y)).r);
  n += gd*0.12;
  float inside = smoothstep(0.38, 0.62, d);
  vec2 vel = texture(uV, uv).xy;
  vec2 uvR = uv - (n*0.30 + vel*0.012) * vec2(1.0/uAspect, 1.0) * inside;
  vec2 P = vec2(uvR.x*uAspect, uvR.y) / 0.045;   // grid pitch: 0.045 canvas heights
  vec2 gp = abs(fract(P+0.5)-0.5);
  float px = fwidth(P.x)*1.0 + 1e-5;
  float g = 1.0 - smoothstep(0.0, px*1.2, min(gp.x, gp.y));
  vec2 gq = abs(fract(P*4.0+0.5)-0.5)/4.0;
  float gm = 1.0 - smoothstep(0.0, px*1.2, min(gq.x, gq.y));
  col = paper;
  col = mix(col, uInkMuted, g*0.38);
  col = mix(col, uInkMuted, gm*0.07);
  // slab body: tinted, darker toward the rim (glass thickness), lit edge
  float slope = clamp(length(n)*4.5, 0.0, 1.0);
  col = mix(col, uInk, inside*(0.05 + 0.34*slope));
  float rim = (1.0-smoothstep(0.0, 0.10, abs(d-0.5)));
  col = mix(col, uInk, rim*0.85);
  float spec = clamp(dot(n, vec2(-0.6,0.8))*22.0, 0.0, 1.0); spec *= spec;
  col = mix(col, uPaper*1.04, spec*inside*0.45);
  #else
  /* RISO: two-colour overprint, vermilion halftone halo misregistered by the flow */
  vec2 vel = texture(uV, uv).xy;
  vec2 off = (vec2(3.5,-2.5) + vel*5.0) * uDpr / uRes;
  float tooth = vnoise(frag/(1.4*uDpr))*0.6 + vnoise(frag/(6.0*uDpr))*0.4;
  float A = smoothstep(0.44, 0.56, d + (tooth-0.5)*0.22);
  float bb = blurD(uv - off, 11.0);
  float cov = smoothstep(0.02, 0.85, bb);
  // 45 degree halftone screen, 6 css px pitch
  float pitch = 6.0*uDpr;
  mat2 rot = mat2(0.7071, -0.7071, 0.7071, 0.7071);
  vec2 gq = rot*frag/pitch;
  vec2 cell = fract(gq)-0.5;
  float rad = sqrt(cov)*0.62;
  float dotA = 1.0 - smoothstep(rad-0.10, rad+0.10, length(cell));
  float B = dotA * step(0.02, cov);
  vec3 c = paper;
  c = mix(c, c*uAccent*1.08, B*0.92);
  c = mix(c, c*uInk*1.35, A*0.96);
  col = c;
  #endif
#endif
  o = vec4(col, 1.0);
}`;

const RT_LONG_VEL = 96;
const RT_LONG_DENS = 384;

interface Pair {
  tex: [WebGLTexture, WebGLTexture];
  fbo: [WebGLFramebuffer, WebGLFramebuffer];
  w: number;
  h: number;
  i: number;
}

export function createRaw({ canvas, sdf, theme, query }: RendererInit): Renderer {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('WebGL2 unavailable');
  const g = gl;
  const ext = g.getExtension('EXT_color_buffer_float') || g.getExtension('EXT_color_buffer_half_float');
  if (!ext) throw new Error('float render targets unavailable');
  const dbg = g.getExtension('WEBGL_debug_renderer_info');
  const gpuInfo = `webgl2 ${dbg ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER)}`;
  const loseExt = g.getExtension('WEBGL_lose_context');

  const vao = g.createVertexArray();
  let aspect = 1;
  let sdfTex: WebGLTexture | null = null;
  let vel: Pair | null = null;
  let dens: Pair | null = null;
  let resW = 2;
  let resH = 2;
  let dpr = 1;
  let fresh = true;

  const stageId = { sdf: 0, warp: 1, flow: 2, composite: 3 }[query.stage];
  const lookId = { ink: 0, refract: 1, riso: 2 }[query.look];

  function compile(type: number, src: string) {
    const s = g.createShader(type)!;
    g.shaderSource(s, src);
    g.compileShader(s);
    return s;
  }
  function program(fs: string, defines = '') {
    const withDefs = fs.replace('#version 300 es', `#version 300 es\n${defines}`);
    const vs = compile(g.VERTEX_SHADER, VS);
    const f = compile(g.FRAGMENT_SHADER, withDefs);
    const p = g.createProgram()!;
    g.attachShader(p, vs);
    g.attachShader(p, f);
    g.linkProgram(p);
    // checking status forces the (possibly lazy) compile to finish: that is what we want to time
    if (!g.getProgramParameter(p, g.LINK_STATUS)) {
      throw new Error(`GLSL: ${g.getShaderInfoLog(f)} ${g.getProgramInfoLog(p)}`);
    }
    g.deleteShader(vs);
    g.deleteShader(f);
    const u: Record<string, WebGLUniformLocation | null> = {};
    const n = g.getProgramParameter(p, g.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = g.getActiveUniform(p, i)!.name;
      u[name] = g.getUniformLocation(p, name);
    }
    return { p, u };
  }

  type Prog = ReturnType<typeof program>;
  let progVel: Prog | null = null;
  let progDens: Prog | null = null;
  let progDisp: Prog;

  function tex(w: number, h: number) {
    const t = g.createTexture()!;
    g.bindTexture(g.TEXTURE_2D, t);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA16F, w, h, 0, g.RGBA, g.HALF_FLOAT, null);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    return t;
  }
  function pair(w: number, h: number): Pair {
    const tx: WebGLTexture[] = [tex(w, h), tex(w, h)];
    const fb = tx.map((t) => {
      const f = g.createFramebuffer()!;
      g.bindFramebuffer(g.FRAMEBUFFER, f);
      g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, t, 0);
      return f;
    });
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    return { tex: tx as Pair['tex'], fbo: fb as Pair['fbo'], w, h, i: 0 };
  }
  function freePair(p: Pair | null) {
    if (!p) return;
    p.tex.forEach((t) => g.deleteTexture(t));
    p.fbo.forEach((f) => g.deleteFramebuffer(f));
  }

  const needsSim = stageId >= 2 || stageId === 3;

  function allocSim() {
    freePair(vel);
    freePair(dens);
    const long = (n: number) => (aspect >= 1 ? [n, Math.max(2, Math.round(n / aspect))] : [Math.max(2, Math.round(n * aspect)), n]);
    const [vw, vh] = long(RT_LONG_VEL);
    const [dw, dh] = long(RT_LONG_DENS);
    vel = pair(vw, vh);
    dens = pair(dw, dh);
  }

  function setCommon(P: Prog, s: FrameState, fit: number) {
    const u = P.u;
    g.uniform1i(u.uSDF, 0);
    g.uniform1f(u.uAspect, aspect);
    g.uniform1f(u.uSdfAspect, sdf.width / sdf.height);
    g.uniform1f(u.uFit, fit);
    g.uniform1f(u.uWarp, 0.012);
    g.uniform1f(u.uEdge, 0.04);
    g.uniform1f(u.uTime, s.time);
  }
  const col3 = (loc: WebGLUniformLocation | null, c: RGB) => g.uniform3f(loc, c[0], c[1], c[2]);
  const bindTex = (unit: number, t: WebGLTexture) => {
    g.activeTexture(g.TEXTURE0 + unit);
    g.bindTexture(g.TEXTURE_2D, t);
  };
  const draw = () => g.drawArrays(g.TRIANGLES, 0, 3);

  return {
    backend: 'webgl2 (raw)',
    gpuInfo,
    async init() {
      progDisp = program(
        FS_DISP,
        `#define STAGE ${stageId}\n#define LOOK ${lookId}`,
      );
      if (needsSim) {
        progVel = program(FS_VEL);
        progDens = program(FS_DENS);
      }
      sdfTex = g.createTexture()!;
      g.bindTexture(g.TEXTURE_2D, sdfTex);
      g.pixelStorei(g.UNPACK_ALIGNMENT, 1);
      g.texImage2D(g.TEXTURE_2D, 0, g.R16F, sdf.width, sdf.height, 0, g.RED, g.HALF_FLOAT, sdf.data);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
      g.bindVertexArray(vao);
      if (needsSim && !vel) allocSim();
    },
    resize(w, h, d) {
      dpr = d;
      if (w === resW && h === resH) return;
      resW = w;
      resH = h;
      canvas.width = w;
      canvas.height = h;
      aspect = w / h;
      if (needsSim && progVel) {
        allocSim();
        fresh = true;
      }
    },
    frame(s) {
      aspect = s.aspect;
      const fit = Math.min(aspect / (sdf.width / sdf.height), 1) * 0.98;
      g.bindVertexArray(vao);
      bindTex(0, sdfTex!);
      if (needsSim && vel && dens) {
        // freshly (re)allocated textures snap straight to the rest state
        const dt = fresh ? 100 : s.dt;
        fresh = false;
        // 1. velocity
        g.useProgram(progVel!.p);
        g.viewport(0, 0, vel.w, vel.h);
        g.bindFramebuffer(g.FRAMEBUFFER, vel.fbo[1 - vel.i]);
        setCommon(progVel!, s, fit);
        bindTex(1, vel.tex[vel.i]);
        g.uniform1i(progVel!.u.uV, 1);
        g.uniform1f(progVel!.u.uDt, Math.min(dt, 1 / 20));
        g.uniform2f(progVel!.u.uA, s.a[0], s.a[1]);
        g.uniform2f(progVel!.u.uB, s.b[0], s.b[1]);
        g.uniform2f(progVel!.u.uPVel, s.vel[0], s.vel[1]);
        g.uniform1f(progVel!.u.uActive, s.active);
        draw();
        vel.i = 1 - vel.i;
        // 2. density
        g.useProgram(progDens!.p);
        g.viewport(0, 0, dens.w, dens.h);
        g.bindFramebuffer(g.FRAMEBUFFER, dens.fbo[1 - dens.i]);
        setCommon(progDens!, s, fit);
        bindTex(1, vel.tex[vel.i]);
        bindTex(2, dens.tex[dens.i]);
        g.uniform1i(progDens!.u.uV, 1);
        g.uniform1i(progDens!.u.uD, 2);
        g.uniform1f(progDens!.u.uDt, dt);
        draw();
        dens.i = 1 - dens.i;
      }
      // 3. display
      g.bindFramebuffer(g.FRAMEBUFFER, null);
      g.viewport(0, 0, resW, resH);
      g.useProgram(progDisp.p);
      setCommon(progDisp, s, fit);
      const u = progDisp.u;
      g.uniform2f(u.uRes, resW, resH);
      g.uniform1f(u.uDpr, dpr);
      g.uniform1f(u.uSdfRadius, sdf.radius);
      col3(u.uPaper, theme.paper);
      col3(u.uSunk, theme.paperSunk);
      col3(u.uInk, theme.ink);
      col3(u.uInkSoft, theme.inkSoft);
      col3(u.uInkMuted, theme.inkMuted);
      col3(u.uAccent, theme.accent);
      col3(u.uBlue, theme.blue);
      if (vel && dens) {
        bindTex(1, vel.tex[vel.i]);
        bindTex(2, dens.tex[dens.i]);
        g.uniform1i(u.uV, 1);
        g.uniform1i(u.uD, 2);
      }
      draw();
    },
    gpuSync() {
      g.finish();
      return Promise.resolve();
    },
    dispose() {
      freePair(vel);
      freePair(dens);
      if (sdfTex) g.deleteTexture(sdfTex);
      for (const p of [progVel, progDens, progDisp]) if (p) g.deleteProgram(p.p);
      g.deleteVertexArray(vao);
      loseExt?.loseContext();
    },
  };
}
