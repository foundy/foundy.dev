import './style.css';
import { Spring, springFromRatio } from './motion/spring';
import { VelocityTracker } from './motion/velocity';
import { clamp, lerp, smoothstep } from './motion/math';
import { angleParts, bandPosition, decideClose, pickTarget, snapAngle } from './motion/decide';
import { cardLook } from './layout';
import { ANGLES, ANGLE_LABELS, COLORS, DETAILS, PRICE, SIZES, STORY, TITLE, imgSrcset, indexOfId } from './data';

/*
 * One continuous model drives everything:
 *   pos    deck position (float, in cards)         -> every card's transform, the background tint
 *   p      open progress 0..1 (one spring)         -> hero morph, siblings, tint depth, body/close fade
 *   angle  hero angle (float, 4 = full turn)       -> crossfade weights + parallax of the 4 hero images
 * `mode` is the explicit state machine: closed | opening | open | closing | dragging (a pull-down in progress).
 * Gestures write the springs directly (finger-driven); releases retarget them with the release velocity.
 */
type Mode = 'closed' | 'opening' | 'open' | 'closing' | 'dragging';

const N = COLORS.length;
const R = 28; // card corner radius, px
const root = document.documentElement;
const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const page = $<HTMLElement>('#page');
const stage = $<HTMLElement>('#stage');
const dotsEl = $<HTMLElement>('#dots');
const live = $<HTMLElement>('#live');
const sheet = $<HTMLElement>('#sheet');
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const reduced = () => motionQuery.matches;

/* ---------- springs ---------- */
const sc = (k: number, z: number) => (reduced() ? springFromRatio(1100, 1) : springFromRatio(k, z));
const cfgPos = () => sc(230, 0.8);
const cfgP = () => sc(215, 0.9);
const cfgAngle = () => sc(150, 0.86);
const cfgMisc = () => sc(220, 1);
const pos = new Spring(0, { restDelta: 0.0008 });
const p = new Spring(0, { restDelta: 0.0006 });
const angle = new Spring(0, { restDelta: 0.001 });
const dxf = new Spring(0, { restDelta: 0.3 }); // finger x during a pull-down (px)
const sy = new Spring(0, { restDelta: 0.4 }); // scrollTop while closing from a scrolled detail
const toff = new Spring(0, { restDelta: 0.001 }); // background tint offset (cards) after a colour switch
const drive = (s: Spring, v: number) => {
  s.value = s.target = v;
  s.velocity = 0;
  s.settled = true;
};

/* ---------- state ---------- */
let mode: Mode = 'closed';
let cur = 0;
let pendingBack = false;
let suppressUntil = 0;
const set = (m: Mode) => {
  mode = m;
  root.dataset.bonnet = m;
};

/* ---------- build ---------- */
const coverHtml = (i: number, tag: 'div' | 'h2') =>
  `<div class="cover"><p class="kicker">${TITLE}</p><${tag} class="t"${tag === 'h2' ? ' id="dtitle"' : ''}>${COLORS[i].name}</${tag}><p class="sub">${PRICE} &middot; hand-crocheted</p></div>`;

const cards = COLORS.map((c, i) => {
  const near = Math.abs(i - cur) <= 1;
  const a = imgSrcset(c, 0);
  const slide = document.createElement('div');
  slide.className = 'slide';
  slide.setAttribute('role', 'group');
  slide.setAttribute('aria-roledescription', 'slide');
  slide.setAttribute('aria-label', `${i + 1} of ${N}: ${c.name}`);
  slide.innerHTML =
    `<span class="sh"></span><div class="face"><div class="pic"><img alt="" draggable="false" decoding="async" fetchpriority="${near ? 'high' : 'low'}" sizes="480px" src="${a.src}" srcset="${a.srcset}"></div>` +
    `<span class="dim"></span><span class="grad"></span>${coverHtml(i, 'div')}</div>` +
    `<button class="hit" type="button" data-i="${i}" aria-label="${c.name} ${TITLE.toLowerCase()}. Open details"></button>`;
  stage.append(slide);
  return { slide, sh: slide.querySelector<HTMLElement>('.sh')!, pic: slide.querySelector<HTMLElement>('.pic')!, dim: slide.querySelector<HTMLElement>('.dim')!, hit: slide.querySelector<HTMLButtonElement>('.hit')!, img: slide.querySelector('img')!, vis: '', last: '' };
});

