/**
 * The work-card preview sheet (lazy chunk; ./boot is the eager half).
 *
 * A card click opens a sheet in the same document. The card's picture and title are morphed into the sheet's with FLIP
 * transforms driven by springs; only transform and opacity are animated. Pulling the sheet down (from scrollTop 0)
 * closes it by the rule in ./decision. Everything is one explicit state machine:
 *
 *   idle --open--> opening --settled--> open --drag--> dragging --release-stay/cancel--> open
 *                     |                   |               |
 *                     +------close--------+----close------+--release-close--> closing --settled--> idle
 *   closing --open--> opening   (a reversal keeps value and velocity: nothing jumps)
 *
 * Motion model. Two springs and one blend:
 *   Q  open progress 0..1 (shared-element morph: card rect at 0, sheet rect at 1)
 *   G  pull offset in px while the sheet follows a finger (and its snap back)
 *   E  how much of the frozen "start pose" (Ts0) is still blended in. A close freezes the pose the sheet was in at
 *      release (pulled down and slightly shrunk), then Q runs 1 -> 0 from that pose to the card ("close hero first":
 *      the body fades by Q = 0.3 while the picture is still travelling). Reopening mid-close eases E back to 1.
 *   panel transform = lerp(card pose, current pose, Q), current pose = lerp(Ts0, drag pose(G), E)
 *
 * Not here: the Inspect UI for it (../cards/inspect.ts, loaded by the Inspect chunk through bridge.cards).
 */
import '../../styles/cards.css';
import { bindPointerGesture, SLOP_MOUSE, SLOP_TOUCH, type GestureEvent } from '../motion/gesture';
import { GestureRecorder } from '../motion/recorder';
import { Spring, springFromRatio } from '../motion/spring';
import { bridge } from '../inspect/bridge';
import { CLOSE_FRACTION, decideClose, dragOffset, MIN_DISTANCE_PX, RUBBER_PX, TAU_MS } from './decision';
import type { CardsHandle, PullDecision, PullMeta, PullRecording, SheetState } from './types';

type Ev = 'open' | 'settled' | 'drag' | 'release-stay' | 'release-close' | 'cancel' | 'close';

/** the whole state machine: anything not listed is ignored (and logged) */
const TABLE: Record<SheetState, Partial<Record<Ev, SheetState>>> = {
  idle: { open: 'opening' },
  opening: { settled: 'open', close: 'closing' },
  open: { drag: 'dragging', close: 'closing' },
  dragging: { 'release-stay': 'open', cancel: 'open', 'release-close': 'closing', close: 'closing' },
  closing: { settled: 'idle', open: 'opening' },
};

/** a tap on the scrim this soon after opening is a ghost click from the tap that opened it */
const SCRIM_GRACE_MS = 260;
const HASH_RE = /^#work\/([a-z0-9-]+)$/;

interface Xf {
  tx: number;
  ty: number;
  s: number;
}
const I: Xf = { tx: 0, ty: 0, s: 1 };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: Xf, b: Xf, t: number): Xf => ({ tx: lerp(a.tx, b.tx, t), ty: lerp(a.ty, b.ty, t), s: lerp(a.s, b.s, t) });
const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);
const css = (t: Xf) => `translate(${t.tx.toFixed(2)}px,${t.ty.toFixed(2)}px) scale(${t.s.toFixed(5)})`;

const OPEN_CFG = springFromRatio(260, 0.86);
const CLOSE_CFG = springFromRatio(300, 1); // critical: no bounce past the card
const SNAP_CFG = springFromRatio(380, 0.78);
const BLEND_CFG = springFromRatio(420, 1);
/** reduced motion: the same springs, just so stiff the change is over in ~60 ms (opacity only, no travel) */
const QUICK_CFG = springFromRatio(2400, 1);

const $ = <T extends Element>(root: ParentNode, sel: string) => root.querySelector<T>(sel)!;

let ready: ReturnType<typeof setup> | undefined;
const rig = () => (ready ??= setup());

