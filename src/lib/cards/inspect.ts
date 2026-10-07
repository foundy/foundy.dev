/**
 * The card sheet as an Inspectable (kind 'timeline'). Lives in the lazy Inspect side of the site: it is imported by
 * src/lib/inspect/runtime.ts once the cards chunk has put its handle on the bridge.
 *
 * The visitor's last pull-down is a Recording (raw pointer samples + the decision). This file turns it into
 *   - markers on the generic timeline panel (pointerdown, drag recognised, close line crossed, release, decision),
 *   - a plain-English account of the decision, and developer numbers,
 *   - an SVG overlay drawn in viewport coordinates over the page: the trajectory so far, the release velocity
 *     vector, the projected-travel ghost line, the close line and an outline of the sheet following the finger.
 * The numbers come from replaying the recording through the same pipeline and decision function the sheet used.
 */
import { inspect, registerInspectable, type DetailRow, type InspectTimeline } from '../inspect/core';
import { replay } from '../motion/recorder';
import { SLOP_MOUSE, SLOP_TOUCH, type GestureEvent } from '../motion/gesture';
import { VELOCITY_WINDOW_MS } from '../motion/velocity';
import { CLOSE_FRACTION, MIN_DISTANCE_PX, RUBBER_PX, TAU_MS, decideClose, dragOffset } from './decision';
import type { CardsHandle, PullRecording } from './types';

const TAIL_MS = 240; // room after release for the verdict to land
const NS = 'http://www.w3.org/2000/svg';
const VEC_PX_PER_PXMS = 70; // arrow length per 1 px/ms of release velocity
const px = (n: number) => `${Math.round(n)} px`;

interface Analysis {
  rec: PullRecording;
  base: number;
  claim: { t: number; x: number; y: number } | null;
  tRelease: number;
  release: { x: number; y: number; vx: number; vy: number } | null;
  crossedAt: number | null;
  duration: number;
  markers: NonNullable<InspectTimeline['markers']>;
  summary: string;
  detail: DetailRow[];
}

