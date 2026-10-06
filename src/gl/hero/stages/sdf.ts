/**
 * Stage 1: SDF. The wordmark as a signed distance field baked at build time (scripts/bake-sdf.mjs).
 * Layout is driven by the poster's box: `uBox` is the poster rect in canvas pixels (top-left origin), and the
 * SDF texture covers that box plus `uPad` units on every side, so the GL wordmark sits on the SVG one.
 */
// named imports so the poster-only `path` string stays out of the GL chunk
import { box, sdf } from '../wordmark.json';

export const SDF_META = { box, sdf };

/** header shared by every program in the hero pipeline */
export const HEADER = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 o;
uniform sampler2D uSDF;
uniform vec2 uRes;       // canvas size, px
uniform vec4 uBox;       // poster box in canvas px, top-left origin: x, y, w, h
uniform vec2 uBoxUnits;  // poster box in SVG user units (1200 x 372)
uniform float uPad, uSpread; // sdf padding / distance range, in box units
uniform float uTime, uPx;    // animation time (s), canvas px per css px
uniform vec3 uPaper, uInk, uAccent, uBlue; // from tokens.css
`;

export const SDF_GLSL = `
vec2 fragTL(vec2 uv){ return vec2(uv.x, 1.0-uv.y) * uRes; }
vec2 unitsAt(vec2 tl){ return (tl - uBox.xy) / uBox.zw * uBoxUnits; }
float unitsPerPx(){ return uBoxUnits.x / uBox.z; }
/* signed distance in box units, positive inside the glyphs */
float sdfDist(vec2 unit){
  vec2 t = (unit + uPad) / (uBoxUnits + 2.0*uPad);
  return (texture(uSDF, t).r - 0.5) * 2.0 * uSpread;
}
`;

/** ?stage=sdf: the distance field itself, iso-contours every 4 units, zero crossing in blueprint blue */
export const SDF_VIEW = `
vec3 stageSdf(vec2 uv){
  float dist = sdfDist(unitsAt(fragTL(uv)));
  float w = max(fwidth(dist), 1e-3);
  float iso = abs(fract(dist/4.0+0.5)-0.5)*4.0;
  float lines = (1.0 - smoothstep(0.0, w*1.1, iso)) * (1.0 - smoothstep(uSpread-3.0, uSpread-1.0, abs(dist)));
  float edge = 1.0 - smoothstep(0.0, w*1.4, abs(dist));
  vec3 col = mix(uPaper, uInk, step(0.0, dist)*0.07);
  col = mix(col, uBlue, lines*0.35);
  return mix(col, uBlue, edge);
}
`;
