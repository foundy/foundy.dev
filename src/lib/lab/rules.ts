/**
 * Lab: the old and the new rule of each card-study decision, as deterministic simulations of ONE recorded gesture.
 *
 * `simulate(decision, side, recording, tau)` replays the recording through the real GesturePipeline (../motion), asks
 * the side's rule what to do, and returns a Track: frames every STEP ms (what the mini sheet looks like), the outcome,
 * the numbers behind it and a plain-English explanation. Both sides of a comparison get the same recording, so they
 * share one clock (`tUp` and the tail are the same); only the rule differs. No DOM here: it runs at build time (the
 * static SVG fallback), in the browser (the live comparison) and in vitest.
 *
 * Stage space is a 390 x 720 viewport; the sheet is (0,40,390,640) and the card it closes into is SLOT. Old-rule
 * specifics that cannot be read off the legacy files exactly are marked `mock` in ../../data/lab/decisions.ts.
 */
import { replay } from '../motion/recorder';
import type { GestureEvent, Sample } from '../motion/gesture';
import { Spring } from '../motion/spring';
import type { Recording } from '../motion/recorder';
import { DEFAULT_PARAMS, TAU_MS, decideClose, dragOffset, type CloseParams } from '../cards/decision';
import { CLOSE_CFG, SCRIM_GRACE_MS, SNAP_CFG } from '../cards/tuning';

export type DecisionId = 'release-rule' | 'close-order' | 'tap-vs-drag' | 'snap-back';
export type Side = 'old' | 'new';

export const STEP = 8;
/** time after release that every track keeps running, so both sides end on the same clock */
export const TAIL = 900;

export const SHEET = { x: 0, y: 40, w: 390, h: 640 };
export const HERO = { x: 0, y: 40, w: 390, h: 190 };
export const SLOT = { x: 20, y: 610, w: 350, h: 90 };
export const LINK = { x: 40, y: 470, w: 200, h: 56 };
export const VIEW = { w: 390, h: 720 };

/** v1-v11 style: distance only, 38% of the sheet, no minimum (v12 rule; the 38% is `mock`, see decisions.ts) */
export const OLD_PARAMS: CloseParams = { tau: 0, fraction: 0.38, minDistance: 0 };
/** the close-content-first rule slows nothing down: this is only what the *old* choreography used (`mock`) */
const OLD_CLOSE_CFG = { ...CLOSE_CFG, stiffness: 170, damping: 2 * Math.sqrt(170) };

export interface Frame {
  /** px the sheet is pulled down (frozen once closing starts) */
  off: number;
  /** 0..1 morph of the whole sheet group into the card slot */
  sp: number;
  /** 0..1 morph of the hero picture into the card slot */
  ph: number;
  body: number;
  bg: number;
  /** dimming of the page behind the sheet */
  scrim: number;
  fx: number;
  fy: number;
  finger: boolean;
  /** 0 idle, 1 link fired, 2 click swallowed */
  link: 0 | 1 | 2;
  /** pointer samples revealed so far */
  ti: number;
}

export interface Series {
  cls: string;
  label: string;
  pts: [number, number][];
}
export interface Chart {
  series: Series[];
  hlines: { v: number; label: string; cls?: string }[];
  /** dashed segment (the projection) */
  proj?: [[number, number], [number, number]];
  unit: string;
  ymin: number;
  ymax: number;
}

export interface Outcome {
  key: 'closed' | 'open' | 'link' | 'swallowed' | 'ignored';
  /** the badge */
  label: string;
  /** one line of numbers under the badge */
  detail: string;
}

export interface Track {
  decision: DecisionId;
  side: Side;
  duration: number;
  tUp: number;
  frames: Frame[];
  trail: [number, number, number][];
  outcome: Outcome;
  explain: string;
  chart: Chart;
  /** overlay on the stage, in stage px */
  marks: { thrY?: number; projY?: number; relY?: number; startY: number; slopR?: number };
  metrics: Record<string, number>;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);
const px = (n: number) => `${Math.round(n)} px`;
const inRect = (x: number, y: number, r: { x: number; y: number; w: number; h: number }) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/** CSS cubic-bezier(.22,1,.36,1) as an easing function (the legacy 170-220 ms reveal curve) */
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  return (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = ((ax * t + bx) * t + cx) * t - x;
      const d = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(e) < 1e-6 || Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    t = clamp(t, 0, 1);
    return ((ay * t + by) * t + cy) * t;
  };
}
const EASE_OUT = bezier(0.22, 1, 0.36, 1);
export const OLD_SNAP_MS = 220;