function analyse(rec: PullRecording): Analysis {
  const ev = replay(rec) as GestureEvent[];
  const slop = ev.find((e) => e.kind === 'slop');
  const rel = ev.find((e) => e.kind === 'release');
  const canc = ev.find((e) => e.kind === 'cancel');
  const last = rec.samples[rec.samples.length - 1];
  const d = rec.decision!;
  const claim = slop ? { t: slop.sample.t, x: slop.sample.x, y: slop.sample.y } : null;
  const base = rel?.kind === 'release' ? d.distance - rel.dy : 0;
  const tRelease = last.t;
  const touch = rec.meta.pointerType === 'touch';

  let crossedAt: number | null = null;
  if (claim) {
    for (const s of rec.samples) {
      if (s.t > claim.t && base + (s.y - claim.y) >= d.threshold) {
        crossedAt = s.t;
        break;
      }
    }
  }
  const verdict = d.cancelled
    ? 'The browser took this gesture over (it fired pointercancel) before you let go, so nothing was decided and the sheet stayed open.'
    : d.reason === 'too-short-to-count'
      ? `You let go after only ${px(d.distance)}, too short to count as a pull (the minimum is ${MIN_DISTANCE_PX} px), so the sheet stayed open.`
      : `You let go after ${px(d.distance)} at ${d.velocity.toFixed(1)} px/ms. Projected travel ${px(d.projected)} is ${d.close ? 'more' : 'less'} than ${Math.round(CLOSE_FRACTION * 100)}% of the sheet (${px(d.threshold)}), so the sheet ${d.close ? 'closed' : 'snapped back open'}.`;
  const oldRule = decideClose({ distance: d.distance, velocity: d.velocity, sheetHeight: d.sheetHeight }, { tau: 0, fraction: 0.38, minDistance: 0 });
  const contrast =
    d.cancelled || d.reason === 'too-short-to-count'
      ? ''
      : ` A distance-only rule, as in the first version, would have ${oldRule.close ? 'closed it' : 'kept it open'}${oldRule.close === d.close ? ' too' : ''}.`;

  const markers: Analysis['markers'] = [
    { at: 0, label: 'Press', explain: `Your ${touch ? 'finger touched' : 'pointer pressed'} the sheet. Nothing has happened yet: a press can still turn out to be a tap.` },
  ];
  if (claim) {
    markers.push({
      at: claim.t,
      label: 'Drag',
      explain: `After ${rec.meta.slop} px of movement the press stopped being a tap. It became a pull because it went down, more up-and-down than sideways, and the sheet was scrolled to the top.`,
    });
  }
  if (crossedAt != null) {
    markers.push({ at: crossedAt, label: 'Close line', explain: `You passed the close line (${px(d.threshold)}, ${Math.round(CLOSE_FRACTION * 100)}% of the sheet). Distance alone would already be enough here; the verdict still waits for release.` });
  }
  if (d.cancelled) {
    markers.push({ at: tRelease, label: 'Cancelled', explain: verdict });
  } else {
    markers.push({
      at: tRelease,
      label: 'Release',
      explain: `You let go. Speed is measured over the last ${VELOCITY_WINDOW_MS} ms before this moment: ${d.velocity.toFixed(2)} px/ms downward, from ${d.samples} pointer samples. Projected travel = ${px(d.distance)} + ${d.velocity.toFixed(2)} × ${TAU_MS} ms = ${px(d.projected)}.`,
    });
    markers.push({
      at: tRelease + TAIL_MS / 2,
      label: 'Verdict',
      explain: `The rule: close if the pull is at least ${MIN_DISTANCE_PX} px and the projected travel passes ${Math.round(CLOSE_FRACTION * 100)}% of the sheet. ${d.close ? 'Yours did' : 'Yours did not'}.${contrast}`,
    });
  }

  const sampleMs = rec.samples.length > 1 ? tRelease / (rec.samples.length - 1) : 0;
  const detail: DetailRow[] = [
    ['Rule', `close if distance ≥ ${MIN_DISTANCE_PX} px and distance + velocity × ${TAU_MS} ms > ${CLOSE_FRACTION} × sheet height`],
    ['Distance', px(d.distance)],
    ['Release velocity', `${d.velocity.toFixed(3)} px/ms (least-squares fit, last ${VELOCITY_WINDOW_MS} ms, ${d.samples} samples)`],
    ['Projected', px(d.projected)],
    ['Close line', `${px(d.threshold)} (${CLOSE_FRACTION} × ${px(d.sheetHeight)} sheet)`],
    ['Verdict', d.cancelled ? 'cancelled by the browser' : `${d.close ? 'close' : 'stay open'} (${d.reason})`],
    ['Pointer', `${rec.meta.pointerType}, slop ${rec.meta.pointerType === 'touch' ? SLOP_TOUCH : SLOP_MOUSE} px`],
    ['Samples', `${rec.samples.length} over ${Math.round(tRelease)} ms${sampleMs ? ` (≈ ${Math.round(1000 / sampleMs)} Hz)` : ''}`],
    ['Rubber band', `above the start the sheet follows a curve that stops at ${RUBBER_PX} px`],
    ['Recording', `schema v${rec.v}, kind ${rec.kind}; replay() gives the same events`],
  ];

  return {
    rec,
    base,
    claim,
    tRelease,
    release: rel?.kind === 'release' ? { x: rel.sample.x, y: rel.sample.y, vx: rel.vx, vy: rel.vy } : null,
    crossedAt,
    duration: tRelease + TAIL_MS,
    markers,
    summary: verdict,
    detail,
  };
}

const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (text != null) e.textContent = text;
  return e;
};

