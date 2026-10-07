/**
 * Lab mini stage: SVG markup for one side of a comparison (a phone-shaped viewport with the sheet, the card it closes
 * into, the finger trail and the decision overlay) and the chart under it, plus `paintStage()` which moves it to the
 * frame at time t.
 *
 * The same functions run at build time (the page ships the final frame as a static, annotated diagram: no JS needed)
 * and in the browser (the live replay), so the two can never drift apart. All numbers come from a Track (./rules).
 */
import { HERO, LINK, SHEET, SLOT, VIEW, morph, STEP, type Chart, type Frame, type Track } from './rules';

const f = (n: number) => (Math.round(n * 100) / 100).toString();
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function frameAt(t: Track, ms: number): Frame {
  return t.frames[Math.min(t.frames.length - 1, Math.max(0, Math.round(ms / STEP)))];
}

/** attribute values for the animated parts at one frame (shared by the string builder and the live painter) */
function attrs(t: Track, fr: Frame) {
  const sh = morph(SHEET, fr.off, fr.sp);
  const he = morph(HERO, fr.off, fr.ph);
  const tf = (m: ReturnType<typeof morph>) => `translate(${f(m.tx)} ${f(m.ty)}) scale(${f(m.sx)} ${f(m.sy)})`;
  const pts = t.trail
    .slice(0, fr.ti)
    .map((p) => `${f(p[0])},${f(p[1])}`)
    .join(' ');
  return {
    sheet: { transform: tf(sh) },
    hero: { transform: tf(he) },
    bg: { opacity: f(fr.bg) },
    body: { opacity: f(fr.body) },
    scrim: { opacity: f(fr.scrim) },
    live: { points: pts },
    finger: { cx: f(fr.fx), cy: f(fr.fy), opacity: fr.finger ? '1' : '0' },
    link: { 'data-link': String(fr.link) },
  };
}

const ser = (o: Record<string, string>) =>
  Object.entries(o)
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join('');

export function stageMarkup(t: Track, ms: number, name: string): string {
  const fr = frameAt(t, ms);
  const a = attrs(t, fr);
  const m = t.marks;
  const x0 = t.trail[0][0];
  const all = t.trail.map((p) => `${f(p[0])},${f(p[1])}`).join(' ');
  const lines = [270, 300, 330, 360, 390, 420].map((y, i) => `<rect class="st-line" x="32" y="${y}" width="${i % 3 === 2 ? 190 : 326}" height="10" rx="5"/>`).join('');
  let ov = '';
  if (m.thrY != null) {
    ov += `<line class="st-thr" x1="0" x2="${VIEW.w}" y1="${f(m.thrY)}" y2="${f(m.thrY)}"/><text class="st-note" x="12" y="${f(m.thrY - 8)}">close line</text>`;
  }
  if (m.relY != null && m.projY != null && Math.abs(m.projY - m.relY) > 4) {
    ov += `<line class="st-proj" x1="${f(x0)}" x2="${f(x0)}" y1="${f(m.relY)}" y2="${f(m.projY)}"/><circle class="st-projdot" cx="${f(x0)}" cy="${f(m.projY)}" r="7"/>`;
  }
  const slot = `<g class="st-slot"><rect x="${SLOT.x}" y="${SLOT.y}" width="${SLOT.w}" height="${SLOT.h}" rx="16"/><text class="st-note" x="${SLOT.x + 16}" y="${SLOT.y - 10}">card</text></g>`;
  return (
    `<svg class="st" viewBox="0 0 ${VIEW.w} ${VIEW.h}" role="img" aria-label="${esc(name)}: final state, ${esc(t.outcome.label)}" focusable="false">` +
    `<rect class="st-page" width="${VIEW.w}" height="${VIEW.h}"/>${slot}` +
    `<rect data-r="scrim" class="st-scrim" width="${VIEW.w}" height="${VIEW.h}"${ser(a.scrim)}/>` +
    `<g data-r="sheet"${ser(a.sheet)}><rect data-r="bg" class="st-bg" x="${SHEET.x}" y="${SHEET.y}" width="${SHEET.w}" height="${SHEET.h}" rx="22"${ser(a.bg)}/>` +
    `<g data-r="body"${ser(a.body)}>${lines}<g data-r="link" class="st-link"${ser(a.link)}><rect x="${LINK.x}" y="${LINK.y}" width="${LINK.w}" height="${LINK.h}" rx="12"/><text x="${LINK.x + 18}" y="${LINK.y + 35}">Read more →</text></g></g></g>` +
    `<g data-r="hero"${ser(a.hero)}><rect class="st-hero" x="${HERO.x}" y="${HERO.y}" width="${HERO.w}" height="${HERO.h}" rx="22"/><path class="st-heroart" d="M40 ${HERO.y + 150} Q 120 ${HERO.y + 40} 200 ${HERO.y + 110} T 350 ${HERO.y + 70}"/></g>` +
    `<polyline class="st-trail" points="${all}"/><polyline data-r="live" class="st-live"${ser(a.live)}/>` +
    ov +
    `<circle class="st-start" cx="${f(x0)}" cy="${f(t.trail[0][1])}" r="6"/>` +
    `<circle data-r="finger" class="st-finger" r="18"${ser(a.finger)}/>` +
    `</svg>`
  );
}

export function paintStage(root: Element, t: Track, ms: number) {
  const a = attrs(t, frameAt(t, ms));
  for (const [role, set] of Object.entries(a)) {
    const el = root.querySelector(`[data-r="${role}"]`);
    if (el) for (const [k, v] of Object.entries(set)) el.setAttribute(k, v);
  }
}

