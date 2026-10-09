// The world-switch compositor. Both worlds render into offscreen RenderTargets (A = first world of the kind, B = second)
// and this full-screen pass builds the signature transition from them, as a pure function of the progress `u` (0..1):
//
//   l2w (Light -> Water), u:
//     0.00-0.30  the beam bends downward: the wall picture is pulled down along the shaft to the pool, shrinks into a hot spot
//     0.30       impact: the app injects a ring burst into the water sim (World.impulse); a disc of water opens at the impact
//                and a refracting shock ring runs outward; caustics flare around the hot spot
//     0.34-0.97  the room floods: a water line (meniscus, refraction, wobble) rises over the screen revealing the Water world
//   w2l (Water -> Light), u:
//     0.00-0.30  the sea calms (World.calm); its glints gather into a column at the product that rises toward the wall
//     0.30-0.88  the water drains: a falling meniscus (uneven, with drips) reveals the dark room; the column fades as the
//                projector beam (the Light world's own) takes over; the Light world's welcome (shutter + focus pull) is
//                timed to land while the wall is revealed
//   fade: the plain crossfade (fallback if the transition shader cannot be built)
// At u = 0 the output is exactly A and at u = 1 exactly B (no pop). Reversing a switch plays the same picture backwards.
import { FULLSCREEN_VS, RenderTarget, type GL, type Prog, type Target } from './context';
import type { Anchor } from '../worlds/types';

export const KIND_L2W = 0, KIND_W2L = 1, KIND_FADE = 2;
/** u at which the l2w impact happens (the app injects the water burst when u crosses it going forward) */
export const IMPACT_U = 0.3;
/** w2l: the Light welcome (shutter + focus pull) starts this long after the switch begins (ms) */
export const LIGHT_WELCOME_DELAY_MS = 330;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uA, uB;
uniform vec2 uRes;
uniform float uAsp, uU, uTime, uMix;
uniform int uK;
uniform vec2 uP, uWall, uLens;
out vec4 o;

const float PI = 3.14159265;
const float IMPACT = ${IMPACT_U.toFixed(3)};
float sm(float a, float b, float x){ return smoothstep(a, b, x); }
float hash(float n){ return fract(sin(n * 127.1) * 43758.5453); }
float vnoise(float x){ float i = floor(x), f = fract(x); f = f * f * (3. - 2. * f); return mix(hash(i), hash(i + 1.), f); }
vec3 tx(sampler2D s, vec2 uv){
  vec2 c = clamp(uv, vec2(.001), vec2(.999));
  vec3 col = texture(s, c).rgb;
  // outside the frame there is only darkness (no smeared edge pixels)
  vec2 e = step(vec2(0.), uv) * step(uv, vec2(1.));
  return col * e.x * e.y;
}
// cheap caustic net
float caus(vec2 p, float t){
  vec2 q = p;
  float c = 0.;
  for (int i = 0; i < 3; i++) {
    q += vec2(sin(q.y * 1.7 + t * (1. + float(i) * .4)), cos(q.x * 1.5 - t * (.8 + float(i) * .3))) * .55;
    c += pow(abs(sin(q.x * 2.1) * sin(q.y * 2.3)), 5.);
  }
  return c;
}
float luma(vec3 c){ return dot(c, vec3(.299, .587, .114)); }

