/**
 * Stage 4: composite. Ink on paper, drawn with transparency so the page's own paper and grain show through and the
 * canvas can sit on top of the SVG poster.
 *
 *   coverage = rest ink (crisp, from the full-resolution SDF) + deviation (from the flow sim)
 *   at rest        : plain anti-aliased edge, grain only nibbles the 1-2 px edge band
 *   while disturbed: coverage is re-thresholded with paper tooth, so moving ink gets that bled, pitted edge
 *   halo           : a soft bleed around the glyphs from the SDF, plus a blurred sample of the deviation
 *
 * `sharp` blends the two edge treatments by |deviation|, so the transition is continuous and nothing pops.
 */
export const COMPOSITE_GLSL = `
uniform float uBleed;
float blurPos(vec2 uv, float rpx){
  vec2 r = rpx*uPx/uRes;
  float s = max(texture(uD, uv).r,0.0)*0.2;
  s += max(texture(uD, uv+r*vec2( 1.0, 0.0)).r,0.0)*0.1; s += max(texture(uD, uv+r*vec2(-1.0, 0.0)).r,0.0)*0.1;
  s += max(texture(uD, uv+r*vec2( 0.0, 1.0)).r,0.0)*0.1; s += max(texture(uD, uv+r*vec2( 0.0,-1.0)).r,0.0)*0.1;
  s += max(texture(uD, uv+r*vec2( 0.7, 0.7)).r,0.0)*0.1; s += max(texture(uD, uv+r*vec2(-0.7, 0.7)).r,0.0)*0.1;
  s += max(texture(uD, uv+r*vec2( 0.7,-0.7)).r,0.0)*0.1; s += max(texture(uD, uv+r*vec2(-0.7,-0.7)).r,0.0)*0.1;
  return s;
}
/* returns premultiplied ink: rgb = ink colour * alpha, a = alpha */
vec4 compositeInk(vec2 uv){
  vec2 tl = fragTL(uv);
  vec2 unit = unitsAt(tl);
  float d = warpedDist(unit);
  float aa = unitsPerPx()*0.75;
  float rest = smoothstep(-aa, aa, d);
  float dev = texture(uD, uv).r;
  float cov = clamp(rest + dev, 0.0, 1.0);

  float tooth = vnoise(tl/(1.6*uPx))*0.6 + vnoise(tl/(5.0*uPx))*0.4;
  float edgeBand = 1.0 - abs(2.0*cov - 1.0);
  float calm = clamp(cov + (tooth-0.5)*0.32*edgeBand, 0.0, 1.0);
  float bled = smoothstep(0.38, 0.62, cov + (tooth-0.5)*0.30);
  float sharp = clamp(abs(dev)*6.0, 0.0, 1.0);
  float body = mix(calm, bled, sharp);

  float haloRest = uBleed * pow(smoothstep(-11.0, 1.0, d), 1.4);
  float haloDev = uBleed * smoothstep(0.0, 0.75, blurPos(uv, 7.0)) * (0.55 + 0.45*tooth);
  float halo = clamp(haloRest + haloDev, 0.0, 0.5);
  float a = body + (1.0-body)*halo;
  return vec4(uInk*a, a);
}
`;