const dots = COLORS.map((c, i) => {
  const b = document.createElement('button');
  b.className = 'dot';
  b.type = 'button';
  b.setAttribute('aria-label', `Show ${c.name}`);
  b.addEventListener('click', () => go(i));
  dotsEl.append(b);
  return b;
});

sheet.innerHTML = `<div class="sheet-inner">
  <div class="closebar"><button class="close" type="button" aria-label="Close details"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="#2a2119" stroke-width="2" stroke-linecap="round"/></svg></button></div>
  <div class="hero-shadow"></div>
  <div class="hero"><div class="imgs"></div><span class="grad"></span>${coverHtml(0, 'h2')}
    <div class="angles" role="group" aria-label="View angle"><span class="lbl" aria-hidden="true"></span>${ANGLES.map((_, k) => `<button type="button" data-k="${k}" aria-label="${ANGLE_LABELS[k]} view" aria-pressed="false"></button>`).join('')}</div>
  </div>
  <article class="body">
    <div class="rv"><div class="row"><h3 class="name"></h3><span class="price">${PRICE}</span></div><span class="tag">Demo &mdash; sample product</span></div>
    <div class="rv"><p class="story">${STORY}</p><p class="note"></p></div>
    <div class="rv"><p class="label" id="clbl">Colour</p><div class="swatches" role="group" aria-labelledby="clbl">${COLORS.map((c, i) => `<button class="sw" type="button" data-i="${i}" aria-pressed="false" aria-label="${c.name}"><i style="background:${c.swatch}"></i></button>`).join('')}</div></div>
    <div class="rv"><p class="label" id="slbl">Size</p><div class="sizes" role="group" aria-labelledby="slbl">${SIZES.map((s, i) => `<button class="size" type="button" aria-pressed="${i === 1}">${s}</button>`).join('')}</div></div>
    <dl class="facts rv">${DETAILS.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    <div class="rv"><button class="cta" type="button" aria-disabled="true">Add to bag</button><p class="fine">Demo only. This is a sample product and cannot be bought.</p></div>
  </article></div>`;
const heroEl = sheet.querySelector<HTMLElement>('.hero')!;
const shadowEl = sheet.querySelector<HTMLElement>('.hero-shadow')!;
const imgsEl = sheet.querySelector<HTMLElement>('.imgs')!;
const bodyEl = sheet.querySelector<HTMLElement>('.body')!;
const closeBtn = sheet.querySelector<HTMLButtonElement>('.close')!;
const closeBar = sheet.querySelector<HTMLElement>('.closebar')!;
const anglesEl = sheet.querySelector<HTMLElement>('.angles')!;
const angleBtns = [...anglesEl.querySelectorAll<HTMLButtonElement>('button')];
const angleLbl = anglesEl.querySelector<HTMLElement>('.lbl')!;
const coverEl = heroEl.querySelector<HTMLElement>('.cover')!;
const titleEl = $<HTMLElement>('#dtitle');
const nameEl = sheet.querySelector<HTMLElement>('.name')!;
const noteEl = sheet.querySelector<HTMLElement>('.note')!;
const swBtns = [...sheet.querySelectorAll<HTMLButtonElement>('.sw')];
const sizeBtns = [...sheet.querySelectorAll<HTMLButtonElement>('.size')];
const rvs = [...sheet.querySelectorAll<HTMLElement>('.rv')];

/* hero image groups: a small pool so colour switches can crossfade and be interrupted at any moment */
interface Group {
  el: HTMLElement;
  imgs: HTMLImageElement[];
  ci: number;
  w: Spring;
  z: number;
  on: boolean;
  gs: string;
  is: string[];
}
const groups: Group[] = [0, 1, 2].map(() => {
  const el = document.createElement('div');
  el.className = 'grp';
  el.hidden = true;
  const imgs = ANGLES.map(() => {
    const im = document.createElement('img');
    im.draggable = false;
    im.decoding = 'async';
    im.sizes = '480px';
    el.append(im);
    return im;
  });
  imgsEl.append(el);
  return { el, imgs, ci: -1, w: new Spring(1, { restDelta: 0.002 }), z: 0, on: false, gs: '', is: ['', '', '', ''] };
});
let zc = 0;