interface Analysis {
  samples: Sample[];
  events: GestureEvent[];
  claim?: { t: number; x: number; y: number };
  rel?: Extract<GestureEvent, { kind: 'release' }>;
  tapAt?: number;
  tUp: number;
  at(t: number): [number, number];
  offAt(t: number): number;
  downOnLink: boolean;
  scrimTap: boolean;
  sheetHeight: number;
}

export function analyse(rec: Pick<Recording, 'meta' | 'samples'>): Analysis {
  const samples = rec.samples;
  const events = replay(rec);
  const slop = events.find((e) => e.kind === 'slop' && e.claimed);
  const rel = events.find((e) => e.kind === 'release') as Analysis['rel'];
  const tap = events.find((e) => e.kind === 'tap');
  const claim = slop ? { t: slop.sample.t, x: slop.sample.x, y: slop.sample.y } : undefined;
  const tUp = samples[samples.length - 1].t;
  const at = (t: number): [number, number] => {
    if (t <= samples[0].t) return [samples[0].x, samples[0].y];
    for (let i = 1; i < samples.length; i++) {
      const b = samples[i];
      if (t <= b.t) {
        const a = samples[i - 1];
        const u = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
        return [lerp(a.x, b.x, u), lerp(a.y, b.y, u)];
      }
    }
    return [samples[samples.length - 1].x, samples[samples.length - 1].y];
  };
  const offAt = (t: number) => (claim && t >= claim.t ? dragOffset(at(t)[1] - claim.y) : 0);
  const d0 = samples[0];
  return {
    samples,
    events,
    claim,
    rel,
    tapAt: tap?.sample.t,
    tUp,
    at,
    offAt,
    downOnLink: inRect(d0.x, d0.y, LINK),
    scrimTap: d0.y < SHEET.y,
    sheetHeight: Number(rec.meta.sheetHeight) || SHEET.h,
  };
}

interface Verdict {
  close: boolean;
  projected: number;
  threshold: number;
  distance: number;
  velocity: number;
  reason: string;
}

/** map a rect to another by q (translate + scale of a group drawn in stage space) */
export function morph(base: { x: number; y: number; w: number; h: number }, off: number, q: number) {
  const sx = lerp(1, SLOT.w / base.w, q);
  const sy = lerp(1, SLOT.h / base.h, q);
  const x = lerp(base.x, SLOT.x, q);
  const y = lerp(base.y + off, SLOT.y, q);
  return { tx: x - base.x * sx, ty: y - base.y * sy, sx, sy };
}

