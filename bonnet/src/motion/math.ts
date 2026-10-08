export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** 0 below a, 1 above b, smooth in between */
export function smoothstep(a: number, b: number, v: number) {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
/** resistance past an edge: follows the finger at first, approaches `limit` asymptotically (never reaches it) */
export const rubber = (over: number, limit: number) => (over <= 0 ? 0 : limit * (1 - Math.exp(-over / limit)));