function activate(ci: number, instant: boolean) {
  let g: Group;
  if (instant) {
    groups.forEach((o) => ((o.on = false), (o.el.hidden = true)));
    g = groups[0];
  } else {
    g = groups.find((o) => !o.on) ?? groups.reduce((a, b) => (a.z < b.z ? a : b));
  }
  g.ci = ci;
  g.on = true;
  g.el.hidden = false;
  g.z = ++zc;
  g.el.style.zIndex = String(g.z);
  g.imgs.forEach((im, k) => {
    const s = imgSrcset(COLORS[ci], k);
    im.alt = `${COLORS[ci].name} bonnet, ${ANGLE_LABELS[k].toLowerCase()} view`;
    im.srcset = s.srcset;
    im.src = s.src;
  });
  if (instant) drive(g.w, 1);
  else {
    g.w.value = 0;
    g.w.velocity = 0;
    g.w.settled = false;
    g.w.target = 1;
    g.w.retarget(1, cfgMisc());
  }
  g.gs = '';
  g.is = ['', '', '', ''];
}

/* ---------- layout (measured once per gesture start / resize, never per frame) ---------- */
const L = { W: 0, H: 0, cw: 272, ch: 340, sw: 390, sx: 0, hh: 487, slotX: 0, slotY: 0, spacing: 163, range: 320, topR: 0, fromX: 0, fromY: 0, fromW: 272 };
function measure() {
  L.W = root.clientWidth;
  L.H = innerHeight;
  const sr = stage.getBoundingClientRect();
  L.ch = clamp(Math.min(sr.height * 0.88, L.W * 0.78 * 1.25, 470), 200, 470);
  L.cw = L.ch * 0.8;
  L.sw = Math.max(Math.min(L.W, 520, L.H * 0.62), Math.min(L.W, 320));
  L.hh = L.sw * 1.25;
  L.sx = (L.W - L.sw) / 2;
  L.topR = 0;
  L.spacing = L.cw * 0.6;
  L.range = clamp(L.H * 0.42, 240, 420);
  const s = root.style;
  s.setProperty('--cw', L.cw + 'px');
  s.setProperty('--ch', L.ch + 'px');
  s.setProperty('--sw', L.sw + 'px');
  s.setProperty('--hh', L.hh + 'px');
  L.slotX = sr.left + (sr.width - L.cw) / 2;
  L.slotY = sr.top + (sr.height - L.ch) / 2;
}
/** where the card currently is on screen (so a tap during a deck spring does not pop): hero starts there */
function computeFrom() {
  const look = cardLook(cur - pos.value, L.spacing, 0, reduced());
  L.fromW = L.cw * look.scale;
  L.fromX = L.slotX + (L.cw * (1 - look.scale)) / 2 + look.x;
  L.fromY = L.slotY + L.ch * 0.92 * (1 - look.scale) + look.y;
}

