/**
 * Release decisions as pure functions (unit-tested). All of them ask "where was it going", not "where is it":
 * the current position plus velocity * tau, the same idea as the study's close rule (distance + velocity * 80 ms).
 */
import { clamp, rubber } from './math';

/** deck: how far ahead of the finger we look, ms. A light flick (0.5 px/ms) over a 170 px spacing projects ~0.65 card. */
export const DECK_TAU_MS = 220;
/** deck: finger speed (px/ms) above which a flick may skip two cards */
export const DECK_STRONG_PX_MS = 2.1;
/** deck: how far past either end the rubber band can pull, in cards */
export const DECK_RUBBER = 0.32;

export interface DeckRelease {
  /** current (fractional) position, in cards */
  pos: number;
  /** index the drag started from */
  startIndex: number;
  /** finger velocity px/ms, positive = rightwards (which moves the deck towards lower indices) */
  vx: number;
  /** pixels of finger travel per card */
  spacing: number;
  count: number;
}

export function pickTarget(r: DeckRelease): number {
  const vCards = -r.vx / r.spacing; // cards/ms
  const projected = r.pos + vCards * DECK_TAU_MS;
  const reach = Math.abs(r.vx) > DECK_STRONG_PX_MS ? 2 : 1;
  const t = clamp(Math.round(projected), r.startIndex - reach, r.startIndex + reach);
  return clamp(t, 0, r.count - 1);
}

/** raw (unbounded) deck position -> position with rubber-banded ends */
export function bandPosition(raw: number, count: number): number {
  const max = count - 1;
  if (raw < 0) return -rubber(-raw, DECK_RUBBER);
  if (raw > max) return max + rubber(raw - max, DECK_RUBBER);
  return raw;
}

/**
 * Detail pull-down. `p` is the open progress (1 = fully open). The finger scrubs p over `range` px, so
 *   distance  = (1 - p) * range
 *   projected = distance + velocity * CLOSE_TAU_MS
 * and the sheet closes when the projection passes CLOSE_FRACTION of the range (velocity px/ms, positive = down).
 */
export const CLOSE_TAU_MS = 100;
export const CLOSE_FRACTION = 0.3;
export const CLOSE_MIN_PX = 12;

export interface CloseInput {
  p: number;
  velocity: number;
  range: number;
}
export interface CloseResult {
  close: boolean;
  projected: number;
  threshold: number;
}

export function decideClose({ p, velocity, range }: CloseInput): CloseResult {
  const distance = (1 - p) * range;
  const projected = distance + velocity * CLOSE_TAU_MS;
  const threshold = CLOSE_FRACTION * range;
  return { close: distance >= CLOSE_MIN_PX && projected > threshold, projected, threshold };
}

/** hero angle scrub: inertia then snap to a whole angle. `a` in angle units (4 = full turn), v in angles/ms. */
export const ANGLE_TAU_MS = 240;
export function snapAngle(a: number, v: number, startAngle: number = Math.round(a)): number {
  const t = Math.round(a + v * ANGLE_TAU_MS);
  return clamp(t, Math.round(startAngle) - 2, Math.round(startAngle) + 2);
}

/** which of the 4 hero images (and how much) a continuous angle shows: [index, fraction] */
export function angleParts(a: number): [number, number] {
  const f = Math.floor(a);
  return [((f % 4) + 4) % 4, a - f];
}