vec3 l2w(vec2 uv){
  float u = uU;
  vec2 pc = (uv - uP) * vec2(uAsp, 1.);
  float d = length(pc);
  float lineAmp = sin(PI * sm(.34, .97, u));

  // ---- A: the Light world, its beam bent down into the pool ----------------------------------
  float bend = sm(0., .30, u);
  float dy = uWall.y - uP.y;
  float k = sm(uLens.y, uWall.y, uv.y);
  vec2 ua = uv + vec2(0., dy * bend * k);
  // the shaft sags a little sideways as it bends (a slow S)
  ua.x += sin((uv.y - uLens.y) * 6.) * .012 * bend * (1. - sm(.3, .45, u));
  float suck = sm(.16, .44, u);
  ua = uP + (ua - uP) * (1. + 2.8 * suck * suck);
  vec3 a = tx(uA, ua);
  a *= 1. + .35 * bend * (1. - suck);
  float hot = exp(-d * d * mix(26., 140., suck)) * sm(.06, .26, u) * (1. - sm(.30, .44, u));
  a += vec3(1., .86, .62) * hot * 1.1;
  a *= 1. - .85 * sm(.34, .66, u);

  // ---- B: the Water world, revealed by a growing disc and a rising water line ---------------
  float fl = sm(.34, .97, u);
  float wave = (.012 * sin(uv.x * 17. + uTime * 6.) + .007 * sin(uv.x * 43. - uTime * 9.3) + .02 * sin(uv.x * 5.3 + 1.3)) * lineAmp;
  float lineY = mix(-.06, 1.1, fl) + wave;
  float flood = 1. - sm(lineY - .004, lineY + .004, uv.y);
  float r = max(0., u - IMPACT) * 2.1;
  float disc = r > 0. ? 1. - sm(r - .012, r + .012, d) : 0.;
  float m = max(flood, disc);

  vec2 ub = uv;
  // refraction beneath the water line
  float below = max(lineY - uv.y, 0.);
  float band = exp(-pow(below / .06, 2.)) * lineAmp * step(uv.y, lineY);
  ub += vec2(sin(uv.y * 70. + uTime * 9.) * .0075, -.013 * sin(uv.x * 30. - uTime * 7.)) * band;
  // the shock ring pushes the picture outward as it passes
  float shock = r > 0. ? exp(-pow((d - r) / .045, 2.)) * (1. - sm(IMPACT, .78, u)) : 0.;
  vec2 dirv = d > 1e-4 ? pc / d : vec2(0.);
  ub += dirv * vec2(1. / uAsp, 1.) * .028 * shock;
  float zoom = 1. + .045 * (1. - sm(IMPACT, .97, u));
  ub = .5 + (ub - .5) / zoom;
  vec3 b = tx(uB, ub);

  // impact flare and caustics inside the water
  float flash = u > IMPACT ? pow(1. - sm(IMPACT, .68, u), 2.) : 0.;
  float cf = caus(pc * 5.5, uTime * 2.2);
  b += vec3(.5, .8, .95) * cf * exp(-d * 2.6) * flash * 1.1;
  b += vec3(1., .88, .66) * exp(-d * d * 55.) * flash * 1.9;
  // the shock ring itself, and the wet edge of the water line
  float ringHi = r > 0. ? exp(-pow((d - r) / .011, 2.)) * (1. - sm(IMPACT, .8, u)) : 0.;
  float lineHi = sm(0., .06, fl) * (1. - sm(.94, 1., fl));
  float mensc = exp(-pow((uv.y - lineY) / .0065, 2.)) * lineHi;
  float glowW = exp(-below / .05) * step(uv.y, lineY) * lineHi;
  vec3 col = mix(a, b, m);
  col += vec3(.75, .93, 1.) * (ringHi * .45 + mensc * .45);
  col += vec3(.05, .12, .15) * glowW;
  // the air just above the line is wet and darker
  col *= 1. - .35 * exp(-max(uv.y - lineY, 0.) / .05) * step(lineY, uv.y) * (1. - m) * lineHi;
  return col;
}