/* ---------- render: everything is a function of (pos, p, angle, groups) ---------- */
const rgb = (c: number[]) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
let rvLast: string[] = [];
let sheetBits = '';
function render() {
  const P = p.value;
  const rm = reduced();
  const open = mode !== 'closed';
  /* deck */
  for (let i = 0; i < N; i++) {
    const c = cards[i];
    const look = cardLook(i - pos.value, L.spacing, clamp(P, 0, 1), rm);
    const hide = (open && i === cur) || look.opacity <= 0.002;
    const vis = hide ? 'hidden' : 'visible';
    if (vis !== c.vis) {
      c.vis = vis;
      c.slide.style.visibility = vis;
    }
    if (hide) continue;
    const st = c.slide.style;
    st.transform = `translate3d(${look.x.toFixed(2)}px,${look.y.toFixed(2)}px,0) rotate(${look.rot.toFixed(3)}deg) rotateY(${look.rotY.toFixed(3)}deg) scale(${look.scale.toFixed(4)})`;
    st.opacity = look.opacity.toFixed(3);
    st.zIndex = String(look.z);
    c.dim.style.opacity = look.shade.toFixed(3);
    c.sh.style.opacity = look.shadow.toFixed(3);
    c.pic.style.transform = `translate3d(${(look.px * L.cw).toFixed(2)}px,0,0) scale(${look.pscale.toFixed(4)})`;
  }
  /* background tint */
  const t = clamp(pos.value + toff.value, 0, N - 1);
  const i0 = Math.floor(t);
  const i1 = Math.min(N - 1, i0 + 1);
  const f = t - i0;
  const deep = smoothstep(0, 1, P) * 0.92;
  const col = [0, 1, 2].map((k) => lerp(lerp(COLORS[i0].tint[k], COLORS[i1].tint[k], f), lerp(COLORS[i0].deep[k], COLORS[i1].deep[k], f), deep));
  document.body.style.backgroundColor = rgb(col);
  if (!open) return;

  /* hero */
  const pc = clamp(P, 0, 1);
  const s0 = L.fromW / L.sw;
  if (rm) {
    heroEl.style.transform = '';
    heroEl.style.clipPath = '';
    heroEl.style.opacity = String(pc);
    shadowEl.style.opacity = '0';
  } else if (P >= 0.9999 && Math.abs(dxf.value) < 0.01) {
    heroEl.style.transform = '';
    heroEl.style.clipPath = L.topR ? `inset(0 round ${L.topR}px ${L.topR}px 0 0)` : '';
    heroEl.style.opacity = '';
    shadowEl.style.opacity = '0';
  } else {
    const s = lerp(s0, 1, P);
    const bump = pc * (1 - pc);
    const tx = lerp(L.fromX - L.sx, 0, P) + dxf.value * pc;
    const ty = lerp(L.fromY, 0, P) + 0.5 * L.range * bump;
    const tr = lerp(R, L.topR, pc) / s;
    const br = lerp(R, 0, pc) / s;
    const tf = `translate3d(${tx.toFixed(2)}px,${ty.toFixed(2)}px,0) scale(${s.toFixed(5)})`;
    heroEl.style.transform = tf;
    heroEl.style.clipPath = `inset(0 round ${tr.toFixed(2)}px ${tr.toFixed(2)}px ${br.toFixed(2)}px ${br.toFixed(2)}px)`;
    heroEl.style.opacity = '';
    shadowEl.style.transform = tf;
    shadowEl.style.borderRadius = R / s0 + 'px';
    shadowEl.style.opacity = (1 - smoothstep(0.1, 0.8, pc)).toFixed(3);
  }
  /* hero images: angle view collapses to the front as the sheet closes so it lands on the deck's picture */
  const nf = 4 * Math.round(angle.value / 4);
  const av = nf + (angle.value - nf) * smoothstep(0.4, 0.9, pc);
  const [ia, fa] = angleParts(av);
  const ib = (ia + 1) % 4;
  const scrollY = sheet.scrollTop;
  imgsEl.style.transform = scrollY > 0 && !rm ? `translate3d(0,${(scrollY * 0.22).toFixed(1)}px,0)` : '';
  let topZ = 0;
  for (const g of groups) if (g.on) topZ = Math.max(topZ, g.z);
  for (const g of groups) {
    if (!g.on) continue;
    const w = clamp(g.w.value, 0, 1);
    const gs = `${w.toFixed(3)}|${g.z === topZ ? 1 : 0}`;
    if (gs !== g.gs) {
      g.gs = gs;
      g.el.style.opacity = g.z === topZ ? w.toFixed(3) : '1';
      g.el.style.transform = rm ? '' : `scale(${(1 + 0.045 * (1 - w)).toFixed(4)})`;
    }
    for (let k = 0; k < 4; k++) {
      const wt = k === ia ? 1 - fa : k === ib ? fa : 0;
      const sx = rm ? 0 : k === ia ? -fa * 0.02 * L.sw : k === ib ? (1 - fa) * 0.02 * L.sw : 0;
      const str = `${wt.toFixed(3)}|${sx.toFixed(1)}`;
      if (str === g.is[k]) continue;
      g.is[k] = str;
      const im = g.imgs[k].style;
      im.opacity = wt.toFixed(3);
      im.transform = sx || wt > 0 ? `translate3d(${sx.toFixed(2)}px,0,0) scale(${(1 + 0.05 * (1 - wt)).toFixed(4)})` : '';
      im.visibility = wt > 0.001 ? 'visible' : 'hidden';
    }
  }
  const ai = ((Math.round(av) % 4) + 4) % 4;
  const bits = `${ai}|${cur}`;
  if (bits !== sheetBits) {
    sheetBits = bits;
    angleBtns.forEach((b, k) => b.setAttribute('aria-pressed', String(k === ai)));
    angleLbl.textContent = ANGLE_LABELS[ai];
  }
  /* body, close button, angle dots: appear after p ~ 0.55 with a stagger; follow the hero's bottom edge while it moves */
  const bq = smoothstep(0.62, 0.96, pc);
  const hb = rm ? 0 : lerp(L.fromY, 0, P) + 0.5 * L.range * pc * (1 - pc) - (1 - lerp(s0, 1, P)) * L.hh;
  bodyEl.style.opacity = bq >= 1 ? '' : bq.toFixed(3);
  bodyEl.style.transform = rm || (P >= 0.9999 && Math.abs(hb) < 0.01) ? '' : `translate3d(0,${(hb + (1 - bq) * 14).toFixed(2)}px,0)`;
  rvs.forEach((el, i) => {
    const a = 0.62 + i * 0.04;
    const q = smoothstep(a, Math.min(1, a + 0.2), pc);
    const v = q >= 1 ? '' : `${q.toFixed(3)}|${((1 - q) * 22).toFixed(1)}`;
    if (v === rvLast[i]) return;
    rvLast[i] = v;
    el.style.opacity = q >= 1 ? '' : q.toFixed(3);
    el.style.transform = q >= 1 || rm ? '' : `translate3d(0,${((1 - q) * 22).toFixed(1)}px,0)`;
  });
  const cq = smoothstep(0.66, 0.94, pc);
  closeBar.style.opacity = cq >= 1 ? '' : cq.toFixed(3);
  closeBtn.style.transform = cq >= 1 || rm ? '' : `scale(${(0.85 + 0.15 * cq).toFixed(3)})`;
  closeBtn.style.pointerEvents = cq > 0.4 ? 'auto' : '';
  anglesEl.style.opacity = smoothstep(0.7, 1, pc).toFixed(3);
}