export function registerCardsInspectable(h: CardsHandle): () => void {
  let A: Analysis | null = null;
  const setRec = () => {
    const r = h.recording();
    A = r && r.decision ? analyse(r) : null;
  };
  setRec();

  const timeline: InspectTimeline = {
    get duration() {
      return A?.duration ?? 0;
    },
    get markers() {
      return A?.markers;
    },
    get summary() {
      return A?.summary;
    },
    emptyHint:
      'Nothing recorded yet. Open a card and pull the sheet down from its top edge: slowly once, and once as a quick flick. Then come back here to replay what you did and see why it closed, or did not.',
    detail: () =>
      A?.detail ?? [
        ['Rule', `close if distance + velocity × ${TAU_MS} ms > ${CLOSE_FRACTION} × sheet height`],
      ],
  };

  /* ---------- overlay ---------- */
  const o = h.overlay;
  const layer = o.closest<HTMLElement>('[data-cards-layer]');
  let parts: {
    ghost: SVGRectElement;
    thr: SVGGElement;
    traj: SVGPolylineElement;
    trajHalo: SVGPolylineElement;
    dot: SVGCircleElement;
    start: SVGCircleElement;
    vec: SVGGElement;
    proj: SVGGElement;
    tag: SVGTextElement;
  } | null = null;

  const halo = (shape: SVGElement) => {
    const h2 = shape.cloneNode(true) as SVGElement;
    h2.setAttribute('class', `${shape.getAttribute('class')} halo`);
    return h2;
  };

  function build() {
    o.replaceChildren();
    parts = null;
    if (!A || !A.claim) return;
    const { rec, claim } = A;
    const d = rec.decision!;
    const r = rec.meta.sheetRect;
    const ghost = svg('rect', { class: 'ov-ghost', x: r.x, y: r.y, width: r.w, height: r.h, rx: 10 });
    const lineY = claim.y + d.threshold - A.base;
    const thr = svg('g', { class: 'ov-thr' });
    const l = svg('line', { x1: Math.max(0, r.x - 24), x2: Math.min(innerWidth, r.x + r.w + 24), y1: lineY, y2: lineY, class: 'ov-line' });
    thr.append(halo(l), l, svg('text', { x: Math.max(8, r.x), y: lineY - 6, class: 'ov-text' }, `close line · ${px(d.threshold)}`));
    const trajHalo = svg('polyline', { class: 'ov-traj halo', fill: 'none' });
    const traj = svg('polyline', { class: 'ov-traj', fill: 'none' });
    const start = svg('circle', { class: 'ov-pt', r: 4, cx: rec.samples[0].x, cy: rec.samples[0].y });
    const dot = svg('circle', { class: 'ov-dot', r: 7 });
    const vec = svg('g', { class: 'ov-vec' });
    const proj = svg('g', { class: `ov-proj ${d.close ? 'is-close' : 'is-stay'}` });
    const tag = svg('text', { class: 'ov-text ov-verdict' });
    o.append(ghost, thr, proj, trajHalo, traj, start, vec, dot, tag);
    parts = { ghost, thr, traj, trajHalo, dot, start, vec, proj, tag };
  }

  function draw(t: number) {
    if (!A || !parts || !A.claim) return;
    const { rec, claim, release } = A;
    const d = rec.decision!;
    const P = parts;
    const pts: string[] = [];
    let cx = rec.samples[0].x;
    let cy = rec.samples[0].y;
    for (let i = 0; i < rec.samples.length; i++) {
      const s = rec.samples[i];
      if (s.t <= t) {
        pts.push(`${s.x.toFixed(1)},${s.y.toFixed(1)}`);
        cx = s.x;
        cy = s.y;
      } else {
        const p = rec.samples[i - 1];
        if (p) {
          const f = (t - p.t) / Math.max(1e-6, s.t - p.t);
          cx = p.x + (s.x - p.x) * f;
          cy = p.y + (s.y - p.y) * f;
          pts.push(`${cx.toFixed(1)},${cy.toFixed(1)}`);
        }
        break;
      }
    }
    const poly = pts.join(' ');
    P.traj.setAttribute('points', poly);
    P.trajHalo.setAttribute('points', poly);
    P.dot.setAttribute('cx', String(cx));
    P.dot.setAttribute('cy', String(cy));
    // the sheet outline follows the same curve the real sheet did
    const off = t >= claim.t ? dragOffset(A.base + (cy - claim.y)) : 0;
    P.ghost.setAttribute('transform', `translate(0 ${off.toFixed(1)})`);

    const done = t >= A.tRelease && release;
    P.vec.replaceChildren();
    P.proj.replaceChildren();
    P.tag.textContent = '';
    if (done && release) {
      const len = Math.hypot(release.vx, release.vy) * VEC_PX_PER_PXMS;
      if (len > 2) {
        const k = Math.min(len, 220) / len;
        const x2 = release.x + release.vx * VEC_PX_PER_PXMS * k;
        const y2 = release.y + release.vy * VEC_PX_PER_PXMS * k;
        const ang = Math.atan2(y2 - release.y, x2 - release.x);
        const head = `M${x2 - 9 * Math.cos(ang - 0.45)} ${y2 - 9 * Math.sin(ang - 0.45)}L${x2} ${y2}L${x2 - 9 * Math.cos(ang + 0.45)} ${y2 - 9 * Math.sin(ang + 0.45)}`;
        const ln = svg('line', { x1: release.x, y1: release.y, x2, y2, class: 'ov-line ov-vecline' });
        const hd = svg('path', { d: head, class: 'ov-line ov-vecline', fill: 'none' });
        P.vec.append(halo(ln), ln, halo(hd), hd, svg('text', { x: x2 + 8, y: y2 + 4, class: 'ov-text' }, `${d.velocity.toFixed(1)} px/ms`));
      }
      // projected travel: from where the pull started, straight down to where it was heading
      const x = release.x + 18;
      const y0 = claim.y - A.base;
      const y1 = y0 + d.projected;
      const yr = y0 + d.distance;
      const solid = svg('line', { x1: x, x2: x, y1: y0, y2: yr, class: 'ov-line ov-travel' });
      const ghostLine = svg('line', { x1: x, x2: x, y1: yr, y2: y1, class: 'ov-line ov-projline' });
      const end = svg('circle', { cx: x, cy: y1, r: 5, class: 'ov-pt ov-projend' });
      P.proj.append(halo(solid), solid, halo(ghostLine), ghostLine, end, svg('text', { x: x + 10, y: y1 + 4, class: 'ov-text' }, `projected ${px(d.projected)}`));
      if (t >= A.tRelease + TAIL_MS / 2 - 1 && !d.cancelled) {
        P.tag.setAttribute('x', String(Math.max(12, release.x - 96)));
        P.tag.setAttribute('y', String(Math.max(24, claim.y - A.base - 14)));
        P.tag.textContent = d.close ? 'CLOSE' : 'STAY OPEN';
        P.tag.setAttribute('class', `ov-text ov-verdict ${d.close ? 'is-close' : 'is-stay'}`);
      }
    }
  }

  /* ---------- dock height: the sheet gives way to the panel ---------- */
  let ro: ResizeObserver | undefined;
  const dockH = () => layer?.style.setProperty('--dock-h', `${h.dock.offsetHeight}px`);

  const unreg = registerInspectable({
    id: 'cards',
    title: 'Card sheet',
    element: h.dock,
    kind: 'timeline',
    timeline,
    get initialScrub() {
      return A?.duration ?? 0;
    },
    context: () => h.isOpen() || (inspect.active?.id === 'cards' && !!A),
    onEnter() {
      o.style.display = A ? 'block' : 'none';
      build();
      draw(A?.duration ?? 0);
      ro = new ResizeObserver(dockH);
      ro.observe(h.dock);
    },
    onExit() {
      o.style.display = 'none';
      o.replaceChildren();
      ro?.disconnect();
      layer?.style.removeProperty('--dock-h');
    },
    onScrub(t) {
      draw(t);
    },
  });

  const off = h.on((e) => {
    if (e === 'recording') {
      setRec();
      if (inspect.active?.id === 'cards') {
        o.style.display = A ? 'block' : 'none';
        build();
        inspect.notifyTimeline();
      } else inspect.refresh();
    } else inspect.refresh();
  });

  return () => {
    off();
    unreg();
  };
}
