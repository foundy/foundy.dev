import { describe, expect, it } from 'vitest';
import { canned } from '../../data/lab';
import { parseRecording } from '../motion/recorder';
import { TAU_MS } from '../cards/decision';
import { simulate, releaseTable, STEP, type DecisionId } from './rules';
import { stageMarkup, chartMarkup } from './stage';

const rec = (id: DecisionId, rid: string) => canned[id].recordings.find((r) => r.id === rid)!.recording;
const out = (id: DecisionId, rid: string, side: 'old' | 'new', tau = TAU_MS) => simulate(id, side, rec(id, rid), tau);

describe('canned recordings', () => {
  it('are recorder v1 and realistic (60-120 Hz, ordered, down..up)', () => {
    for (const [id, set] of Object.entries(canned)) {
      expect(set.id).toBe(id);
      expect(set.recordings.length).toBeGreaterThanOrEqual(2);
      for (const r of set.recordings) {
        const parsed = parseRecording(JSON.stringify(r.recording));
        const s = parsed.samples;
        expect(s[0].type).toBe('down');
        expect(s[s.length - 1].type).toBe('up');
        const dts = s.slice(1).map((p, i) => p.t - s[i].t);
        expect(dts.every((d) => d > 0)).toBe(true);
        const sorted = [...dts].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        if (s.length > 6) expect(median).toBeGreaterThanOrEqual(7);
        expect(median).toBeLessThanOrEqual(18);
      }
    }
  });
});

describe('both sides share one clock', () => {
  it('same duration, same release time, deterministic', () => {
    for (const [id, set] of Object.entries(canned) as [DecisionId, (typeof canned)[DecisionId]][]) {
      for (const r of set.recordings) {
        const a = simulate(id, 'old', r.recording);
        const b = simulate(id, 'new', r.recording);
        expect(a.duration).toBe(b.duration);
        expect(a.tUp).toBe(b.tUp);
        expect(a.frames.length).toBe(b.frames.length);
        expect(simulate(id, 'new', r.recording).frames).toEqual(b.frames);
        expect(stageMarkup(a, a.duration, 'x')).toContain('<svg');
        expect(chartMarkup(b)).toContain('<svg');
      }
    }
  });
});

describe('01 release rule: distance only vs projected velocity', () => {
  it('a short fast flick closes only under the new rule', () => {
    expect(out('release-rule', 'flick', 'old').outcome.key).toBe('open');
    expect(out('release-rule', 'flick', 'new').outcome.key).toBe('closed');
  });
  it('a long pull swung back up closes only under the old rule', () => {
    expect(out('release-rule', 'swing-back', 'old').outcome.key).toBe('closed');
    expect(out('release-rule', 'swing-back', 'new').outcome.key).toBe('open');
  });
  it('controls: an ordinary pull closes and a twitch stays open under both', () => {
    for (const side of ['old', 'new'] as const) {
      expect(out('release-rule', 'ordinary', side).outcome.key).toBe('closed');
      expect(out('release-rule', 'twitch', side).outcome.key).toBe('open');
    }
  });
  it('tau window: the shipped value sits inside the range where all four recordings are right', () => {
    const right = (tau: number) =>
      out('release-rule', 'flick', 'new', tau).outcome.key === 'closed' &&
      out('release-rule', 'swing-back', 'new', tau).outcome.key === 'open' &&
      out('release-rule', 'ordinary', 'new', tau).outcome.key === 'closed' &&
      out('release-rule', 'twitch', 'new', tau).outcome.key === 'open';
    const ok: number[] = [];
    for (let tau = 0; tau <= 200; tau += 5) if (right(tau)) ok.push(tau);
    expect(ok).toContain(TAU_MS);
    // contiguous window; the copy in data/lab/decisions.ts says "roughly 55 to 125 ms"
    expect(ok[0]).toBeGreaterThanOrEqual(50);
    expect(ok[0]).toBeLessThanOrEqual(60);
    expect(ok[ok.length - 1]).toBeGreaterThanOrEqual(120);
    expect(ok[ok.length - 1]).toBeLessThanOrEqual(130);
    expect(ok.length).toBe((ok[ok.length - 1] - ok[0]) / 5 + 1);
  });
  it('tau = 0 makes the new rule agree with a distance-only rule on the line it uses', () => {
    expect(out('release-rule', 'flick', 'new', 0).outcome.key).toBe('open');
    expect(out('release-rule', 'swing-back', 'new', 0).outcome.key).toBe('closed');
  });
  it('the table re-evaluates every recording', () => {
    const rows = releaseTable(canned['release-rule'].recordings, TAU_MS);
    expect(rows.map((r) => [r.old, r.new])).toEqual([
      ['open', 'closed'],
      ['closed', 'open'],
      ['closed', 'closed'],
      ['open', 'open'],
    ]);
  });
});

