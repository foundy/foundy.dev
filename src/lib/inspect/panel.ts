/**
 * Generic UI for a 'stages' inspectable: a labelled scrubber (range + stops + prev/next), the plain-English
 * explanation of the current stage (the only aria-live region), and a Details disclosure with developer numbers.
 * Everything here is driven by the Inspectable, so the card study can reuse it as is.
 */
import { inspect, type DetailRow, type Inspectable } from './core';

const DETAIL_MS = 250; // developer numbers refresh at most 4x/s, and only while Details is open

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export function mountStagesPanel(i: Inspectable): () => void {
  const stages = i.stages ?? [];
  const n = stages.length;
  const root = el('div', 'inspect-panel');
  root.dataset.inspectPanel = i.id;
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', `Inspect: ${i.title}`);

  const head = el('p', 'inspect-head label', `Inspect · ${i.title}`);

  const controls = el('div', 'inspect-controls');
  const prev = el('button', 'inspect-step', '←');
  const next = el('button', 'inspect-step', '→');
  prev.type = next.type = 'button';
  prev.setAttribute('aria-label', 'Previous stage');
  next.setAttribute('aria-label', 'Next stage');
  const range = el('input', 'inspect-range');
  range.type = 'range';
  range.min = '0';
  range.max = String(n - 1);
  range.step = '1';
  range.setAttribute('aria-label', `${i.title} stage`);
  const track = el('div', 'inspect-track');
  const stops = el('ol', 'inspect-stops');
  stops.setAttribute('aria-hidden', 'true'); // the range, prev and next already cover keyboard and screen readers
  const stopBtns = stages.map((s, k) => {
    const li = el('li');
    const b = el('button', 'inspect-stop');
    b.type = 'button';
    b.tabIndex = -1;
    b.append(el('span', 'inspect-n', String(k + 1).padStart(2, '0')), el('span', undefined, s.label));
    b.addEventListener('click', () => inspect.setScrub(k));
    li.append(b);
    stops.append(li);
    return b;
  });
  track.append(range, stops);
  controls.append(prev, track, next);

  const live = el('div', 'inspect-explain');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  const title = el('p', 'inspect-title');
  const body = el('p', 'inspect-body');
  live.append(title, body);

  const details = el('details', 'inspect-details');
  const sum = el('summary', undefined, 'Details for developers');
  const dl = el('dl', 'inspect-dl');
  details.append(sum, dl);

  root.append(head, controls, live, details);
  i.element.append(root);

  let shownStage = -1;
  let keys = '';
  const paintDetails = () => {
    const s = stages[inspect.scrub];
    const rows: DetailRow[] = s?.detail?.() ?? [];
    const k = `${shownStage}|${rows.map((r) => r[0]).join('|')}`;
    if (k !== keys) {
      keys = k;
      dl.replaceChildren(
        ...rows.map(([a, b]) => {
          const d = el('div');
          d.append(el('dt', undefined, a), el('dd', undefined, b));
          return d;
        }),
      );
    } else {
      rows.forEach((r, idx) => {
        const dd = dl.children[idx]?.lastChild as HTMLElement | undefined;
        if (dd && dd.textContent !== r[1]) dd.textContent = r[1];
      });
    }
  };
  let timer = 0;
  const syncTimer = () => {
    clearInterval(timer);
    timer = 0;
    if (details.open) {
      paintDetails();
      timer = window.setInterval(() => document.visibilityState === 'visible' && paintDetails(), DETAIL_MS);
    }
  };
  details.addEventListener('toggle', syncTimer);

  const paint = () => {
    const k = inspect.scrub;
    const s = stages[k];
    if (!s) return;
    range.value = String(k);
    range.setAttribute('aria-valuetext', `${k + 1} of ${n}, ${s.label}`);
    range.style.setProperty('--p', n > 1 ? String(k / (n - 1)) : '0');
    prev.disabled = k === 0;
    next.disabled = k === n - 1;
    stopBtns.forEach((b, idx) => b.toggleAttribute('data-on', idx === k));
    if (shownStage !== k) {
      shownStage = k;
      title.textContent = `${k + 1} of ${n} · ${s.label}`;
      body.textContent = s.explain;
      if (details.open) paintDetails();
    }
  };
  paint();

  range.addEventListener('input', () => inspect.setScrub(Number(range.value)));
  prev.addEventListener('click', () => inspect.setScrub(inspect.scrub - 1));
  next.addEventListener('click', () => inspect.setScrub(inspect.scrub + 1));
  const off = inspect.subscribe('scrub', paint);

  return () => {
    off();
    clearInterval(timer);
    root.remove();
  };
}