export function simulate(id: DecisionId, side: Side, rec: Pick<Recording, 'meta' | 'samples'>, tau: number = TAU_MS): Track {
  const A = analyse(rec);
  const meta = rec.meta as Record<string, unknown>;
  const isOld = side === 'old';
  const tUp = A.tUp;
  const duration = tUp + TAIL;

  /* ---- 1. the rule's verdict ---- */
  let v: Verdict | null = null;
  if (A.rel) {
    const params = id === 'release-rule' ? (isOld ? OLD_PARAMS : { ...DEFAULT_PARAMS, tau }) : DEFAULT_PARAMS;
    const d = decideClose({ distance: A.rel.dy, velocity: A.rel.vy, sheetHeight: A.sheetHeight }, params);
    v = { close: d.close, projected: d.projected, threshold: d.threshold, distance: A.rel.dy, velocity: A.rel.vy, reason: d.reason };
  }
  let close = !!v?.close;
  let link: 0 | 1 | 2 = 0;
  let scrimClosed = false;
  if (id === 'tap-vs-drag') {
    if (A.rel && A.downOnLink) link = isOld ? 1 : 2; // the sheet follows the finger, so the link is still under it at lift-off
    else if (A.tapAt != null && A.downOnLink) link = 1;
    if (A.tapAt != null && A.scrimTap) {
      const age = typeof meta.scrimAgeMs === 'number' ? meta.scrimAgeMs : 120;
      if (isOld || age >= SCRIM_GRACE_MS) {
        close = true;
        scrimClosed = true;
      }
    }
  }

  /* ---- 2. frames ---- */
  const frames: Frame[] = [];
  const off0 = A.offAt(tUp);
  const closeSpring = new Spring(0, isOld && id === 'close-order' ? OLD_CLOSE_CFG : CLOSE_CFG);
  const heroSpring = new Spring(0, CLOSE_CFG);
  const snap = new Spring(off0, SNAP_CFG);
  const vRel = (A.rel?.vy ?? 0) * 1000;
  let started = false;
  const n = Math.ceil(duration / STEP);
  let ti = 0;
  const offs: number[] = [];
  const bodyAt: number[] = [];
  const heroAt: number[] = [];
  let maxSquash = 1;
  for (let i = 0; i <= n; i++) {
    const t = Math.min(i * STEP, duration);
    while (ti < A.samples.length && A.samples[ti].t <= t) ti++;
    let off = 0;
    let sp = 0;
    let ph = 0;
    let body = 1;
    let bg = 1;
    let scrim = 1;
    const [fx, fy] = A.at(Math.min(t, tUp));
    if (t <= tUp) off = A.offAt(t);
    else {
      if (!started) {
        started = true;
        if (close) {
          closeSpring.retarget(1);
          heroSpring.retarget(1);
        } else if (!isOld || id !== 'snap-back') {
          snap.set(off0, vRel);
          snap.retarget(0);
        }
      }
      if (close) {
        closeSpring.step(STEP);
        heroSpring.step(STEP);
        off = off0;
        const p = closeSpring.value;
        if (id === 'close-order' && isOld) {
          // v18.0.4 and earlier: the whole sheet shrinks as one piece; text and picture arrive together, late
          sp = p;
          ph = p;
          body = 1 - p;
          bg = 1 - p;
        } else {
          // close hero first: the picture goes straight to the card, the text is already gone at 40%
          ph = heroSpring.value;
          body = clamp(1 - p / 0.4, 0, 1);
          bg = clamp(1 - p / 0.5, 0, 1);
        }
        scrim = 1 - clamp(p, 0, 1);
      } else if (id === 'snap-back' && isOld) {
        const u = clamp((t - tUp) / OLD_SNAP_MS, 0, 1);
        off = off0 * (1 - EASE_OUT(u));
      } else {
        snap.step(STEP);
        off = snap.value;
      }
    }
    offs.push(off);
    bodyAt.push(body);
    heroAt.push(ph);
    if (body > 0.05) maxSquash = Math.max(maxSquash, (1 - sp * (1 - SLOT.w / SHEET.w)) / (1 - sp * (1 - SLOT.h / SHEET.h)));
    frames.push({
      off,
      sp,
      ph,
      body,
      bg,
      scrim,
      fx,
      fy,
      finger: t <= tUp + 60,
      link: t >= tUp && link ? link : 0,
      ti,
    });
  }

  /* ---- 3. metrics ---- */
  const metrics: Record<string, number> = { tUp, close: close ? 1 : 0, off0 };
  const firstAfter = (arr: number[], test: (x: number) => boolean) => {
    for (let i = 0; i < arr.length; i++) if (i * STEP >= tUp && test(arr[i])) return i * STEP - tUp;
    return NaN;
  };
  if (close) {
    metrics.heroLandMs = firstAfter(heroAt, (x) => x > 0.985);
    metrics.bodyGoneMs = firstAfter(bodyAt, (x) => x < 0.03);
    metrics.squash = maxSquash;
  } else {
    let settle = tUp;
    let minOff = 0;
    for (let i = 0; i < offs.length; i++) {
      if (i * STEP < tUp) continue;
      minOff = Math.min(minOff, offs[i]);
      if (Math.abs(offs[i]) > 0.75) settle = i * STEP;
    }
    metrics.settleMs = Math.round(settle + STEP - tUp);
    metrics.overshoot = -minOff;
    // speed one frame after lift-off, against the speed the hand had
    const i0 = Math.ceil(tUp / STEP);
    metrics.speedAfter = ((offs[i0 + 1] - offs[i0]) / STEP) * 1000;
    metrics.speedRelease = vRel;
    metrics.speedJump = Math.abs(metrics.speedAfter - vRel);
  }

  /* ---- 4. outcome, explanation, chart ---- */
  const trail: Track['trail'] = A.samples.map((s) => [s.x, s.y, s.t]);
  const claimY = A.claim?.y ?? A.samples[0].y;
  const startY = claimY;
  const marks: Track['marks'] = { startY };
  const dist: [number, number][] = [];
  if (A.claim) for (const s of A.samples) if (s.t >= A.claim.t) dist.push([s.t, s.y - claimY]);
  let outcome: Outcome;
  let explain: string;
  const chart: Chart = { series: [], hlines: [], unit: 'px', ymin: 0, ymax: 100 };

  if (id === 'release-rule') {
    const name = isOld ? 'Old rule' : 'New rule';
    if (v) {
      marks.thrY = claimY + v.threshold;
      marks.relY = claimY + v.distance;
      marks.projY = claimY + v.projected;
      chart.series.push({ cls: 'pull', label: 'pull', pts: dist });
      chart.hlines.push({ v: v.threshold, label: `close line ${px(v.threshold)}` });
      if (!isOld && tau > 0) chart.proj = [[tUp, v.distance], [tUp + Math.min(tau, TAIL), v.projected]];
      outcome = {
        key: v.close ? 'closed' : 'open',
        label: v.close ? 'Closed' : 'Stayed open',
        detail: isOld ? `${px(v.distance)} ${v.close ? '>' : '<'} ${px(v.threshold)}` : `${px(v.distance)} + ${v.velocity.toFixed(2)} × ${tau} ms = ${px(v.projected)} ${v.close ? '>' : '<'} ${px(v.threshold)}`,
      };
      explain = isOld
        ? `${name}: only the distance counts. You let go ${px(v.distance)} down; the line is ${px(v.threshold)} (38% of the sheet). ${v.close ? 'Past it, so it closed.' : 'Short of it, so it stayed open, however fast you were going.'}`
        : v.reason === 'too-short-to-count'
          ? `${name}: you let go after only ${px(v.distance)}, too short to count as a pull, so it stayed open.`
          : `${name}: where was it going? ${px(v.distance)} so far, moving ${v.velocity.toFixed(2)} px/ms ${v.velocity >= 0 ? 'down' : 'up'}, so ${tau} ms later it would be ${px(v.projected)}. The line is ${px(v.threshold)} (35%). ${v.close ? 'Past it, so it closed.' : 'Short of it, so it stayed open.'}`;
    } else {
      outcome = { key: 'open', label: 'Stayed open', detail: 'no pull recognised' };
      explain = `${name}: this was a tap or a sideways move, not a pull, so there is nothing to decide.`;
    }
    chart.ymin = 0;
    chart.ymax = Math.max(60, v?.threshold ?? 0, v?.projected ?? 0, ...dist.map((p) => p[1])) * 1.1;
  } else if (id === 'close-order') {
    const name = isOld ? 'v18.0.4 and earlier' : 'v18.0.5+';
    chart.unit = '';
    chart.ymin = 0;
    chart.ymax = 1;
    chart.series.push(
      { cls: 'hero', label: 'picture', pts: heroAt.map((y, i) => [i * STEP, y] as [number, number]).filter((p) => p[0] >= tUp) },
      { cls: 'text', label: 'text', pts: bodyAt.map((y, i) => [i * STEP, y] as [number, number]).filter((p) => p[0] >= tUp) },
    );
    if (close) {
      outcome = {
        key: 'closed',
        label: 'Closed',
        detail: isOld ? `picture lands ${Math.round(metrics.heroLandMs)} ms, text squashed ×${(1 / metrics.squash).toFixed(2)}` : `picture lands ${Math.round(metrics.heroLandMs)} ms, text gone by ${Math.round(metrics.bodyGoneMs)} ms`,
      };
      explain = isOld
        ? `${name}: the whole sheet shrinks as one piece. The text is squashed on the way down (to ${Math.round((1 / metrics.squash) * 100)}% of its height) and the picture only reaches the card at ${Math.round(metrics.heroLandMs)} ms.`
        : `${name}: the text fades out first (gone by ${Math.round(metrics.bodyGoneMs)} ms) while the picture flies straight to the card, landing at ${Math.round(metrics.heroLandMs)} ms. Nothing is squashed.`;
    } else {
      outcome = { key: 'open', label: 'Stayed open', detail: 'release was below the close line' };
      explain = `This pull was not enough to close the sheet, so there is no closing choreography to compare. Pull further or faster.`;
    }
  } else if (id === 'tap-vs-drag') {
    chart.ymin = 0;
    const travel = A.samples.map((s) => [s.t, Math.hypot(s.x - A.samples[0].x, s.y - A.samples[0].y)] as [number, number]);
    chart.series.push({ cls: 'pull', label: 'finger travel', pts: travel });
    if (!isOld) chart.hlines.push({ v: A.samples.length ? Number(meta.slop) || 10 : 10, label: `slop ${Number(meta.slop) || 10} px` });
    chart.ymax = Math.max(20, ...travel.map((p) => p[1])) * 1.15;
    if (A.tapAt != null && A.scrimTap) {
      const age = typeof meta.scrimAgeMs === 'number' ? meta.scrimAgeMs : 120;
      outcome = scrimClosed
        ? { key: 'closed', label: 'Closed by a ghost click', detail: isOld ? `tap ${age} ms after opening counted` : `tap ${age} ms after opening, grace ${SCRIM_GRACE_MS} ms passed` }
        : { key: 'ignored', label: 'Tap ignored', detail: `${age} ms after opening, inside the ${SCRIM_GRACE_MS} ms grace` };
      explain = scrimClosed
        ? isOld
          ? `v20.0.6 and earlier: any tap on the backdrop closes the sheet, even the echo of the tap that opened it (${age} ms ago). The sheet slams shut right after opening.`
          : `v20.0.7+: a backdrop tap ${age} ms after opening is outside the ${SCRIM_GRACE_MS} ms grace period, so it counts as a real close.`
        : `v20.0.7+: this tap arrived ${age} ms after the sheet opened, inside the ${SCRIM_GRACE_MS} ms grace window. It is the echo of the opening tap, so it is ignored.`;
    } else if (A.rel) {
      outcome = isOld
        ? { key: 'link', label: 'Link fired', detail: link ? 'click leaked after the pull' : 'pull only' }
        : { key: 'swallowed', label: 'Click swallowed', detail: link ? `moved ${px(Math.hypot(A.rel.sample.x - A.samples[0].x, A.rel.sample.y - A.samples[0].y))} (> ${Number(meta.slop) || 10} px slop) = a drag` : 'pull only' };
      explain = link
        ? isOld
          ? `v20.0.5 and earlier: the finger started on the link, dragged the sheet and lifted off still on the link (the sheet moves with the finger), so the browser fired a click. A pull navigated away.`
          : `v20.0.6+: the press moved past the ${Number(meta.slop) || 10} px slop, so it stopped being a tap and became a drag. The click that follows a drag is swallowed once. The link stays quiet.`
        : `The pull did not start on the link, so both rules behave the same here.`;
    } else {
      outcome = link ? { key: 'link', label: 'Link fired', detail: 'a real tap' } : { key: 'open', label: 'Nothing happened', detail: 'tap on empty space' };
      explain = link ? `A tap that moves less than the slop is still a tap, in both rules. The link opens. The new guard does not make taps harder.` : `A tap on empty sheet space does nothing in either rule.`;
    }
  } else {
    // snap-back
    chart.series.push({ cls: 'pull', label: 'sheet offset', pts: offs.map((y, i) => [i * STEP, y] as [number, number]) });
    chart.hlines.push({ v: 0, label: 'home' });
    chart.ymin = Math.min(-20, ...offs);
    chart.ymax = Math.max(40, ...offs) * 1.1;
    if (!close) {
      outcome = {
        key: 'open',
        label: 'Stayed open',
        detail: `hand ${Math.round(vRel)} px/s, next frame ${Math.round(metrics.speedAfter)} px/s, at rest ${Math.round(metrics.settleMs)} ms`,
      };
      explain = isOld
        ? `Legacy prototypes: a fixed ${OLD_SNAP_MS} ms ease-out from where you let go. It ignores how fast the hand was moving: the hand was at ${Math.round(vRel)} px/s, one frame later the sheet is at ${Math.round(metrics.speedAfter)} px/s. That sudden change is the hitch.`
        : `This site: a spring that starts from your release position and your release speed (${Math.round(vRel)} px/s) and then pulls toward home, so the speed builds from what the hand was doing instead of lurching (${Math.round(metrics.speedAfter)} px/s one frame later). It ${metrics.overshoot > 1 ? `overshoots by ${px(metrics.overshoot)} and ` : ''}is at rest in ${Math.round(metrics.settleMs)} ms.`;
    } else {
      outcome = { key: 'closed', label: 'Closed', detail: 'went past the close line' };
      explain = `This pull closed the sheet, so there is no snap-back to compare. Pull less, or let go slowly.`;
    }
  }

  return { decision: id, side, duration, tUp, frames, trail, outcome, explain, chart, marks, metrics };
}

/** what the v20 rule says for each recording at a given tau, next to the old rule (the tunable table) */
export function releaseTable(recs: { id: string; title: string; recording: Pick<Recording, 'meta' | 'samples'> }[], tau: number) {
  return recs.map((r) => {
    const o = simulate('release-rule', 'old', r.recording, tau).outcome;
    const n = simulate('release-rule', 'new', r.recording, tau).outcome;
    return { id: r.id, title: r.title, old: o.key, new: n.key };
  });
}