/* ---------- loop: one rAF, sleeps when every spring has settled ---------- */
let raf = 0;
let lastT = 0;
const all = () => [pos, p, angle, dxf, sy, toff, ...groups.filter((g) => g.on).map((g) => g.w)];
function tick(now: number) {
  raf = 0;
  const dt = lastT ? now - lastT : 16;
  lastT = now;
  let busy = false;
  for (const s of all()) {
    if (!s.settled) {
      s.step(dt);
      if (!s.settled) busy = true;
    }
  }
  if (syWrite) {
    sheet.scrollTop = sy.value;
    if (sy.settled) syWrite = false;
  }
  /* once the newest hero layer is opaque, the ones beneath are not needed */
  const top = groups.reduce((a, g) => (g.on && g.z > a.z ? g : a), groups[0]);
  if (top.on && top.w.settled) for (const g of groups) if (g !== top && g.on) ((g.on = false), (g.el.hidden = true));
  if (mode === 'opening' && p.settled && p.target === 1) finishOpen();
  else if (mode === 'closing' && p.settled && sy.settled && p.target === 0) finishClose();
  render();
  if (busy) raf = requestAnimationFrame(tick);
  else lastT = 0;
}
const kick = () => {
  if (!raf) raf = requestAnimationFrame(tick);
};
let syWrite = false;

/* ---------- open / close ---------- */
function openCore(instant = false) {
  if (mode === 'opening' || mode === 'open' || mode === 'dragging') return;
  if (mode === 'closed') {
    measure();
    computeFrom();
    paintDetail(true);
    sheet.hidden = false;
    sheet.classList.remove('scroll', 'live');
    sheet.scrollTop = 0;
    sheetBits = '';
    rvLast = [];
    root.classList.add('locked');
    page.inert = true;
    drive(p, 0);
    drive(dxf, 0);
    drive(angle, 0);
    drive(sy, 0);
  }
  if (instant) {
    set('open');
    drive(p, 1);
    sheet.classList.add('scroll', 'live');
  } else {
    set('opening');
    p.retarget(1, cfgP());
  }
  render();
  closeBtn.focus({ preventScroll: true });
  kick();
}
function finishOpen() {
  set('open');
  sheet.classList.add('scroll', 'live');
}
function closeCore() {
  if (mode === 'closed' || mode === 'closing') return;
  sg = null;
  set('closing');
  sheet.classList.remove('scroll', 'live');
  const st = sheet.scrollTop;
  if (st > 1) {
    sy.set(st, 0);
    sy.retarget(0, cfgMisc());
    syWrite = true;
  }
  angle.retarget(4 * Math.round(angle.value / 4), cfgAngle());
  p.retarget(0, cfgP());
  kick();
}
function finishClose() {
  set('closed');
  sheet.hidden = true;
  sheet.classList.remove('scroll', 'live');
  root.classList.remove('locked');
  page.inert = false;
  drive(dxf, 0);
  drive(angle, 0);
  drive(p, 0);
  groups.forEach((g) => ((g.on = false), (g.el.hidden = true)));
  const had = sheet.contains(document.activeElement) || document.activeElement === document.body;
  syncRoving();
  render();
  if (had) cards[cur].hit.focus({ preventScroll: true });
}

