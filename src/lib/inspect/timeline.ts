/**
 * Generic UI for a 'timeline' inspectable: a recorded interaction you can scrub and replay.
 *   - nothing recorded: an invitation (`timeline.emptyHint`)
 *   - recorded: play/replay + a labelled scrubber with ticks at the markers, one stop per marker, the plain-English
 *     summary of the whole recording, the explanation of the marker you are at (the only aria-live region), and a
 *     Details disclosure with developer numbers.
 * Drawing on the page (the trajectory overlay) is the inspectable's own job, driven by its `onScrub`.
 */
import { inspect, type DetailRow, type Inspectable } from './core';
import { el } from './panel';

const fmtS = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

export function mountTimelinePanel(i: Inspectable): () => void {
  const root = el('div', 'inspect-panel');
  root.dataset.inspectPanel = i.id;
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', `Inspect: ${i.title}`);
  i.element.append(root);

  let raf = 0;
  let playing = false;
  let stopPlay = () => {};
  let paint = () => {};

  function build() {
    stopPlay();
    const tl = i.timeline;
    const dur = tl?.duration ?? 0;
    const head = el('p', 'inspect-head label', `Inspect · ${i.title}`);
    if (!tl || dur <= 0) {
      root.replaceChildren(head, el('p', 'inspect-body inspect-empty', tl?.emptyHint ?? 'Nothing recorded yet.'));
      paint = () => {};
      return;
    }
    const markers = tl.markers ?? [];

    const controls = el('div', 'inspect-controls inspect-timeline');
    const play = el('button', 'inspect-step inspect-play', '▶');
    play.type = 'button';
    play.setAttribute('aria-label', 'Replay gesture');
    const range = el('input', 'inspect-range');
    range.type = 'range';
    range.min = '0';
    range.max = String(Math.round(dur));
    range.step = '1';
    range.setAttribute('aria-label', `${i.title} timeline`);
    const ticks = el('div', 'inspect-ticks');
    ticks.setAttribute('aria-hidden', 'true');
    for (const m of markers) {
      const t = el('span', 'inspect-tick');
      t.style.setProperty('--at', String(m.at / dur));
      ticks.append(t);
    }
    const stops = el('ol', 'inspect-stops inspect-marks');
    stops.style.gridTemplateColumns = `repeat(${Math.max(1, markers.length)}, 1fr)`;
    const stopBtns = markers.map((m, k) => {
      const li = el('li');
      const b = el('button', 'inspect-stop');
      b.type = 'button';
      b.append(el('span', 'inspect-n', String(k + 1).padStart(2, '0')), el('span', undefined, m.label));
      b.addEventListener('click', () => {
        stopPlay();
        inspect.setScrub(m.at);
      });
      li.append(b);
      stops.append(li);
      return b;
    });
    const track = el('div', 'inspect-track');
    const rangeWrap = el('div', 'inspect-rangewrap');
    rangeWrap.append(range, ticks);
    track.append(rangeWrap, stops);
    const time = el('span', 'inspect-time mono');
    time.setAttribute('aria-hidden', 'true');
    controls.append(play, track, time);

    const col = el('div', 'inspect-col');
    const summary = el('p', 'inspect-summary', tl.summary ?? '');
    const live = el('div', 'inspect-explain');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    const title = el('p', 'inspect-title');
    const body = el('p', 'inspect-body');
    live.append(title, body);
    col.append(summary, live);

    const details = el('details', 'inspect-details');
    const dl = el('dl', 'inspect-dl');
    const rows: DetailRow[] = tl.detail?.() ?? [];
    dl.replaceChildren(
      ...rows.map(([a, b]) => {
        const d = el('div');
        d.append(el('dt', undefined, a), el('dd', undefined, b));
        return d;
      }),
    );
    details.append(el('summary', undefined, 'Details for developers'), dl);

    root.replaceChildren(head, controls, col, details);

    let shown = -2;
    paint = () => {
      const t = inspect.scrub;
      range.value = String(Math.round(t));
      range.setAttribute('aria-valuetext', `${fmtS(t)} of ${fmtS(dur)}`);
      range.style.setProperty('--p', String(t / dur));
      time.textContent = `${fmtS(t)} / ${fmtS(dur)}`;
      let k = -1;
      markers.forEach((m, idx) => {
        if (m.at <= t + 0.5) k = idx;
      });
      stopBtns.forEach((b, idx) => b.toggleAttribute('data-on', idx === k));
      if (k !== shown) {
        shown = k;
        const m = markers[k];
        title.textContent = m ? `${k + 1} of ${markers.length} · ${m.label}` : 'Before the first marker';
        body.textContent = m?.explain ?? '';
      }
    };

    const setPlaying = (on: boolean) => {
      playing = on;
      play.textContent = on ? '❚❚' : inspect.scrub >= dur ? '↺' : '▶';
      play.setAttribute('aria-label', on ? 'Pause' : 'Replay gesture');
    };
    stopPlay = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      if (playing) setPlaying(false);
    };
    play.addEventListener('click', () => {
      if (playing) return stopPlay();
      if (inspect.scrub >= dur - 1) inspect.setScrub(0);
      tl.replay?.();
      setPlaying(true);
      let last = performance.now();
      const frame = (now: number) => {
        const next = inspect.scrub + Math.min(now - last, 50);
        last = now;
        inspect.setScrub(Math.min(next, dur));
        if (next >= dur) {
          setPlaying(false);
          raf = 0;
          return;
        }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    });
    range.addEventListener('input', () => {
      stopPlay();
      inspect.setScrub(Number(range.value));
    });
    setPlaying(false);
    paint();
  }

  build();
  const offScrub = inspect.subscribe('scrub', () => paint());
  const offTl = inspect.subscribe('timeline', () => {
    build();
  });
  return () => {
    stopPlay();
    offScrub();
    offTl();
    root.remove();
  };
}
