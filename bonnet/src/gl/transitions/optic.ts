// "Asymmetric optical boundary": the rounded-card silhouette (an SDF) grows toward the hero with each of its four
// edges on its own schedule (edges far from the tap lead, the edge nearest the tap lags). Only a thin lip just inside
// the boundary refracts the photo (8-20 css px, along the SDF gradient), with a short chromatic split; a light
// condenses on the border nearest the tap. The photo interior is never warped.
import { GLSL_COMMON } from '../gfx';
import { type Transition, lerp, range, smooth } from '../types';

const FS = `#version 300 es
precision highp float;
in vec2 vPx;
uniform sampler2D uT0,uT1;
uniform vec4 uM,uR0,uR1;
uniform vec3 uD0,uE0,uD1,uE1;
uniform vec2 uTap;
uniform float uMix,uRad,uBand,uRef,uCA,uRim,uDpr;
out vec4 o;
${GLSL_COMMON}
vec3 col(vec2 uv){
  vec3 c=face(uT0,uR0,uD0,uE0,uv,0.);
  return uMix>.001?mix(c,face(uT1,uR1,uD1,uE1,uv,0.),uMix):c;
}
void main(){
  vec2 c=(uM.xy+uM.zw)*.5, hs=(uM.zw-uM.xy)*.5, q=vPx-c, sz=uM.zw-uM.xy;
  float sd=sdRR(q,hs,uRad);
  vec2 g=normalize(vec2(sdRR(q+vec2(1.,0.),hs,uRad)-sdRR(q-vec2(1.,0.),hs,uRad),sdRR(q+vec2(0.,1.),hs,uRad)-sdRR(q-vec2(0.,1.),hs,uRad))+1e-6);
  float inner=-sd;
  float prof=pow(clamp(1.-inner/uBand,0.,1.),2.)*step(0.,inner);
  vec2 off=-g*uRef*prof, ca=g*uCA*prof;
  vec3 k;
  k.r=col((vPx+off+ca-uM.xy)/sz).r;
  k.g=col((vPx+off-uM.xy)/sz).g;
  k.b=col((vPx+off-ca-uM.xy)/sz).b;
  float a=clamp(.5-sd*uDpr,0.,1.);
  vec2 tc=uTap-c; float tl=length(tc);
  float ang=tl>1.?max(dot(g,tc/tl),0.):.5;
  float w=mix(.3,1.,ang*ang);
  float rim=exp(-pow(inner/1.5,2.))*step(-1.,inner)*uRim*w;
  float halo=exp(-max(sd,0.)/6.)*uRim*.35*w*(1.-a);
  vec3 rgb=k*a+vec3(rim*.85)*a+vec3(halo);
  o=vec4(rgb,a+halo);
}`;

const outBack = (t: number) => {
  const x = Math.min(1, Math.max(0, t)) - 1;
  return 1 + 2.2 * x * x * x + 1.2 * x * x;
};

export const optic: Transition = {
  id: 'optic',
  open: { k: 380, c: 37 }, // ~560 ms
  close: { k: 780, c: 53 }, // ~380 ms: stiffer, boundary-first "retrieve"
  draw(g, e) {
    const { p, slot: S, hero: H, open } = e;
    const pe = e.press * (1 - smooth(p, 0, 0.1));
    const rec = open ? smooth(p, 0.12, 0.5) : smooth(p, 0.02, 0.4);
    g.bg(e.tone);
    g.backs(e, { z: -60 * rec, s: 0.03 * rec, dim: 0.2 * rec, bias: 1.2 * rec, alpha: 1 - smooth(p, 0.35, 0.7) }, e.wob);

    // asymmetric edge schedule
    const sc: [number, number] = [S.x + S.w / 2, S.y + S.h / 2];
    let dx = e.tap[0] - sc[0], dy = e.tap[1] - sc[1];
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;
    const sgn = open ? 1 : -1; // open: edge nearest the tap lags; close: it leads
    const edge = (n: [number, number], a: number, b: number) => {
      const lag = 0.11 * (0.5 + 0.5 * sgn * (n[0] * dx + n[1] * dy));
      const t = range(p, lag + 0.06, 0.8);
      const k = open ? outBack(t) : t * t * (3 - 2 * t);
      return lerp(a, b, k);
    };
    const infl = 3 * pe;
    const x0 = edge([-1, 0], S.x, H.x) - infl, x1 = edge([1, 0], S.x + S.w, H.x + H.w) + infl;
    const y0 = edge([0, -1], S.y, H.y) - infl, y1 = edge([0, 1], S.y + S.h, H.y + H.h) + infl;
    const kr = smooth(p, 0.1, 0.78);
    const rad = lerp(28, 0, kr);

    g.shadow({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, rad, lerp(16, 9, pe), 0.2 * (1 - smooth(p, 0.8, 1)), lerp(12, 5, pe));

    const bump = open ? smooth(p, 0.08, 0.2) * (1 - smooth(p, 0.4, 0.55)) : smooth(p, 0.95, 0.7) * (1 - smooth(p, 0.45, 0.2));
    const ca = 1.6 * smooth(p, 0.18, 0.24) * (1 - smooth(p, 0.3, 0.36));
    const rim = open ? Math.max(pe * 0.9, smooth(p, 0.03, 0.12) * (1 - smooth(p, 0.5, 0.8)) * 0.8) : smooth(p, 0.97, 0.86) * (1 - smooth(p, 0.35, 0.6)) * 0.9;

    const pr = g.use(g.rectProg('optic', FS));
    const t = g.cardTex(e);
    const t0 = t.tex, t1 = t.tex2 ?? t0;
    const gl = g.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, g.texOrBlank(t0));
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, g.texOrBlank(t1));
    const a = t0 ?? g.blankTex, b = t1 ?? g.blankTex;
    pr.i('uT0', 0).i('uT1', 1).f('uM', x0, y0, x1, y1).f('uR0', ...a.rect).f('uR1', ...b.rect).f('uD0', ...a.dom).f('uE0', ...a.dom2).f('uD1', ...b.dom).f('uE1', ...b.dom2);
    pr.f('uTap', e.tap[0], e.tap[1]).f('uMix', t.mix ?? 0).f('uRad', rad).f('uBand', lerp(8, 20, bump)).f('uRef', 6 * bump).f('uCA', ca).f('uRim', rim);
    g.blend('pre');
    const m = 44;
    g.rect(x0 - m, y0 - m, x1 + m, y1 + m);
  },
};