/* URL: the hash mirrors the open card; open pushes, close pops, Back runs the same transition */
function openFromUI() {
  if (mode !== 'closed' && mode !== 'closing') return;
  history.pushState({ bonnet: 1 }, '', '#' + COLORS[cur].id);
  openCore();
}
function requestClose() {
  if (mode === 'closed' || mode === 'closing') return;
  closeCore(); // the transition starts now; history catches up (its popstate finds us already closing)
  if (history.state?.bonnet) {
    if (!pendingBack) {
      pendingBack = true;
      history.back();
    }
  } else history.replaceState(null, '', location.pathname + location.search);
}
function syncFromLocation(initial = false) {
  const i = indexOfId(decodeURIComponent(location.hash.slice(1)));
  if (i < 0) return closeCore();
  if (mode === 'closed' || mode === 'closing') {
    if (i !== cur) {
      setCur(i);
      drive(pos, i);
    }
    openCore(initial);
  } else if (i !== cur) setColor(i, false);
}
addEventListener('popstate', () => {
  pendingBack = false;
  syncFromLocation();
});

/* ---------- deck ---------- */
function setCur(i: number) {
  if (i === cur) return;
  cur = i;
  live.textContent = `${COLORS[i].name}, ${i + 1} of ${N}`;
  syncRoving();
  for (let k = 0; k < N; k++) cards[k].img.fetchPriority = Math.abs(k - i) <= 1 ? 'high' : 'low';
}
function syncRoving() {
  cards.forEach((c, k) => (c.hit.tabIndex = k === cur ? 0 : -1));
  dots.forEach((d, k) => d.setAttribute('aria-current', String(k === cur)));
}
function go(i: number) {
  if (mode !== 'closed') return;
  i = clamp(i, 0, N - 1);
  setCur(i);
  pos.retarget(i, cfgPos());
  kick();
}
$('#prev').addEventListener('click', () => go(cur - 1));
$('#next').addEventListener('click', () => go(cur + 1));
stage.addEventListener('click', (e) => {
  const hit = (e.target as HTMLElement).closest<HTMLElement>('.hit');
  if (!hit || mode !== 'closed') return;
  const i = Number(hit.dataset.i);
  if (i === cur && Math.abs(pos.value - cur) < 0.5) openFromUI();
  else go(i);
});
/* a drag must never leak into a click (ghost click safe); keyboard clicks (detail 0) always pass */
addEventListener(
  'click',
  (e) => {
    if (e.detail !== 0 && performance.now() < suppressUntil) {
      e.stopPropagation();
      e.preventDefault();
    }
  },
  true,
);

const SLOP = (e: PointerEvent) => (e.pointerType === 'mouse' ? 8 : 10);
const edge = (e: PointerEvent) => e.pointerType === 'touch' && (e.clientX < 20 || e.clientX > innerWidth - 20); // leave iOS back-swipe alone
const vt = new VelocityTracker();
interface Drag {
  id: number;
  x0: number;
  y0: number;
  claim: boolean;
  moved: boolean;
  dead: boolean;
  base: number;
  start: number;
}
let dk: Drag | null = null;

