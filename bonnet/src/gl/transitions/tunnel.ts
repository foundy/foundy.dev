// "Frame Extrusion": the card frame extrudes toward the viewer into a thin tunnel; the camera dollies through it
// (photo plane scales slot -> hero, perspective of the inner walls grows) with a moving light on the walls.
// The photo is a flat, unwarped plane the whole time. Walls are solved per fragment from the rounded-rect SDF.
import { GLSL_COMMON } from '../gfx';
import { type Transition, lerp, range, smooth } from '../types';

const FS = `#version 300 es
precision highp float;
in vec2 vPx;
uniform vec4 uP; uniform vec3 uInk; uniform float uRad,uK,uLight,uStr,uAlpha; out vec4 o;
${GLSL_COMMON}
void main(){
  vec2 c=(uP.xy+uP.zw)*.5, hs=(uP.zw-uP.xy)*.5, q=vPx-c;
  float sd0=sdRR(q,hs,uRad);
  if(sd0<=0.||sdRR(q/uK,hs,uRad)>0.){ o=vec4(0.); return; }
  float lo=1., hi=uK;
  for(int i=0;i<9;i++){ float m=.5*(lo+hi); if(sdRR(q/m,hs,uRad)>0.) lo=m; else hi=m; }
  float t=.5*(lo+hi);
  float u=(1.-1./t)/(1.-1./uK);
  vec2 qs=q/t;
  vec2 gr=normalize(vec2(sdRR(qs+vec2(1.,0.),hs,uRad)-sdRR(qs-vec2(1.,0.),hs,uRad),sdRR(qs+vec2(0.,1.),hs,uRad)-sdRR(qs-vec2(0.,1.),hs,uRad))+1e-6);
  vec3 N=vec3(-gr,0.);
  vec3 L=normalize(vec3(-.45,-.65,.6));
  float lam=.5+.5*dot(N,L);
  float amb=mix(.45,1.,pow(u,.55));
  vec3 base=uInk*.6*mix(.55,1.1,lam)*amb;
  float streak=exp(-pow((u-uLight)/.11,2.))*uStr*(.3+.7*lam);
  float lip=exp(-pow(sd0/1.6,2.));
  vec3 rgb=base+vec3(streak)+vec3(lip*.8);
  float ea=smoothstep(0.,.05,(uK-t)/(uK-1.));
  float a=uAlpha*ea;
  o=vec4(rgb*a,a);
}`;

export const tunnel: Transition = {
  id: 'tunnel',
  open: { k: 320, c: 34 }, // ~600 ms
  close: { k: 520, c: 43 }, // ~470 ms
  draw(g, e) {
    const { p, slot: S, hero: H } = e;
    const pe = e.press * (1 - smooth(p, 0, 0.1));
    const rec = smooth(p, 0.1, 0.6);
    g.bg(e.tone);
    g.backs(e, { z: -80 * rec, s: 0.03 * rec, dim: 0.3 * rec, bias: 1.5 * rec, alpha: 1 - smooth(p, 0.4, 0.8) }, e.wob);

    const x = range(p, 0.25, 0.86);
    const rt = x * x * (3 - 2 * x);
    const cx = lerp(S.x + S.w / 2, H.x + H.w / 2, rt), cy = lerp(S.y + S.h / 2, H.y + H.h / 2, rt);
    const w = lerp(S.w, H.w, rt), h = lerp(S.h, H.h, rt);
    const rad = lerp(28, 0, rt);

    const alpha = smooth(p, 0.06, 0.2) * (1 - smooth(p, 0.78, 0.97));
    if (alpha > 0.002) {
      const K = 1.02 + 1.4 * smooth(p, 0.08, 0.4) + 7 * Math.pow(smooth(p, 0.3, 0.9), 2);
      const pr = g.use(g.rectProg('tunnel', FS));
      pr.f('uP', cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2).f('uRad', rad).f('uK', K).f('uLight', lerp(-0.2, 1.3, range(p, 0.1, 0.85)));
      pr.f('uStr', 0.55).f('uAlpha', alpha).f('uInk', e.ink[0] / 255, e.ink[1] / 255, e.ink[2] / 255);
      g.blend('pre');
      g.full();
    } else {
      g.shadow({ x: cx - w / 2, y: cy - h / 2, w, h }, rad, lerp(16, 9, pe), 0.2, lerp(12, 5, pe));
    }
    g.card({ ...g.cardTex(e), cx, cy, cz: -6 * pe + e.wob, w, h, radius: rad, spec: p < 0.002 ? [0.15, 0.17, 0.045, 0.5] : [0, 1, 0, 0] });
  },
};