vec3 w2l(vec2 uv){
  float u = uU;
  float gather = sm(.04, .40, u);
  float dr = sm(.30, .88, u);
  float lineAmp = sin(PI * dr);

  // ---- the draining water line: falls from above the screen to below it, uneven, with drips -------
  float drip = pow(vnoise(uv.x * 14. + 3.), 3.) * .045 + pow(vnoise(uv.x * 6. - 5.), 2.) * .03;
  float wave = (.012 * sin(uv.x * 15. - uTime * 5.) + .006 * sin(uv.x * 38. + uTime * 8.7) + .025 * sin(uv.x * 4.1 + .4)) * lineAmp;
  float lineY = mix(1.08, -.07, dr) + wave - drip * lineAmp;
  float below = 1. - sm(lineY - .004, lineY + .004, uv.y); // 1 = still under water

  // ---- A: the (calm) water, its glints gathering into a column --------------------------------
  float band = exp(-pow(max(lineY - uv.y, 0.) / .05, 2.)) * lineAmp * step(uv.y, lineY);
  vec2 ua = uv + vec2(sin(uv.y * 64. + uTime * 8.) * .007, -.012 * sin(uv.x * 28. + uTime * 6.)) * band;
  vec3 a = tx(uA, ua);
  float glint = sm(.5, .95, luma(a));
  float colx = (uv.x - uP.x) * uAsp;
  float cw = mix(.2, .04, gather);
  float colM = exp(-pow(colx / cw, 2.));
  float top = mix(uP.y, uWall.y + .03, sm(.10, .56, u));
  float bot = mix(uP.y - .02, uLens.y, sm(.34, .74, u));
  float vm = sm(bot - .03, bot + .04, uv.y) * (1. - sm(top - .05, top, uv.y));
  float g = gather * (1. - sm(.60, .92, u));
  float shimmer = .82 + .18 * sin(uv.y * 34. - uTime * 11.) * sin(colx * 90. + uTime * 3.);
  vec3 colCol = mix(vec3(.7, .9, 1.), vec3(1., .9, .72), sm(uP.y, uWall.y, uv.y)); // cool at the surface, warm toward the wall
  // everything but the glints dims; the glints near the column are lifted
  a *= mix(1., .38, gather);
  a += a * glint * gather * colM * 1.2;
  a += colCol * colM * vm * g * shimmer * .7;
  a += colCol * exp(-pow(colx / (cw * 2.6), 2.)) * vm * g * .12;

  // ---- B: the Light world, behind the water line ----------------------------------------------
  vec2 ub = uv + vec2(sin(uv.y * 50. - uTime * 7.) * .004, 0.) * exp(-pow(max(uv.y - lineY, 0.) / .05, 2.)) * lineAmp * step(lineY, uv.y);
  vec3 b = tx(uB, ub);
  float lineHi = sm(0., .06, dr) * (1. - sm(.94, 1., dr));
  float mensc = exp(-pow((uv.y - lineY) / .0065, 2.)) * lineHi;
  float glowW = exp(-max(lineY - uv.y, 0.) / .05) * step(uv.y, lineY) * lineHi;
  vec3 col = mix(b, a, below);
  col += vec3(.75, .93, 1.) * mensc * .45;
  col += vec3(.05, .12, .15) * glowW;
  col *= 1. - .3 * exp(-max(uv.y - lineY, 0.) / .045) * step(lineY, uv.y) * lineHi;
  return col;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 c;
  if (uK == 0) c = l2w(uv);
  else if (uK == 1) c = w2l(uv);
  else {
    vec2 q = uv - .5;
    c = mix(tx(uA, .5 + q / (1. + .035 * uMix)), tx(uB, .5 + q / (1.035 - .035 * uMix)), uMix);
  }
  o = vec4(c, 1.);
}`;

export class Compositor {
  private pr: Prog | null = null;
  private a: RenderTarget | null = null;
  private b: RenderTarget | null = null;
  private idle = 0;
  /** true when the transition shader could not be built: the app uses the plain crossfade kind */
  failed = false;
  private scaleA = 1;
  constructor(private g: GL) {
    try {
      this.pr = g.program(FULLSCREEN_VS, FS);
    } catch (e) {
      console.warn('switch shader failed, crossfade only', e);
      this.failed = true;
    }
  }
  /** targets for the first (a) and second (b) world of the kind; `a` can be rendered smaller (the outgoing layer, scaleA) */
  targets(scaleA = 1): [Target, Target] {
    const s = this.g.screen();
    const aw = Math.max(2, Math.round(s.w * scaleA)), ah = Math.max(2, Math.round(s.h * scaleA));
    if (this.a && (this.a.target.w !== aw || this.a.target.h !== ah || this.b!.target.w !== s.w || this.scaleA !== scaleA)) this.free();
    if (!this.a) {
      this.a = new RenderTarget(this.g.gl, aw, ah);
      this.b = new RenderTarget(this.g.gl, s.w, s.h);
      this.scaleA = scaleA;
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
  /**
   * kind: KIND_*, u: progress, mix: crossfade amount (fade kind only).
   * Anchors in css px (y down): `water` = product under the surface, `wall` = beam footprint (+ lens).
   */
  draw(kind: number, u: number, mix: number, o: { water: Anchor; wall: Anchor; W: number; H: number; time: number }, screen: Target) {
    const gl = this.g.gl;
    if (!this.a || !this.b || !this.pr) return;
    this.g.reset();
    this.g.bind(screen);
    gl.useProgram(this.pr.p);
    const U = this.pr.u;
    const uvx = (x: number) => x / o.W, uvy = (y: number) => 1 - y / o.H;
    gl.uniform2f(U.uRes, screen.w, screen.h);
    gl.uniform1f(U.uAsp, o.W / o.H);
    gl.uniform1f(U.uU, u);
    gl.uniform1f(U.uTime, o.time);
    gl.uniform1f(U.uMix, mix);
    gl.uniform1i(U.uK, kind);
    gl.uniform2f(U.uP, uvx(o.water.x), uvy(o.water.y));
    gl.uniform2f(U.uWall, uvx(o.wall.x), uvy(o.wall.y));
    const lens = o.wall.lens ?? { x: o.W / 2, y: o.H * 0.7 };
    gl.uniform2f(U.uLens, uvx(lens.x), uvy(lens.y));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.a.tex);
    gl.uniform1i(U.uA, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.b.tex);
    gl.uniform1i(U.uB, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }
}
