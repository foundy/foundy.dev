/**
 * Quality tiers driven by measured frame times (no startup GPU benchmark).
 *
 * Start conservative (`mid`). Frame cost is judged from rAF-to-rAF intervals, which are vsync-quantised, so
 * "slow" is relative to the display's refresh period: the p90 interval over a rolling 2 s window must exceed
 * max(12 ms, 1.35 x period) to count (>= 22.5 ms on a 60 Hz display, 12 ms on 120 Hz), i.e. at least one frame in ten
 * is missing a vsync. Upgrades are cautious: 8 s of clean frames, 15 s cooldown, and a tier we downgraded away from
 * is never returned to in the same session.
 */
export type Tier = 'low' | 'mid' | 'high';
export const TIER_ORDER: readonly Tier[] = ['low', 'mid', 'high'];

export interface QualityOptions {
  start?: Tier;
  /** pin the tier (QA); disables adaptation */
  pinned?: boolean;
  onChange?: (tier: Tier, reason: 'downgrade' | 'upgrade') => void;
}

export interface Quality {
  readonly tier: Tier;
  readonly pinned: boolean;
  /** set a tier by hand; this pins it (no further adaptation) */
  set(tier: Tier): void;
  /** feed one frame interval (ms) measured while the loop was running continuously */
  push(intervalMs: number, nowMs: number): void;
  /** the loop slept or the tab was hidden: forget the samples */
  reset(): void;
  /** p50/p90/p95 of the current window, ms */
  summary(): { n: number; p50: number; p90: number; p95: number; period: number };
}

const WINDOW_MS = 2000;
const MIN_SAMPLES = 30;
const UPGRADE_CLEAN_MS = 8000;
const COOLDOWN_MS = 15000;

function pct(sorted: number[], p: number) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
}

export function createQuality(opts: QualityOptions = {}): Quality {
  let tier: Tier = opts.start ?? 'mid';
  let pinned = !!opts.pinned;
  let ceiling = TIER_ORDER.length - 1;
  let samples: { t: number; ms: number }[] = [];
  let cleanSince = -1;
  let lastChange = -Infinity;

  const stats = () => {
    const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
    const p10 = pct(sorted, 0.1);
    // snap the refresh period to 120 Hz or 60 Hz; anything else is treated as 60
    const period = p10 > 0 && p10 < 12.5 ? 1000 / 120 : 1000 / 60;
    return { n: sorted.length, p50: pct(sorted, 0.5), p90: pct(sorted, 0.9), p95: pct(sorted, 0.95), period };
  };

  const change = (dir: 1 | -1, reason: 'downgrade' | 'upgrade', now: number) => {
    const i = TIER_ORDER.indexOf(tier) + dir;
    if (i < 0 || i > ceiling) return;
    if (reason === 'downgrade') ceiling = Math.min(ceiling, i);
    tier = TIER_ORDER[i];
    lastChange = now;
    samples = [];
    cleanSince = -1;
    opts.onChange?.(tier, reason);
  };

  return {
    get tier() {
      return tier;
    },
    get pinned() {
      return pinned;
    },
    set(t) {
      tier = t;
      pinned = true;
      samples = [];
    },
    push(ms, now) {
      if (pinned) return;
      samples.push({ t: now, ms });
      while (samples.length && now - samples[0].t > WINDOW_MS) samples.shift();
      const span = samples.length ? now - samples[0].t : 0;
      if (samples.length < MIN_SAMPLES || span < WINDOW_MS * 0.9) return;
      const s = stats();
      if (s.p90 > Math.max(12, s.period * 1.35)) {
        cleanSince = -1;
        change(-1, 'downgrade', now);
        return;
      }
      if (s.p90 <= s.period * 1.1) {
        if (cleanSince < 0) cleanSince = now;
        if (now - cleanSince >= UPGRADE_CLEAN_MS && now - lastChange >= COOLDOWN_MS) change(1, 'upgrade', now);
      } else {
        cleanSince = -1;
      }
    },
    reset() {
      samples = [];
      cleanSince = -1;
    },
    summary: stats,
  };
}
