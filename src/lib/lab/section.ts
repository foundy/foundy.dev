/**
 * Lab comparison, live half. The page ships each decision as a static, annotated diagram (see ./stage); this module
 * is lazy-loaded when the section scrolls into view and turns it into a replay:
 *   - one clock `t` drives both sides (the same recording, two rules); play/pause, a scrubber, a recording selector,
 *   - "Your turn": drag on either stage to record your own gesture (Pointer Events via ../motion), replayed into both,
 *   - the one tunable (look-ahead τ of the projected-velocity rule) with a live table of all recordings.
 * Reduced motion: replays jump to the final state; the trajectory stays drawn, so the comparison still reads.
 */
import { bindPointerGesture, SLOP_MOUSE, SLOP_TOUCH } from '../motion/gesture';
import { GestureRecorder, parseRecording, type Recording } from '../motion/recorder';
import { TAU_MS } from '../cards/decision';
import { SHEET, VIEW, releaseTable, simulate, type DecisionId, type Side, type Track } from './rules';
import { chartMarkup, paintChart, paintStage, stageMarkup, tauTableRows } from './stage';
const TAU = { min: 0, max: 200, step: 5 };

interface Rec {
  id: string;
  title: string;
  note: string;
  recording: Recording;
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const fmt = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

export async function mountSection(root: HTMLElement) {
  const id = root.dataset.lab as DecisionId;
  const dec = { oldName: root.dataset.oldName ?? 'Old', newName: root.dataset.newName ?? 'New', tryIt: root.dataset.try ?? '' };
  let set: { recordings: Rec[] };
  try {
    set = await (await fetch(`/lab/data/${id}.json`)).json();
    for (const r of set.recordings) parseRecording(JSON.stringify(r.recording));
  } catch {
    return; // the static diagram stays; nothing to hydrate
  }
  const recs: Rec[] = set.recordings.slice();
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  const sides = (['old', 'new'] as Side[]).map((side) => {
    const fig = root.querySelector<HTMLElement>(`[data-side="${side}"]`)!;
    return {
      side,
      fig,
      hit: fig.querySelector<HTMLElement>('[data-hit]')!,
      chart: fig.querySelector<HTMLElement>('[data-chart]')!,
      badge: fig.querySelector<HTMLElement>('[data-badge]')!,
      detail: fig.querySelector<HTMLElement>('[data-detail]')!,
      why: fig.querySelector<HTMLElement>('[data-why]')!,
      track: null as unknown as Track,
    };
  });
  const tunable = id === 'release-rule';
  let idx = 0;
  let tau = TAU_MS;
  let t = 0;
  let dur = 0;
  let playing = false;
  let raf = 0;
  let announceTimer = 0;

  /* ---------- controls ---------- */
  const ui = root.querySelector<HTMLElement>('[data-ui]')!;
  const chips = h('div', 'lab-chips');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', 'Recorded gesture');
  const play = h('button', 'lab-btn lab-play', 'Play');
  play.type = 'button';
  const scrub = h('input', 'lab-range lab-scrub');
  scrub.type = 'range';
  scrub.min = '0';
  scrub.step = '1';
  scrub.setAttribute('aria-label', 'Replay time, both sides');
  const time = h('span', 'lab-time mono');
  time.setAttribute('aria-hidden', 'true');
  const row = h('div', 'lab-row');
  row.append(play, scrub, time);
  const hint = h('p', 'lab-hint');
  hint.append(h('strong', undefined, 'Your turn. '), document.createTextNode(`Drag on either phone to record your own gesture; both rules replay it. ${dec.tryIt}`));
  const live = h('p', 'visually-hidden');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  ui.replaceChildren(chips, hint, live);
  ui.classList.add('on');
  // play + scrubber live in their own bar: pinned to the top on narrow screens while you scroll between the two stacked phones
  const bar = h('div', 'lab-bar');
  bar.append(row);
  ui.after(bar);

  const renderChips = () => {
    chips.replaceChildren(
      ...recs.map((r, i) => {
        const b = h('button', 'lab-chip', r.title);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(i === idx));
        b.title = r.note;
        b.addEventListener('click', () => select(i, true));
        return b;
      }),
    );
  };

  /* ---------- tunable ---------- */
  let tauInput: HTMLInputElement | null = null;
  let tauOut: HTMLOutputElement | null = null;
  let tauReset: HTMLButtonElement | null = null;
  let tauBody: HTMLElement | null = null;
  if (tunable) {
    const box = root.querySelector<HTMLElement>('[data-tau]')!;
    tauBody = box.querySelector<HTMLElement>('tbody')!;
    const wrap = box.querySelector<HTMLElement>('[data-tau-ui]')!;
    const label = h('label', 'lab-tau-label');
    label.htmlFor = `tau-${id}`;
    label.textContent = 'Look-ahead τ (ms)';
    tauInput = h('input', 'lab-range');
    tauInput.type = 'range';
    tauInput.id = `tau-${id}`;
    tauInput.min = String(TAU.min);
    tauInput.max = String(TAU.max);
    tauInput.step = String(TAU.step);
    tauInput.value = String(TAU_MS);
    tauOut = h('output', 'mono lab-tau-out', `${TAU_MS} ms`);
    tauOut.htmlFor = tauInput.id;
    tauReset = h('button', 'lab-btn', 'Reset to shipped (80 ms)');
    tauReset.type = 'button';
    tauReset.disabled = true;
    wrap.replaceChildren(label, tauInput, tauOut, tauReset);
    const set_ = (v: number) => {
      tau = v;
      tauInput!.value = String(v);
      tauOut!.textContent = `${v} ms`;
      tauReset!.disabled = v === TAU_MS;
      root.dataset.labTau = String(v);
      compute();
      render(t);
      tauTable();
      clearTimeout(announceTimer);
      announceTimer = window.setTimeout(() => announce(), 450);
    };
    tauInput.addEventListener('input', () => set_(Number(tauInput!.value)));
    tauReset.addEventListener('click', () => set_(TAU_MS));
  }
  const tauTable = () => {
    if (tauBody) tauBody.innerHTML = tauTableRows(releaseTable(recs, tau));
  };

