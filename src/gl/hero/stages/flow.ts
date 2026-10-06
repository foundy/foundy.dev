/**
 * Stage 3: flow field. Two small ping-pong passes over the whole canvas:
 *
 *   velocity  RG16F-ish  pointer drags it (segment gaussian), semi-Lagrangian self-advection, exponential damping
 *   deviation R          how far the ink differs from its rest state (ink = rest + deviation), advected by the
 *                        velocity and relaxed back to 0
 *
 * Storing the *deviation* instead of the ink itself is what keeps the rest state crisp (the composite evaluates the
 * rest ink from the full-resolution SDF, the sim only adds to it) and lets the ink return to the wordmark smoothly:
 * deviation -> 0 means exactly the poster-aligned glyphs, with nothing to snap.
 *
 * Advecting ink D = rest + dev:  dev'(p) = dev(back) + rest(back) - rest(p), where back = p - v dt.
 */
export const VELOCITY_FS = `
uniform sampler2D uV;
uniform float uDt, uAspect, uActive, uRadius, uVMax;
uniform vec2 uA, uB, uPVel; // pointer segment (height units, y up) and its velocity
float segDist(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/max(dot(ba,ba),1e-6),0.0,1.0); return length(pa-ba*h); }
void main(){
  vec2 v = texture(uV, vUv).xy;
  vec2 back = vUv - v*uDt/vec2(uAspect,1.0);
  vec2 vn = texture(uV, back).xy * exp(-uDt*2.2);
  float d = segDist(vec2(vUv.x*uAspect, vUv.y), uA, uB);
  float g = exp(-d*d/(2.0*uRadius*uRadius)) * uActive;
  vn = mix(vn, clamp(uPVel, -uVMax, uVMax), g*(1.0-exp(-uDt*18.0)));
  o = vec4(vn, 0.0, 1.0);
}`;

export const DEVIATION_FS = `
uniform sampler2D uV, uD;
uniform float uDt, uAspect, uRelax, uSoft;
void main(){
  vec2 v = texture(uV, vUv).xy;
  vec2 back = vUv - v*uDt/vec2(uAspect,1.0);
  float prev = texture(uD, back).r;
  float rb = restInk(unitsAt(fragTL(back)), uSoft);
  float rh = restInk(unitsAt(fragTL(vUv)), uSoft);
  float dev = (prev + rb - rh) * exp(-uDt*uRelax);
  o = vec4(clamp(dev, -1.0, 1.0), 0.0, 0.0, 1.0);
}`;

/** ?stage=flow: ink density (soft) with velocity arrows on a 0.05-canvas-height grid */
export const FLOW_VIEW = `
vec3 stageFlow(vec2 uv){
  float r = restInk(unitsAt(fragTL(uv)), unitsPerPx()*0.75);
  float ink = clamp(r + texture(uD, uv).r, 0.0, 1.0);
  vec3 col = mix(uPaper, uInk, ink*0.28);
  vec2 P = vec2(uv.x*uAspect, uv.y);
  float step_ = 0.05;
  vec2 c = (floor(P/step_)+0.5)*step_;
  vec2 v = texture(uV, c/vec2(uAspect,1.0)).xy;
  float len = min(length(v)/uVMax*0.1, step_*0.48);
  vec2 dir = length(v) > 1e-4 ? normalize(v) : vec2(0.0);
  vec2 a0 = c - dir*len, b0 = c + dir*len;
  vec2 pa = P-a0, ba = b0-a0;
  float h = clamp(dot(pa,ba)/max(dot(ba,ba),1e-8),0.0,1.0);
  float dd = length(pa-ba*h);
  float px = uPx/uRes.y;
  float line = (1.0-smoothstep(0.6*px, 1.4*px, dd)) * step(1e-4, length(v));
  float dot_ = 1.0 - smoothstep(1.0*px, 2.2*px, length(P-c));
  float hot = clamp(length(v)/uVMax*1.1, 0.0, 1.0);
  return mix(col, mix(uBlue, uAccent, hot), max(line, dot_*0.6));
}
`;
