// "Liquid Lift + Ink Flood": the card lifts toward the hero, its outer ring bends (never the centre 55%),
// a raking highlight crosses the bend, and an fbm ink front floods the page from the card edge.
import { GLSL_COMMON } from '../gfx';
import { type Transition, lerp, range, smooth } from '../types';

const INK_FS = `#version 300 es
precision highp float;
in vec2 vPx; uniform vec4 uBox; uniform vec3 uInk,uTone,uSeam; uniform float uRad,uFront,uAmp,uSettle; out vec4 o;
${GLSL_COMMON}
float hs1(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float vn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hs1(i),hs1(i+vec2(1.,0.)),f.x),mix(hs1(i+vec2(0.,1.)),hs1(i+vec2(1.)),f.x),f.y); }
float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<4;i++){ s+=a*vn(p); p=p*2.03+vec2(7.1,3.7); a*=.5; } return s; }
void main(){
  vec2 c=(uBox.xy+uBox.zw)*.5, hs=(uBox.zw-uBox.xy)*.5;
  float d=sdRR(vPx-c,hs,uRad);
  float n=fbm(vPx*.012);
  float field=d+(n-.47)*uAmp;
  float m=clamp((uFront-field)/1.6+.5,0.,1.);
  float sm=exp(-pow((uFront-field-1.2)/1.6,2.));
  vec3 col=mix(uInk*(.93+.14*n),uTone,uSettle);
  col=mix(col,uSeam,sm*(1.-uSettle));
  o=vec4(col*m,m);
}`;
const COMP_FS = `#version 300 es
precision highp float;
in vec2 vPx; uniform sampler2D uTex; uniform vec2 uRes; out vec4 o;
void main(){ o=texture(uTex,vec2(vPx.x/uRes.x,1.-vPx.y/uRes.y)); }`;

export const lift: Transition = {
  id: 'lift',
  open: { k: 320, c: 34 }, // ~600 ms
  close: { k: 640, c: 48 }, // ~420 ms
  wobble: true,
  draw(g, e) {
    const { p, slot: s, hero: h } = e;
    const pe = e.press * (1 - smooth(p, 0, 0.12));
    const x = range(p, 0, 0.8);
    const rt = x * (2 - x);
    const rec = smooth(p, 0.05, 0.65);

    g.bg(e.tone);
    g.backs(e, { z: -20 * rec, s: 0.04 * rec, dim: 0.24 * rec, bias: 1.5 * rec }, e.wob);

    // ink flood (half-res), only while it is not yet the plain page tone
    const settle = smooth(p, 0.58, 0.92);
    const R = e.W > 0 ? Math.hypot(e.W, e.H) * 1.05 + 160 : 0;
    const front = R * Math.pow(range(p, 0.03, 0.72), 0.85) * (p > 0.002 ? 1 : 0) - 10;
    if (settle < 0.999 && front > -8) {
      const t = g.targetFor(0.5);
      g.bindTarget(t);
      g.gl.clearColor(0, 0, 0, 0);
      g.gl.clear(g.gl.COLOR_BUFFER_BIT);
      g.blend('pre');
      const cx = lerp(s.x + s.w / 2, h.x + h.w / 2, rt), cy = lerp(s.y + s.h / 2, h.y + h.h / 2, rt);
      const w = lerp(s.w, h.w, rt), hh = lerp(s.h, h.h, rt);
      const pr = g.use(g.rectProg('ink', INK_FS));
      const ink = e.ink.map((v) => v / 255) as [number, number, number];
      const tone = e.tone.map((v) => v / 255) as [number, number, number];
      const seam = ink.map((v) => Math.min(1, v * 0.5 + 0.62)) as [number, number, number];
      pr.f('uBox', cx - w / 2, cy - hh / 2, cx + w / 2, cy + hh / 2).f('uRad', lerp(28, 0, rt)).f('uFront', front).f('uAmp', 150);
      pr.f('uSettle', settle).f('uInk', ...ink).f('uTone', ...tone).f('uSeam', ...seam);
      g.full();
      g.bindTarget(null);
      g.gl.activeTexture(g.gl.TEXTURE0);
      g.gl.bindTexture(g.gl.TEXTURE_2D, t.tex);
      g.use(g.rectProg('inkc', COMP_FS)).i('uTex', 0);
      g.blend('pre');
      g.full();
    }

    // the card
    const cx = lerp(s.x + s.w / 2, h.x + h.w / 2, rt) + (e.deck.dx || 0) * (1 - rt);
    const cy = lerp(s.y + s.h / 2, h.y + h.h / 2, rt);
    const w = lerp(s.w, h.w, rt), hh = lerp(s.h, h.h, rt);
    const fold = e.open ? 0 : (1 - smooth(p, 0.7, 0.97)) * smooth(p, 0.1, 0.55) * 1.1;
    const flutter = 0.025 * w * Math.sin(2.5 * Math.PI * p) * Math.exp(-3 * p) * (1 - smooth(p, 0.85, 1));
    g.shadow({ x: cx - w / 2, y: cy - hh / 2, w, h: hh }, lerp(28, 0, rt), lerp(18, 9, pe), 0.22 * (1 - smooth(p, 0.8, 1)), lerp(14, 5, pe));
    g.card({
      ...g.cardTex(e),
      cx,
      cy,
      cz: -10 * pe + e.wob,
      w,
      h: hh,
      rx: (7 * Math.PI) / 180 * Math.sin(Math.PI * p),
      radius: lerp(28, 0, rt),
      bend: [0.16 * w * Math.sin(Math.PI * p), flutter, fold],
      rake: smooth(p, 0.15, 0.4) * (1 - smooth(p, 0.4, 0.67)),
      spec: p < 0.002 ? [0.15, 0.17, 0.045, 0.5] : [0.15 + 0.6 * p, 0.17, 0.045 * (1 - smooth(p, 0.5, 1)), 0.5],
    });
  },
};
