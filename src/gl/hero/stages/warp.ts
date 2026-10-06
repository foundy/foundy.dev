/**
 * Stage 2: domain warp. The SDF lookup is displaced by a 2-octave value-noise field, so the rest edge breathes
 * slightly, like ink settling into paper. Amplitude is small on purpose: at rest the GL wordmark must stay on
 * top of the poster's.
 */
export const WARP_GLSL = `
uniform float uWarp; // peak-to-peak displacement, box units
float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
}
float fbm2(vec2 p){ return vnoise(p)*0.65 + vnoise(p*2.03+17.1)*0.35; }
vec2 warpOffset(vec2 unit){
  vec2 p = unit / uBoxUnits * vec2(9.0, 3.0);
  return (vec2(fbm2(p + vec2(0.0, uTime*0.05)), fbm2(p + vec2(31.7, -uTime*0.04))) - 0.5) * uWarp;
}
float warpedDist(vec2 unit){ return sdfDist(unit + warpOffset(unit)); }
/* the resting ink: coverage 0..1 with an anti-aliasing half-width of aa box units */
float restInk(vec2 unit, float aa){ return smoothstep(-aa, aa, warpedDist(unit)); }
`;

/** ?stage=warp: warped rest ink, with the un-warped edge as a blueprint hairline */
export const WARP_VIEW = `
vec3 stageWarp(vec2 uv){
  vec2 unit = unitsAt(fragTL(uv));
  float r = restInk(unit, unitsPerPx()*0.75);
  float s = sdfDist(unit);
  float ref = 1.0 - smoothstep(0.0, max(fwidth(s), 1e-3)*1.5, abs(s));
  vec3 col = mix(uPaper, uInk, r);
  return mix(col, uBlue, ref*0.55*(1.0-r*0.6));
}
`;