describe('02 close order: all at once vs hero first', () => {
  it('both close, but the picture lands sooner, the text goes sooner and nothing is squashed', () => {
    for (const rid of ['ordinary', 'flick', 'slow-long']) {
      const o = out('close-order', rid, 'old');
      const n = out('close-order', rid, 'new');
      expect(o.outcome.key).toBe('closed');
      expect(n.outcome.key).toBe('closed');
      expect(n.metrics.heroLandMs).toBeLessThan(o.metrics.heroLandMs - 60);
      expect(n.metrics.bodyGoneMs).toBeLessThan(o.metrics.bodyGoneMs / 2);
      expect(o.metrics.squash).toBeGreaterThan(2);
      expect(n.metrics.squash).toBe(1);
    }
  });
});

describe('03 tap vs drag: no guard vs slop + grace', () => {
  it('a pull that starts on a link fires the link only without the guard', () => {
    expect(out('tap-vs-drag', 'slow-pull-link', 'old').outcome.key).toBe('link');
    expect(out('tap-vs-drag', 'slow-pull-link', 'new').outcome.key).toBe('swallowed');
  });
  it('a shaky tap is still a tap under both', () => {
    expect(out('tap-vs-drag', 'jittery-tap', 'old').outcome.key).toBe('link');
    expect(out('tap-vs-drag', 'jittery-tap', 'new').outcome.key).toBe('link');
  });
  it('a ghost click inside the grace window closes only the old sheet; a later tap closes both', () => {
    expect(out('tap-vs-drag', 'ghost-scrim', 'old').outcome.key).toBe('closed');
    expect(out('tap-vs-drag', 'ghost-scrim', 'new').outcome.key).toBe('ignored');
    const late = { ...rec('tap-vs-drag', 'ghost-scrim'), meta: { ...rec('tap-vs-drag', 'ghost-scrim').meta, scrimAgeMs: 400 } };
    expect(simulate('tap-vs-drag', 'old', late).outcome.key).toBe('closed');
    expect(simulate('tap-vs-drag', 'new', late).outcome.key).toBe('closed');
  });
});

describe('04 snap back: fixed ease vs velocity spring', () => {
  it('both stay open, but the new return does not lurch away from the hand', () => {
    for (const rid of ['slow-release', 'upward-flick', 'near-miss']) {
      const o = out('snap-back', rid, 'old');
      const n = out('snap-back', rid, 'new');
      expect(o.outcome.key).toBe('open');
      expect(n.outcome.key).toBe('open');
      expect(n.metrics.speedJump).toBeLessThan(o.metrics.speedJump * 0.7);
      expect(n.metrics.overshoot).toBeGreaterThan(0.5); // the spring has a little bounce; the ease has none
      expect(o.metrics.overshoot).toBeLessThan(0.01);
    }
  });
  it('the new spring keeps the release direction', () => {
    const n = out('snap-back', 'upward-flick', 'new');
    expect(n.metrics.speedRelease).toBeLessThan(0);
    expect(n.metrics.speedAfter).toBeLessThan(0);
  });
  it('frames are sampled every STEP ms and end at home', () => {
    const n = out('snap-back', 'near-miss', 'new');
    expect(n.frames.length).toBe(Math.ceil(n.duration / STEP) + 1);
    expect(Math.abs(n.frames[n.frames.length - 1].off)).toBeLessThan(0.5);
  });
});