stage.addEventListener('pointerdown', (e) => {
  if (mode !== 'closed' || e.button > 0 || edge(e) || dk?.claim) return;
  dk = { id: e.pointerId, x0: e.clientX, y0: e.clientY, claim: false, moved: false, dead: false, base: 0, start: 0 };
  vt.reset();
  vt.add(e.timeStamp, e.clientX, e.clientY);
});
stage.addEventListener('pointermove', (e) => {
  if (!dk || e.pointerId !== dk.id) return;
  vt.add(e.timeStamp, e.clientX, e.clientY);
  const dx = e.clientX - dk.x0;
  const dy = e.clientY - dk.y0;
  if (!dk.claim) {
    if (dk.dead || Math.hypot(dx, dy) < SLOP(e)) return;
    dk.moved = true;
    if (Math.abs(dx) < Math.abs(dy) * 1.1) return void (dk.dead = true); // vertical: the page scrolls, and it is not a tap either
    dk.claim = true;
    dk.base = pos.value;
    dk.start = Math.round(pos.value);
    dk.x0 = e.clientX; // no jump at claim time
    stage.setPointerCapture(e.pointerId);
    drive(pos, pos.value);
    return;
  }
  const raw = dk.base - (e.clientX - dk.x0) / L.spacing;
  drive(pos, bandPosition(raw, N));
  const near = clamp(Math.round(pos.value), 0, N - 1);
  if (near !== cur) setCur(near);
  kick();
});
function endDeck(e: PointerEvent, cancel: boolean) {
  if (!dk || e.pointerId !== dk.id) return;
  const d = dk;
  dk = null;
  if (!d.claim) {
    if (d.moved) suppressUntil = performance.now() + 350;
    return;
  }
  suppressUntil = performance.now() + 350;
  const v = cancel ? { vx: 0 } : vt.at(e.timeStamp);
  const target = pickTarget({ pos: pos.value, startIndex: d.start, vx: v.vx, spacing: L.spacing, count: N });
  setCur(target);
  pos.set(pos.value, (-v.vx / L.spacing) * 1000);
  pos.retarget(target, cfgPos());
  kick();
}
stage.addEventListener('pointerup', (e) => endDeck(e, false));
stage.addEventListener('pointercancel', (e) => endDeck(e, true));
stage.addEventListener('touchmove', (e) => dk?.claim && e.cancelable && e.preventDefault(), { passive: false });
let wheelAt = 0;
stage.addEventListener(
  'wheel',
  (e) => {
    if (mode !== 'closed' || Math.abs(e.deltaX) < Math.abs(e.deltaY) || Math.abs(e.deltaX) < 18) return;
    e.preventDefault();
    if (performance.now() - wheelAt > 380) {
      wheelAt = performance.now();
      go(cur + Math.sign(e.deltaX));
    }
  },
  { passive: false },
);

/* ---------- detail ---------- */
function paintDetail(first: boolean) {
  const c = COLORS[cur];
  titleEl.textContent = c.name;
  nameEl.textContent = `${c.name} ${TITLE}`;
  noteEl.textContent = c.note;
  swBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(i === cur)));
  if (first) activate(cur, true);
}
function setColor(i: number, replace = true) {
  if (i === cur || (mode !== 'open' && mode !== 'opening')) return;
  const old = pos.value;
  setCur(i);
  drive(pos, i); // the deck jumps behind the scenes so closing lands on this colour's card
  toff.value = old - i;
  toff.settled = false;
  toff.target = 0;
  toff.retarget(0, cfgMisc());
  activate(i, false);
  computeFrom();
  coverEl.style.opacity = '0';
  setTimeout(() => {
    paintDetail(false);
    coverEl.style.opacity = '';
  }, 110);
  if (replace) history.replaceState(history.state, '', '#' + COLORS[i].id);
  kick();
}
swBtns.forEach((b, i) => b.addEventListener('click', () => setColor(i)));
sizeBtns.forEach((b) => b.addEventListener('click', () => sizeBtns.forEach((o) => o.setAttribute('aria-pressed', String(o === b)))));
closeBtn.addEventListener('click', requestClose);
function goAngle(k: number) {
  const a = angle.value;
  const t = Math.round((a - k) / 4) * 4 + k;
  angle.retarget(t, cfgAngle());
  kick();
}
angleBtns.forEach((b, k) => b.addEventListener('click', () => goAngle(k)));
$('.cta').addEventListener('click', (e) => e.preventDefault());