/** the tunable's table: what each rule says for every recording (rows differ where the two rules disagree) */
export function tauTableRows(rows: { id: string; title: string; old: string; new: string }[]): string {
  const word = (k: string) => (k === 'closed' ? 'Closed' : 'Stayed open');
  return rows
    .map((r) => `<tr${r.old !== r.new ? ' data-diff' : ''}><th scope="row">${esc(r.title)}</th><td data-key="${r.old}">${word(r.old)}</td><td data-key="${r.new}">${word(r.new)}</td></tr>`)
    .join('');
}

/* ---------------- chart ---------------- */

const CH = { w: 390, h: 184, l: 44, r: 12, t: 34, b: 26 };
const GLYPH = 7.9; // advance of the 13 px mono face in the chart, for label boxes (no layout pass at build time)

export function chartMarkup(t: Track): string {
  const c: Chart = t.chart;
  const X = (ms: number) => CH.l + (ms / t.duration) * (CH.w - CH.l - CH.r);
  const Y = (v: number) => CH.t + (1 - (v - c.ymin) / (c.ymax - c.ymin || 1)) * (CH.h - CH.t - CH.b);
  const pl = (pts: [number, number][]) => pts.map((p) => `${f(X(p[0]))},${f(Y(p[1]))}`).join(' ');
  const base = CH.h - CH.b;
  let s = `<svg class="ch" viewBox="0 0 ${CH.w} ${CH.h}" aria-hidden="true" focusable="false">`;
  s += `<line class="ch-axis" x1="${CH.l}" x2="${CH.w - CH.r}" y1="${base}" y2="${base}"/><line class="ch-axis" x1="${CH.l}" x2="${CH.l}" y1="${CH.t}" y2="${base}"/>`;
  // lanes: the legend owns the band above the plot, tick labels and "release" share the band under it, the y labels sit left of the axis
  const endLbl = `${Math.round(t.duration)} ms`;
  s += `<text class="ch-txt" x="${CH.l}" y="${CH.h - 8}" text-anchor="middle">0</text><text class="ch-txt" x="${CH.w - CH.r}" y="${CH.h - 8}" text-anchor="end">${endLbl}</text>`;
  s += `<text class="ch-txt" x="${CH.l - 6}" y="${CH.t + 4}" text-anchor="end">${c.ymax < 5 ? '1' : Math.round(c.ymax)}</text><text class="ch-txt" x="${CH.l - 6}" y="${base}" text-anchor="end">${Math.round(c.ymin)}</text>`;
  // hline labels sit just above their line, right-aligned; a label that would touch the previous one goes under its line
  let prevY = -99;
  for (const h of [...c.hlines].sort((a, b) => Y(a.v) - Y(b.v))) {
    const y = Y(h.v);
    const ly = y - prevY < 17 ? y + 14 : y - 5;
    prevY = y;
    s += `<line class="ch-hline" x1="${CH.l}" x2="${CH.w - CH.r}" y1="${f(y)}" y2="${f(y)}"/><text class="ch-txt ch-lbl" x="${CH.w - CH.r - 2}" y="${f(ly)}" text-anchor="end">${esc(h.label)}</text>`;
  }
  const rx = X(t.tUp);
  s += `<line class="ch-rel" x1="${f(rx)}" x2="${f(rx)}" y1="${CH.t}" y2="${base}"/>`;
  // "release" centred under its line, kept clear of the "0" and the end label
  const rw = 'release'.length * GLYPH;
  const lo = CH.l + 12 + rw / 2;
  const hi = CH.w - CH.r - (endLbl.length * GLYPH + 8) - rw / 2;
  s += `<text class="ch-txt" x="${f(Math.min(hi, Math.max(lo, rx)))}" y="${CH.h - 8}" text-anchor="middle">release</text>`;
  for (const se of c.series) s += `<polyline class="ch-s ch-${se.cls}" points="${pl(se.pts)}"/>`;
  if (c.series.length > 1) {
    let x = CH.l;
    c.series.forEach((se) => {
      s += `<line class="ch-s ch-${se.cls}" x1="${f(x)}" x2="${f(x + 16)}" y1="12" y2="12"/><text class="ch-txt ch-${se.cls}-t" x="${f(x + 22)}" y="16">${esc(se.label)}</text>`;
      x += 22 + se.label.length * GLYPH + 18;
    });
  }
  if (c.proj) s += `<polyline class="ch-proj" points="${pl(c.proj)}"/><circle class="ch-projdot" cx="${f(X(c.proj[1][0]))}" cy="${f(Y(c.proj[1][1]))}" r="4"/>`;
  s += `<line data-r="playhead" class="ch-play" x1="${f(X(0))}" x2="${f(X(0))}" y1="${CH.t}" y2="${base}" data-x0="${f(X(0))}" data-x1="${f(X(t.duration))}"/>`;
  return s + `</svg>`;
}

export function paintChart(root: Element, t: Track, ms: number) {
  const el = root.querySelector('[data-r="playhead"]');
  if (!el) return;
  const x0 = Number(el.getAttribute('data-x0'));
  const x1 = Number(el.getAttribute('data-x1'));
  const x = f(x0 + (Math.min(ms, t.duration) / t.duration) * (x1 - x0));
  el.setAttribute('x1', x);
  el.setAttribute('x2', x);
}
