/**
 * The pull-down close decision, as a pure function so it can be unit-tested, shown by Inspect and replayed against
 * other rules in the Lab.
 *
 * At release we do not ask "how far did it go" but "where was it going": the projected travel is the distance so far
 * plus what the current velocity would add in the next TAU_MS (a flick that has barely moved still projects far; a slow
 * long pull projects only what it already did). Close when the projection passes CLOSE_FRACTION of the sheet height.
 *
 *   projected = distance + velocity * TAU_MS            (px; velocity in px/ms, positive = down)
 *   close     = distance >= MIN_DISTANCE_PX && projected > CLOSE_FRACTION * sheetHeight
 *
 * Constants (tuned on paper against the legacy v12/v20 numbers, to be tuned by hand on a phone):
 *   TAU_MS            80    ~5 frames of lookahead. 92 px at 1.8 px/ms projects 236 px.
 *   CLOSE_FRACTION    0.35  of the sheet height (640 px sheet -> 224 px). The legacy prototype closed at a fixed 110 px.
 *   MIN_DISTANCE_PX   16    below this a flick is a twitch (a tap that slid), however fast.
 *   RUBBER_PX         56    asymptote of the resistance when the pull is dragged back above its start.
 */
export const TAU_MS = 80;
export const CLOSE_FRACTION = 0.35;
export const MIN_DISTANCE_PX = 16;
export const RUBBER_PX = 56;

export interface CloseInput {
  /** px pulled down since the drag was recognised (can be negative if dragged back up) */
  distance: number;
  /** px/ms at release, positive = downward */
  velocity: number;
  /** height of the sheet in px */
  sheetHeight: number;
}

export interface CloseParams {
  tau: number;
  fraction: number;
  minDistance: number;
}
export const DEFAULT_PARAMS: CloseParams = { tau: TAU_MS, fraction: CLOSE_FRACTION, minDistance: MIN_DISTANCE_PX };

export interface CloseDecision {
  close: boolean;
  projected: number;
  /** the line projected travel has to pass, px */
  threshold: number;
  reason: 'projected-past-threshold' | 'projected-short-of-threshold' | 'too-short-to-count';
}

export function decideClose(i: CloseInput, p: CloseParams = DEFAULT_PARAMS): CloseDecision {
  const projected = i.distance + i.velocity * p.tau;
  const threshold = p.fraction * i.sheetHeight;
  if (i.distance < p.minDistance) return { close: false, projected, threshold, reason: 'too-short-to-count' };
  const close = projected > threshold;
  return { close, projected, threshold, reason: close ? 'projected-past-threshold' : 'projected-short-of-threshold' };
}

export const shouldClose = (i: CloseInput, p?: CloseParams) => decideClose(i, p).close;

/** how far the sheet follows the finger: 1:1 downward, rubber-banded (asymptote RUBBER_PX) above the start */
export function dragOffset(distance: number): number {
  return distance >= 0 ? distance : -RUBBER_PX * (1 - Math.exp(distance / RUBBER_PX));
}