/* sheet gestures: pull down (only from scrollTop 0) scrubs p; horizontal on the hero scrubs the angle */
interface SG {
  id: number;
  x0: number;
  y0: number;
  claim: '' | 'pull' | 'angle';
  scroll0: number;
  onHero: boolean;
  base: number;
  startAngle: number;
  moved: boolean;
}
let sg: SG | null = null;
const PX_PER_ANGLE = () => L.sw * 0.62;
sheet.addEventListener('pointerdown', (e) => {
  if (mode === 'closed' || e.button > 0 || edge(e) || sg?.claim) return;
  const t = e.target as HTMLElement;
  const onHero = !!t.closest('.hero');
  if (e.pointerType === 'mouse' && !onHero && t.closest('button,a,p,h3,dd,dt,span')) return; // keep text selection / buttons for the mouse
  sg = { id: e.pointerId, x0: e.clientX, y0: e.clientY, claim: '', scroll0: sheet.scrollTop, onHero, base: 0, startAngle: 0, moved: false };
  vt.reset();
  vt.add(e.timeStamp, e.clientX, e.clientY);
});
sheet.addEventListener('pointermove', (e) => {
  if (!sg || e.pointerId !== sg.id) return;
  vt.add(e.timeStamp, e.clientX, e.clientY);
  const dx = e.clientX - sg.x0;
  const dy = e.clientY - sg.y0;
  if (!sg.claim) {
    if (Math.hypot(dx, dy) < SLOP(e)) return;
    sg.moved = true;
    if (Math.abs(dy) > Math.abs(dx)) {
      if (dy > 0 && sg.scroll0 <= 0 && !reduced()) {
        sg.claim = 'pull';
        measure();
        set('dragging');
        sheet.classList.remove('scroll', 'live');
        sg.base = p.value;
        drive(p, p.value);
        drive(dxf, 0);
      } else return void (sg = null); // the detail scrolls natively
    } else if (sg.onHero) {
      sg.claim = 'angle';
      sg.base = angle.value;
      sg.startAngle = angle.value;
      drive(angle, angle.value);
    } else return void (sg = null);
    sg.x0 = e.clientX;
    sg.y0 = e.clientY;
    sheet.setPointerCapture(e.pointerId);
    return;
  }
  if (sg.claim === 'pull') {
    const pv = sg.base - (e.clientY - sg.y0) / L.range;
    drive(p, pv > 1 ? 1 + (1 - Math.exp(-(pv - 1) * 4)) * 0.05 : Math.max(0, pv));
    drive(dxf, (e.clientX - sg.x0) * 0.9);
  } else drive(angle, sg.base - (e.clientX - sg.x0) / PX_PER_ANGLE());
  kick();
});
function endSheet(e: PointerEvent, cancel: boolean) {
  if (!sg || e.pointerId !== sg.id) return;
  const g = sg;
  sg = null;
  if (!g.claim) {
    if (!g.moved && g.onHero && mode === 'closing' && !(e.target as HTMLElement).closest('button')) {
      openFromUI(); // tap during the close: retarget the same spring back to open
    }
    return;
  }
  suppressUntil = performance.now() + 350;
  const v = cancel ? { vx: 0, vy: 0 } : vt.at(e.timeStamp);
  if (g.claim === 'angle') {
    const va = -v.vx / PX_PER_ANGLE();
    angle.set(angle.value, va * 1000);
    angle.retarget(snapAngle(angle.value, va, g.startAngle), cfgAngle());
  } else {
    const d = decideClose({ p: p.value, velocity: v.vy, range: L.range });
    p.set(p.value, (-v.vy / L.range) * 1000);
    if (d.close) {
      set('opening'); // closeCore() ignores 'closing'; reuse its setup from a neutral state
      requestClose();
    } else {
      set('opening');
      p.retarget(1, cfgP());
      dxf.retarget(0, cfgMisc());
    }
  }
  kick();
}
sheet.addEventListener('pointerup', (e) => endSheet(e, false));
sheet.addEventListener('pointercancel', (e) => endSheet(e, true));
sheet.addEventListener('touchmove', (e) => sg?.claim && e.cancelable && e.preventDefault(), { passive: false });
sheet.addEventListener('scroll', () => mode === 'open' && kick(), { passive: true });

/* ---------- keyboard ---------- */
addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Escape') {
    if (mode === 'opening' || mode === 'open' || mode === 'dragging') {
      e.preventDefault();
      requestClose();
    }
    return;
  }
  const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
  if (mode === 'closed') {
    if (dir) {
      e.preventDefault();
      go(cur + dir);
    } else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(N - 1);
  } else if (mode === 'open' && dir && !(e.target as HTMLElement).closest('.sizes,.swatches')) {
    e.preventDefault();
    angle.retarget(Math.round(angle.value) + dir, cfgAngle());
    kick();
  }
});

/* ---------- boot ---------- */
let resizeRaf = 0;
addEventListener('resize', () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    measure();
    if (mode !== 'closed') computeFrom();
    sheetBits = '';
    rvLast = [];
    kick();
    render();
  });
});
motionQuery.addEventListener?.('change', () => (render(), kick()));
measure();
setCur(Math.max(0, indexOfId(decodeURIComponent(location.hash.slice(1)))));
live.textContent = '';
syncRoving();
drive(pos, cur);
render();
if (location.hash) syncFromLocation(true);
Object.defineProperty(window, '__bonnet', { value: { get mode() { return mode; }, get p() { return p.value; }, get pos() { return pos.value; }, get cur() { return cur; }, get angle() { return angle.value; }, L } });