function setup() {
  const layer = document.getElementById('cards-layer')!;
  const dialog = $<HTMLElement>(layer, '#work-sheet');
  const scrim = $<HTMLElement>(dialog, '[data-scrim]');
  const wrap = $<HTMLElement>(dialog, '[data-sheet]');
  const scroll = $<HTMLElement>(dialog, '[data-scroll]');
  const dock = $<HTMLElement>(layer, '[data-inspect-dock]');
  const overlay = $<SVGSVGElement>(layer, '[data-inspect-overlay]');
  const bgEls = [$<HTMLElement>(wrap, '.sheet-bg'), $<HTMLElement>(wrap, '.sheet-bar')];
  const root = document.documentElement;
  const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');

  let state: SheetState = 'idle';
  const log: string[] = [];
  const subs = new Set<(e: 'state' | 'recording') => void>();
  const emit = (e: 'state' | 'recording') => subs.forEach((fn) => fn(e));

  const Q = new Spring(0, OPEN_CFG);
  const E = new Spring(1, BLEND_CFG);
  const G = new Spring(0, SNAP_CFG);
  let Ts0: Xf = I;

  // geometry captured at the start of every transition (never re-read per frame)
  const M = {
    P: { x: 0, y: 0, w: 1, h: 1 },
    Tc: I as Xf,
    hl: { x: 0, y: 0 },
    ch: { x: 0, y: 0 },
    kc: 1,
  };

  interface Cur {
    slug: string;
    card: HTMLElement;
    visual: HTMLElement;
    title: HTMLElement;
    trigger: HTMLElement | null;
    hero: HTMLElement;
    sTitle: HTMLElement;
    /** a copy of the sheet title that travels between the card's title and the sheet's while opening/closing */
    ghost: HTMLElement;
    fades: HTMLElement[];
  }
  let cur: Cur | null = null;
  let openedAt = 0;
  const hist = { pushed: false, pending: 0 };
  let reduced = false;

  const recorder = new GestureRecorder<PullDecision>();
  let lastRec: PullRecording | null = null;
  let gBase = 0;

  /* ---------------- state machine ---------------- */
  function go(ev: Ev): boolean {
    const next = TABLE[state][ev];
    log.push(`${state} --${ev}--> ${next ?? 'ignored'}`);
    if (log.length > 60) log.shift();
    if (!next) return false;
    state = next;
    root.dataset.cardsState = state;
    emit('state');
    return true;
  }

  /* ---------------- rendering (transform + opacity only) ---------------- */
  const dragPose = (off: number): Xf => {
    const f = clamp(Math.max(0, off) / Math.max(1, M.P.h), 0, 1);
    const s = 1 - 0.06 * f;
    return { s, tx: M.P.w * 0.5 * (1 - s), ty: off };
  };
  const currentPose = () => lerp3(Ts0, dragPose(G.value), clamp(E.value, 0, 1));

  function render() {
    if (!cur) return;
    const q = clamp(Q.value, 0, 1.04);
    const Ts = currentPose();
    const dragFrac = clamp(G.value / Math.max(1, M.P.h * 0.6), 0, 1);
    scrim.style.opacity = String(clamp(Q.value, 0, 1) * (1 - 0.7 * dragFrac));
    if (reduced) {
      wrap.style.transform = css(Ts);
      wrap.style.opacity = String(clamp(Q.value, 0, 1));
      return;
    }
    wrap.style.transform = css(lerp3(M.Tc, Ts, q));
    // body and chrome fade in over the second part of the morph and out first on the way back ("close hero first")
    const f = clamp((q - 0.4) / 0.55, 0, 1);
    const o = String(f * f * (3 - 2 * f));
    for (const el of cur.fades) el.style.opacity = o;
    // the title is a separate ghost, so the panel's scroll clipping cannot cut it off on its way to the card
    const moving = state === 'opening' || state === 'closing';
    cur.ghost.hidden = !moving;
    cur.sTitle.style.opacity = moving ? '0' : '';
    if (moving) {
      const k = lerp(M.kc, Ts.s, q);
      const dx = lerp(M.ch.x, M.P.x + Ts.tx + Ts.s * M.hl.x, q);
      const dy = lerp(M.ch.y, M.P.y + Ts.ty + Ts.s * M.hl.y, q);
      cur.ghost.style.transform = `translate(${dx.toFixed(2)}px,${dy.toFixed(2)}px) scale(${k.toFixed(5)})`;
    }
  }

  function rest() {
    // fully open and still: drop the inline transforms so the sheet is plain layout again
    wrap.style.transform = '';
    wrap.style.opacity = '';
    scrim.style.opacity = '';
    if (cur) {
      cur.ghost.hidden = true;
      cur.sTitle.style.opacity = '';
    }
    cur?.fades.forEach((el) => el.style.removeProperty('opacity'));
  }

  /** read the layout once per transition: where the panel, its picture and title are, and where the card's are */
  function measure() {
    if (!cur) return;
    wrap.style.transform = 'none';
    scroll.scrollTop = 0;
    const P = wrap.getBoundingClientRect();
    const V = cur.hero.getBoundingClientRect();
    const H = cur.sTitle.getBoundingClientRect();
    const C = cur.visual.getBoundingClientRect();
    const Ch = cur.title.getBoundingClientRect();
    M.P = { x: P.left, y: P.top, w: P.width, h: P.height };
    const sc = C.width / Math.max(1, V.width);
    const vl = { x: V.left - P.left, y: V.top - P.top };
    M.Tc = { s: sc, tx: C.left - P.left - sc * vl.x, ty: C.top - P.top - sc * vl.y };
    M.hl = { x: H.left - P.left, y: H.top - P.top };
    M.ch = { x: Ch.left, y: Ch.top };
    const f = (el: Element) => parseFloat(getComputedStyle(el).fontSize) || 16;
    M.kc = f(cur.title) / f(cur.sTitle);
    cur.ghost.style.width = `${H.width}px`;
  }

  /* ---------------- loop ---------------- */
  let raf = 0;
  let last = 0;
  function kick() {
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function tick(now: number) {
    raf = 0;
    const dt = last ? now - last : 16;
    last = now;
    Q.step(dt);
    E.step(dt);
    G.step(dt);
    render();
    if (state === 'opening' && Q.settled) go('settled');
    else if (state === 'closing' && Q.settled) {
      go('settled');
      finishClose();
    }
    if (state === 'open' && G.settled && E.settled && Q.settled) rest();
    if (state !== 'idle' && !(Q.settled && E.settled && G.settled)) kick();
    else last = 0;
  }

  /* ---------------- open / close ---------------- */
  function lock(on: boolean) {
    root.classList.toggle('cards-open', on);
    for (const el of Array.from(document.body.children)) {
      if (el === layer || el.tagName === 'SCRIPT' || el.tagName === 'TEMPLATE') continue;
      el.toggleAttribute('inert', on);
    }
  }

  function placeDock(inDialog: boolean) {
    (inDialog ? dialog : layer).append(dock);
  }

  function mount(slug: string): Cur | null {
    const card = document.querySelector<HTMLElement>(`[data-card="${slug}"]`);
    const tpl = layer.querySelector<HTMLTemplateElement>(`template[data-sheet-for="${slug}"]`);
    if (!card || !tpl) return null;
    scroll.replaceChildren(tpl.content.cloneNode(true));
    const sTitle = $<HTMLElement>(scroll, '[data-sheet-title]');
    sTitle.id = 'sheet-title';
    dialog.setAttribute('aria-labelledby', 'sheet-title');
    const ghost = sTitle.cloneNode(true) as HTMLElement;
    ghost.removeAttribute('id');
    ghost.removeAttribute('tabindex');
    ghost.removeAttribute('data-sheet-title');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.classList.add('sh-ghost');
    ghost.hidden = true;
    dialog.append(ghost);
    return {
      slug,
      card,
      visual: $<HTMLElement>(card, '.visual'),
      title: $<HTMLElement>(card, 'h3'),
      trigger: card.querySelector<HTMLElement>('[data-card-title]'),
      hero: $<HTMLElement>(scroll, '[data-sheet-hero]'),
      sTitle,
      ghost,
      fades: [...bgEls, ...Array.from(scroll.querySelectorAll<HTMLElement>('.sh-meta, .sh-text'))],
    };
  }

  function pushHistory(mode: 'push' | 'have' | 'none') {
    if (mode === 'push') {
      history.pushState({ work: cur!.slug }, '', `#work/${cur!.slug}`);
      hist.pushed = true;
    } else hist.pushed = mode === 'have';
  }

  function openCard(slug: string, o: { history?: 'push' | 'have' | 'none'; instant?: boolean } = {}) {
    const mode = o.history ?? 'push';
    reduced = reducedMq.matches;
    const cfg = reduced ? QUICK_CFG : OPEN_CFG;
    if (state === 'closing' && cur?.slug === slug) {
      // reversal: aim the same springs the other way; value and velocity carry over
      if (!go('open')) return;
      cur.trigger?.setAttribute('aria-expanded', 'true');
      pushHistory(mode);
      E.retarget(1, BLEND_CFG);
      Q.retarget(1, cfg);
      openedAt = performance.now();
      kick();
      return;
    }
    if (state !== 'idle') return;
    const c = mount(slug);
    if (!c) return;
    cur = c;
    go('open');
    dialog.hidden = false;
    placeDock(true);
    lock(true);
    c.trigger?.setAttribute('aria-expanded', 'true');
    pushHistory(mode);
    c.visual.style.visibility = 'hidden';
    c.title.style.opacity = '0';
    Ts0 = I;
    E.value = E.target = 1;
    E.velocity = 0;
    E.settled = true;
    G.value = G.target = 0;
    G.velocity = 0;
    G.settled = true;
    measure();
    Q.cfg = { ...Q.cfg, ...cfg };
    Q.value = 0;
    Q.velocity = 0;
    Q.target = 0;
    Q.retarget(1, cfg);
    render();
    openedAt = performance.now();
    c.sTitle.focus({ preventScroll: true });
    document.addEventListener('keydown', onKey, true);
    if (o.instant) {
      Q.finish();
      go('settled');
      rest();
    } else kick();
  }

  /** start the close from wherever the sheet is right now. `vq` = initial Q velocity (1/s, negative = closing) */
  function beginClose(ev: 'close' | 'release-close', vq?: number) {
    if (!cur || !go(ev)) return;
    reduced = reducedMq.matches;
    const pose = currentPose(); // before measure(): it needs the previous pull geometry
    measure();
    Ts0 = pose;
    G.value = G.target = 0;
    G.velocity = 0;
    G.settled = true;
    E.value = E.target = 0;
    E.velocity = 0;
    E.settled = true;
    if (vq != null) Q.set(Q.value, vq);
    Q.retarget(0, reduced ? QUICK_CFG : CLOSE_CFG);
    cur.trigger?.setAttribute('aria-expanded', 'false');
    render();
    kick();
  }

  function finishClose() {
    const c = cur;
    if (!c) return;
    c.visual.style.visibility = '';
    c.title.style.opacity = '';
    wrap.style.transform = '';
    wrap.style.opacity = '';
    scrim.style.opacity = '';
    dialog.hidden = true;
    placeDock(false);
    document.removeEventListener('keydown', onKey, true);
    scroll.replaceChildren();
    c.ghost.remove();
    lock(false);
    cur = null;
    c.trigger?.focus({ preventScroll: true });
    emit('state');
    reconcile();
  }

  /** every UI route out (button, Escape, scrim) goes through here; history is part of closing */
  function closeHistory() {
    if (hist.pushed) {
      hist.pushed = false;
      hist.pending++;
      history.back();
    } else if (HASH_RE.test(location.hash)) {
      history.replaceState(history.state, '', location.pathname + location.search);
    }
  }
  function requestClose() {
    if (state === 'idle' || state === 'closing') return;
    closeHistory();
    beginClose('close');
  }

  const hashSlug = () => HASH_RE.exec(location.hash)?.[1] ?? null;

  /** make the sheet match the URL when the URL changed under us (Back, Forward, typed hash) */
  function reconcile() {
    if (hist.pending > 0) return; // our own history.back() has not landed yet: the URL is about to change
    const slug = hashSlug();
    if (slug && (state === 'idle' || (state === 'closing' && cur?.slug === slug))) openCard(slug, { history: 'have' });
    else if (!slug && (state === 'opening' || state === 'open' || state === 'dragging')) {
      hist.pushed = false;
      beginClose('close');
    }
  }
  addEventListener('popstate', () => {
    if (hist.pending > 0) {
      hist.pending--; // the pop we asked for when closing from the UI
    }
    reconcile();
  });
  addEventListener('pageshow', (e) => {
    if (e.persisted) hist.pending = 0;
    swapNames(false);
  });

  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    requestClose();
  }

  dialog.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t === scrim) {
      if (performance.now() - openedAt > SCRIM_GRACE_MS) requestClose();
    } else if (t.closest('[data-sheet-close]')) requestClose();
  });

  /* ---------------- leaving for the case study: hand the shared names to the sheet ---------------- */
  function swapNames(leaving: boolean) {
    if (!cur) return;
    const slug = cur.slug;
    const set = (el: Element | null, name: string) => el && ((el as HTMLElement).style.viewTransitionName = name);
    set(cur.visual, leaving ? 'none' : `work-visual-${slug}`);
    set(cur.title, leaving ? 'none' : `work-title-${slug}`);
    set(cur.hero.firstElementChild, leaving ? `work-visual-${slug}` : '');
    set(cur.sTitle, leaving ? `work-title-${slug}` : '');
  }
  addEventListener('pageswap', () => {
    if (state === 'open' || state === 'opening') {
      wrap.style.transform = '';
      swapNames(true);
    }
  });

  /* ---------------- pull-down gesture ---------------- */
  const TEXTY = 'a, button, input, summary, p, h1, h2, h3, h4, dd, dt, li, label, code, .mono, .label';
  let dragging = false;
  const endDragUi = () => {
    dragging = false;
    root.classList.remove('cards-dragging');
  };
  const swallowClick = () => {
    const f = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    addEventListener('click', f, { capture: true, once: true });
    setTimeout(() => removeEventListener('click', f, true), 60);
  };

  bindPointerGesture(scroll, {
    accept(e) {
      if (state !== 'open' || scroll.scrollTop > 0) return false;
      // a mouse drag must never steal text selection or a link: only blank areas and the picture pull
      if (e.pointerType !== 'touch' && (e.target as Element).closest(TEXTY)) return false;
      return true;
    },
    config(e) {
      return {
        slop: e.pointerType === 'touch' ? SLOP_TOUCH : SLOP_MOUSE,
        claim: ({ axis, dy }) => axis === 'y' && dy > 0 && scroll.scrollTop <= 0 && state === 'open',
      };
    },
    onSample(s, { pointerType }) {
      if (s.type === 'down') {
        const r = wrap.getBoundingClientRect();
        // layout size, not the transformed rect: the dock may have resized the sheet since the last measure()
        M.P.h = wrap.offsetHeight;
        M.P.w = wrap.offsetWidth;
        const meta: PullMeta = {
          pointerType,
          slop: pointerType === 'touch' ? SLOP_TOUCH : SLOP_MOUSE,
          sheetHeight: M.P.h,
          sheetRect: { x: r.left, y: r.top, w: r.width, h: r.height },
        };
        recorder.begin('sheet-pull', meta);
      }
      recorder.add(s);
    },
    onEvent(ev: GestureEvent) {
      switch (ev.kind) {
        case 'slop':
          if (!ev.claimed) recorder.discard();
          else if (go('drag')) {
            dragging = true;
            gBase = Math.max(0, G.value);
            G.freeze();
            root.classList.add('cards-dragging');
            getSelection()?.removeAllRanges();
          }
          return;
        case 'drag':
          if (!dragging || state !== 'dragging') return;
          G.value = dragOffset(gBase + ev.dy);
          render();
          return;
        case 'release': {
          const wasDragging = dragging && state === 'dragging';
          endDragUi();
          swallowClick();
          if (!wasDragging) return void recorder.discard();
          const input = { distance: gBase + ev.dy, velocity: ev.vy, sheetHeight: M.P.h };
          const d = decideClose(input);
          const dec: PullDecision = { ...d, ...input, samples: ev.samples };
          lastRec = recorder.finish(dec) as PullRecording | null;
          if (lastRec) emit('recording');
          if (d.close) {
            closeHistory();
            beginClose('release-close', -Math.min(3, Math.abs(ev.vy * 1000) / (0.9 * M.P.h)));
          } else {
            G.set(G.value, ev.vy * 1000);
            G.retarget(0, SNAP_CFG);
            go('release-stay');
            kick();
          }
          return;
        }
        case 'cancel':
          if (!ev.claimed) return void recorder.discard();
          endDragUi();
          if (state === 'dragging') {
            const input = { distance: gBase + ev.dy, velocity: 0, sheetHeight: M.P.h };
            const d = decideClose(input);
            lastRec = recorder.finish({ ...d, ...input, samples: 0, cancelled: true }) as PullRecording | null;
            if (lastRec) emit('recording');
            G.set(G.value, 0);
            G.retarget(0, SNAP_CFG);
            go('cancel');
            kick();
          } else recorder.discard();
          return;
        case 'tap':
          recorder.discard();
      }
    },
  });
  scroll.addEventListener('dragstart', (e) => e.preventDefault());

  /* ---------------- Inspect-facing handle ---------------- */
  const handle: CardsHandle = {
    state: () => state,
    isOpen: () => state === 'opening' || state === 'open' || state === 'dragging',
    recording: () => lastRec,
    dock,
    overlay,
    on(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    log: () => log.slice(),
  };
  bridge.setCards(handle);
  if (new URLSearchParams(location.search).has('hud')) (window as unknown as { __cards: unknown }).__cards = { handle, Q, G, E, hist, constants: { TAU_MS, CLOSE_FRACTION, MIN_DISTANCE_PX, RUBBER_PX } };

  return { openCard, hashSlug, reconcile };
}

/** open a card's preview sheet (click / Enter on a card) */
export function openCard(slug: string) {
  rig().openCard(slug);
}

/** direct load (or a typed hash) with `#work/<slug>`: open immediately, no animation */
export function openFromHash() {
  const r = rig();
  const slug = r.hashSlug();
  if (slug) r.openCard(slug, { history: 'none', instant: true });
}
