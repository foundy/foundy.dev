/**
 * Shared animation clock. Time-based (never frame-count based) and clamped, so a throttled tab, a
 * dropped frame or a long GC pause advances the simulation by at most `maxDt` instead of exploding it.
 */
export interface Clock {
  /** accumulated animation time in seconds (only advances while ticking) */
  readonly time: number;
  /** advance to `nowMs` (a rAF timestamp); returns the clamped delta in seconds */
  tick(nowMs: number): number;
  /** call when ticking restarts after a pause so the pause itself is not counted */
  resume(nowMs: number): void;
  /** pin `time` to a value (screenshots/QA); `null` releases */
  freeze(t: number | null): void;
}

export function createClock(maxDt = 1 / 20, minDt = 1 / 480): Clock {
  let last = -1;
  let time = 0;
  let frozen: number | null = null;
  return {
    get time() {
      return frozen ?? time;
    },
    tick(nowMs) {
      const raw = last < 0 ? 0 : (nowMs - last) / 1000;
      last = nowMs;
      const dt = Math.min(Math.max(raw, minDt), maxDt);
      time += dt;
      return dt;
    },
    resume(nowMs) {
      last = nowMs;
    },
    freeze(t) {
      frozen = t;
    },
  };
}