  /* ---------- rendering ---------- */
  function compute() {
    const rec = recs[idx].recording;
    for (const s of sides) s.track = simulate(id, s.side, rec, tau);
    dur = sides[0].track.duration;
    scrub.max = String(Math.round(dur));
  }
  function mountMarkup() {
    const names = { old: dec.oldName, new: dec.newName };
    for (const s of sides) {
      s.hit.innerHTML = stageMarkup(s.track, 0, names[s.side]);
      s.chart.innerHTML = chartMarkup(s.track);
      s.why.textContent = s.track.explain;
      s.badge.dataset.key = '';
    }
  }
  function render(ms: number) {
    t = Math.min(Math.max(ms, 0), dur);
    for (const s of sides) {
      paintStage(s.hit, s.track, t);
      paintChart(s.chart, s.track, t);
      const key = t >= s.track.tUp ? s.track.outcome.key : 'wait';
      if (s.badge.dataset.key !== key) {
        s.badge.dataset.key = key;
        s.badge.textContent = key === 'wait' ? 'Deciding…' : s.track.outcome.label;
        s.detail.textContent = key === 'wait' ? '' : s.track.outcome.detail;
      }
    }
    scrub.value = String(Math.round(t));
    scrub.setAttribute('aria-valuetext', `${fmt(t)} of ${fmt(dur)}`);
    time.textContent = `${fmt(t)} / ${fmt(dur)}`;
    root.dataset.labT = String(Math.round(t));
    play.textContent = playing ? 'Pause' : t >= dur ? 'Replay' : 'Play';
  }
  function announce() {
    const [o, n] = sides.map((s) => s.track.outcome.label);
    const msg = `${dec.oldName}: ${o}. ${dec.newName}: ${n}.`;
    live.textContent = '';
    requestAnimationFrame(() => (live.textContent = msg));
  }
  function stop() {
    cancelAnimationFrame(raf);
    playing = false;
    root.dataset.labPlaying = '0';
  }
  function start() {
    if (mq.matches) {
      stop();
      render(dur);
      announce();
      return;
    }
    if (t >= dur) t = 0;
    playing = true;
    root.dataset.labPlaying = '1';
    let last = performance.now();
    const frame = (now: number) => {
      render(t + Math.min(now - last, 50));
      last = now;
      if (t >= dur) {
        stop();
        render(dur);
        announce();
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    render(t);
    raf = requestAnimationFrame(frame);
  }
  function select(i: number, autoplay: boolean) {
    stop();
    idx = i;
    root.dataset.labRec = recs[i].id;
    compute();
    mountMarkup();
    renderChips();
    t = 0;
    render(0);
    tauTable();
    if (autoplay) start();
    else if (mq.matches) render(dur);
  }

  play.addEventListener('click', () => (playing ? (stop(), render(t)) : start()));
  scrub.addEventListener('input', () => {
    stop();
    render(Number(scrub.value));
  });

  /* ---------- your turn ---------- */
  const recorder = new GestureRecorder();
  for (const s of sides) {
    const svg = () => s.hit.querySelector('svg') as SVGSVGElement;
    let k = 1;
    let rect: DOMRect;
    bindPointerGesture(s.hit, {
      config(e) {
        rect = svg().getBoundingClientRect();
        k = VIEW.w / rect.width;
        return { slop: e.pointerType === 'touch' ? SLOP_TOUCH : SLOP_MOUSE, claim: ({ axis, dy }) => axis === 'y' && dy > 0 };
      },
      onSample(sm, { pointerType }) {
        const x = Math.round((sm.x - rect.left) * k * 10) / 10;
        const y = Math.round((sm.y - rect.top) * k * 10) / 10;
        if (sm.type === 'down') {
          const meta: Recording['meta'] = {
            pointerType,
            slop: Math.round((pointerType === 'touch' ? SLOP_TOUCH : SLOP_MOUSE) * k),
            sheetHeight: SHEET.h,
            sheetRect: SHEET,
          };
          if (id === 'tap-vs-drag' && y < SHEET.y) meta.scrimAgeMs = 120;
          recorder.begin('sheet-pull', meta);
        }
        recorder.add({ ...sm, x, y });
        if (sm.type === 'cancel') recorder.discard();
        if (sm.type === 'up') {
          const r = recorder.finish();
          if (r && r.samples.length >= 2) {
            const mine: Rec = { id: 'yours', title: 'Yours', note: 'Your own gesture, replayed on both rules.', recording: r };
            const at = recs.findIndex((q) => q.id === 'yours');
            if (at >= 0) recs[at] = mine;
            else recs.push(mine);
            select(recs.findIndex((q) => q.id === 'yours'), true);
          }
        }
      },
      onEvent() {},
    });
  }
  mq.addEventListener('change', () => {
    if (mq.matches && playing) {
      stop();
      render(dur);
    }
  });

  root.dataset.labReady = '1';
  select(0, !mq.matches);
}
