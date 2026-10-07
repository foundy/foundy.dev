// Generates the canned Lab recordings (recorder schema v:1) into src/data/lab/*.json.
// Synthetic but realistic: 60 or 120 Hz sample clocks with timestamp jitter and sub-pixel hand noise, from seeded
// piecewise motion profiles. Re-run after changing a profile: node scripts/lab/make-recordings.mjs
// Coordinates are in Lab stage space: a 390 x 720 viewport with the sheet at (0, 40, 390, 640).
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '../../src/data/lab');
mkdirSync(out, { recursive: true });

const rng = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const EASE = {
  linear: (u) => u,
  inQuad: (u) => u * u,
  outCubic: (u) => 1 - (1 - u) ** 3,
  inOutCubic: (u) => (u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2),
};
const SHEET = { x: 0, y: 40, w: 390, h: 640 };
const r1 = (n) => Math.round(n * 10) / 10;

function gesture({ seed, hz = 60, x = 195, y = 120, pointer = 'touch', segs, extraMeta = {} }) {
  const rnd = rng(seed);
  const total = segs.reduce((a, s) => a + s.dur, 0);
  const pos = (t) => {
    let t0 = 0;
    let px = x;
    let py = y;
    for (const s of segs) {
      if (t <= t0 + s.dur || s === segs[segs.length - 1]) {
        const u = Math.min(1, Math.max(0, (t - t0) / s.dur));
        const e = EASE[s.ease ?? 'linear'](u);
        return [px + (s.dx ?? 0) * e, py + s.dy * e];
      }
      t0 += s.dur;
      px += s.dx ?? 0;
      py += s.dy;
    }
    return [px, py];
  };
  const step = 1000 / hz;
  const samples = [{ t: 0, x, y, type: 'down' }];
  for (let t = step; t < total - step * 0.4; t += step) {
    const tt = Math.round(t + (rnd() - 0.5) * 2.4);
    const [px, py] = pos(tt);
    samples.push({ t: tt, x: r1(px + (rnd() - 0.5) * 1.2), y: r1(py + (rnd() - 0.5) * 0.8), type: 'move' });
  }
  const [ex, ey] = pos(total);
  samples.push({ t: Math.round(total), x: r1(ex), y: r1(ey), type: 'up' });
  const slop = pointer === 'touch' ? 10 : 8;
  return { v: 1, kind: 'sheet-pull', meta: { pointerType: pointer, slop, sheetHeight: SHEET.h, sheetRect: SHEET, ...extraMeta }, samples };
}

const link = { x: 120, y: 498 }; // inside the "Read more" link of the stage sheet
const decisions = {
  'release-rule': [
    ['flick', 'Short fast flick', 'About 150 px in 125 ms, still accelerating at lift-off.', { seed: 11, hz: 120, segs: [{ dur: 125, dy: 150, ease: 'inQuad' }] }],
    ['swing-back', 'Pull far, then swing back up', 'A long pull that reverses just before release: the hand says "never mind".', { seed: 12, hz: 60, segs: [{ dur: 900, dy: 350, ease: 'inOutCubic' }, { dur: 90, dy: -90, ease: 'linear' }] }],
    ['ordinary', 'Ordinary pull', 'A steady pull well past the middle of the sheet.', { seed: 13, hz: 60, segs: [{ dur: 760, dy: 340, ease: 'outCubic' }] }],
    ['twitch', 'Accidental twitch', 'An 80 px jerk in 65 ms. Not meant to close anything.', { seed: 14, hz: 120, segs: [{ dur: 65, dy: 80, ease: 'inQuad' }] }],
  ],
  'close-order': [
    ['ordinary', 'Ordinary pull', 'Steady pull, release, close.', { seed: 21, hz: 60, segs: [{ dur: 760, dy: 340, ease: 'outCubic' }] }],
    ['flick', 'Short fast flick', 'Closes on speed. The sheet has barely moved when it starts to close.', { seed: 22, hz: 120, segs: [{ dur: 125, dy: 150, ease: 'inQuad' }] }],
    ['slow-long', 'Slow, long pull', 'A deliberate pull that stops, then lets go.', { seed: 23, hz: 60, segs: [{ dur: 1400, dy: 300, ease: 'inOutCubic' }, { dur: 120, dy: 8, ease: 'linear' }] }],
  ],
  'tap-vs-drag': [
    ['slow-pull-link', 'Pull that starts on a link', 'The finger lands on "Read more", drags the sheet down 78 px and lets go.', { seed: 31, hz: 60, x: link.x, y: link.y, segs: [{ dur: 520, dy: 78, ease: 'inOutCubic' }] }],
    ['jittery-tap', 'Tap with a shaky finger', 'A real tap that wobbles a few px. It must still count as a tap.', { seed: 32, hz: 60, x: link.x, y: link.y, segs: [{ dur: 95, dy: 3, dx: 3, ease: 'linear' }] }],
    ['ghost-scrim', 'Ghost click on the backdrop', 'The tap that opened the sheet arrives again 120 ms later, on the dimmed strip above it.', { seed: 33, hz: 60, x: 195, y: 20, segs: [{ dur: 70, dy: 1, ease: 'linear' }], extraMeta: { scrimAgeMs: 120 } }],
  ],
  'snap-back': [
    ['slow-release', 'Slow pull, gentle release', 'Pull 145 px, ease off, let go. Below the close line.', { seed: 41, hz: 60, segs: [{ dur: 800, dy: 145, ease: 'inOutCubic' }, { dur: 100, dy: 2, ease: 'linear' }] }],
    ['upward-flick', 'Flick back up', 'Pull, then flick upward as you let go. The sheet should keep that upward speed.', { seed: 42, hz: 120, segs: [{ dur: 620, dy: 210, ease: 'inOutCubic' }, { dur: 90, dy: -70, ease: 'linear' }] }],
    ['near-miss', 'Near miss', 'Pulled to just under the close line, held, then let go.', { seed: 43, hz: 60, segs: [{ dur: 900, dy: 215, ease: 'outCubic' }, { dur: 240, dy: 2, ease: 'linear' }] }],
  ],
};

for (const [id, list] of Object.entries(decisions)) {
  const recordings = list.map(([rid, title, note, spec]) => ({ id: rid, title, note, recording: gesture(spec) }));
  writeFileSync(join(out, `${id}.json`), JSON.stringify({ id, recordings }) + '\n');
  console.log(id, recordings.map((r) => `${r.id}:${r.recording.samples.length}`).join(' '));
}
