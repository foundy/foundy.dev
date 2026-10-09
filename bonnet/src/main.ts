import './style.css';
import { BRAND, DEMO, FRAME_ASPECT, PRODUCTS, SET, SETS, imgInfo, imgUrl, neighbor, padCss, productIndexById, rgbCss } from './data';
import { Bonnet, type Point } from './deck';
import { attachDrag } from './drag';
import { DEBUG, initDebug, markInput, markVisual } from './debug';
import { decide } from './motion';
import { Engine, TRANSITIONS } from './gl/engine';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
const query = new URLSearchParams(location.search);

// ---------------------------------------------------------------------------------------------
// markup
// ---------------------------------------------------------------------------------------------
const N = PRODUCTS.length;
$('app').innerHTML = `
<section id="deck" aria-roledescription="carousel" aria-label="Products">
  <header class="top"><span class="brand">${BRAND}</span><span class="demo">${DEMO}</span></header>
  <div class="mid">
    <div id="stage" class="stage">
      <div id="slides" class="slides">${PRODUCTS.map((c, i) => {
        const im = imgInfo(c.images[0]);
        return `<div class="slide" role="group" aria-roledescription="slide" aria-label="${c.title}, ${i + 1} of ${N}" style="background:${padCss(im)}"><img src="${imgUrl(c.images[0])}" alt="${c.title}" width="${im.w}" height="${im.h}" draggable="false" decoding="async"></div>`;
      }).join('')}</div>
      <button id="open" class="open" type="button" data-gesture aria-label="View details"></button>
    </div>
    <div class="meta">
      <button id="prev" class="nav" type="button" aria-label="Previous product">&#8249;</button>
      <div id="cname" class="cname" aria-hidden="true"></div>
      <button id="next" class="nav" type="button" aria-label="Next product">&#8250;</button>
    </div>
  </div>
  <div id="rail" class="rail" role="group" aria-label="Choose product">${PRODUCTS.map(
    (c, i) => `<button class="yarn" type="button" data-i="${i}" style="--y:${rgbCss(c.ink)}" aria-pressed="false" aria-label="${c.title}"></button>`,
  ).join('')}</div>
  <nav class="sketch" aria-label="Sketch options">
    <div class="seg" role="group" aria-label="Transition">${TRANSITIONS.map((t) => `<button type="button" data-t="${t.id}" aria-pressed="false">${t.id}</button>`).join('')}</div>
    <div class="seg" role="group" aria-label="Catalogue">${SETS.map((s) => `<a data-set="${s}" href="?set=${s}" aria-current="${s === SET}">${s}</a>`).join('')}</div>
  </nav>
  <p id="live" class="sr" aria-live="polite"></p>
</section>
<main id="detail" hidden aria-label="Product details">
  <button id="close" class="close" type="button" aria-label="Close details">&#215;</button>
  <div class="sheet">
    <div id="hero" class="hero" style="aspect-ratio:${FRAME_ASPECT}"></div>
    <div id="dots" class="dots" role="group" aria-label="Photo"></div>
    <div class="body">
      <h1 id="dtitle" tabindex="-1"></h1>
      <p class="sub" id="dsub"></p>
      <h2>About</h2><p id="ddesc"></p>
      <div id="dmore"></div>
      <p class="note">${DEMO}</p>
    </div>
  </div>
</main>
<canvas id="gl" aria-hidden="true"></canvas>`;

const deck = $('deck'), detail = $('detail'), stage = $('stage'), slidesEl = $('slides'), openBtn = $('open');
const slides = [...slidesEl.children] as HTMLElement[];
const yarns = [...document.querySelectorAll<HTMLButtonElement>('.yarn')];
const prevBtn = $('prev'), nextBtn = $('next'), cname = $('cname'), live = $('live'), hero = $('hero'), title = $('dtitle'), dotsEl = $('dots');
const root = document.documentElement;
let dots: HTMLButtonElement[] = [];

history.scrollRestoration = 'manual';

// ---------------------------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------------------------
const startHash = productIndexById(location.hash.slice(1));
const bn = new Bonnet(startHash >= 0 ? startHash : Math.min(1, N - 1));
bn.reduced = reducedMq.matches;

// ---- GL engine (optional presentation layer) ------------------------------------------------
let engine: Engine | null = null;
let glMode = 'off';
const setGl = (m: string) => {
  glMode = m;
  root.dataset.gl = m;
};
const glDrives = () => !!engine && !engine.lost && glMode !== 'off';

const rectOf = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

function openedHook() {
  // dom hero must be decoded before it replaces the last GL frame
  const done = () => {
    bn.pageDone();
    setGl('detail');
    requestAnimationFrame(() => engine?.handoffDone());
  };
  const img = heroImgs.get(heroWant);
  if (img && !img.complete) {
    const t = setTimeout(done, 200);
    img.decode().then(
      () => (clearTimeout(t), done()),
      () => (clearTimeout(t), done()),
    );
  } else done();
}

try {
  if (!reducedMq.matches && !query.has('nogl')) {
    const canvas = $('gl') as HTMLCanvasElement;
    engine = new Engine(canvas, {
      slot: () => rectOf(stage),
      hero: () => (detail.hidden ? null : rectOf(hero)),
      opened: openedHook,
      closed: () => {
        bn.pageDone();
        setGl('deck');
      },
      lost: () => {
        setGl('off');
        if (bn.state.page === 'opening' || bn.state.page === 'closing') bn.pageDone();
      },
    });
    const t = query.get('t');
    if (t) engine.setTransition(t);
    engine.g.setPaths(PRODUCTS.map((p) => p.images[0]));
    engine.g.onReady = () => {
      engine!.invalidate();
      armGl();
      kick();
    };
  }
} catch {
  engine = null;
}

/** switch the deck from the DOM slides to GL once the front card's texture is resident */
function armGl() {
  if (!engine || engine.lost || glMode !== 'off' || reducedMq.matches) return;
  const g = engine.g;
  if (!g.has(PRODUCTS[bn.state.color].images[0]) || bn.state.page !== 'deck') return;
  engine.layout();
  syncView();
  engine.renderNow();
  engine.show();
  setGl('deck');
}

function updateWant() {
  if (!engine) return;
  const c = bn.state.color, to = bn.state.dye.to;
  const want = new Set<string>();
  for (let i = c - 2; i <= c + 2; i++) if (i >= 0 && i < N) want.add(PRODUCTS[i].images[0]);
  for (let i = to - 1; i <= to + 1; i++) if (i >= 0 && i < N) want.add(PRODUCTS[i].images[0]);
  if (bn.state.page !== 'deck') PRODUCTS[c].images.forEach((p, a) => a === bn.state.angle && want.add(p));
  engine.want([...want]);
}

const center = (el: Element): Point => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

let raf = 0;
const kick = () => {
  if (!raf) raf = requestAnimationFrame(loop);
};
function loop(now: number) {
  raf = 0;
  let more = bn.tick(now);
  if (engine && !engine.lost) {
    more = engine.frame(now) || more;
    if (glMode === 'off') armGl();
  }
  if (more) kick();
}

function syncView() {
  if (!engine) return;
  const s = bn.state;
  const { from, to, p } = s.dye;
  const sw = stage.clientWidth;
  const dx = s.edge ? s.edge * p * sw : to > from ? -p * sw : to < from ? p * sw : 0;
  const a = PRODUCTS[from].tone, b = PRODUCTS[to].tone;
  engine.ink = PRODUCTS[from].ink;
  engine.setView({ from, to, dyeP: p, edge: s.edge, tone: a.map((v, i) => Math.round(v + (b[i] - v) * p)) as [number, number, number], dx });
}

// ---------------------------------------------------------------------------------------------
// render: pure function of state (writes only what changed)
// ---------------------------------------------------------------------------------------------
const cache: Record<string, string> = {};
const set = (k: string, v: string, fn: () => void) => {
  if (cache[k] !== v) {
    cache[k] = v;
    fn();
  }
};
let lastPage = '';
let pageTimer = 0;

function render() {
  const s = bn.state;
  const { from, to, p } = s.dye;
  for (let i = 0; i < N; i++) {
    const o = i === from ? 1 : i === to && to !== from ? p : 0;
    set('o' + i, String(o), () => (slides[i].style.opacity = String(o)));
  }
  const tx = s.edge ? s.edge * p * stage.clientWidth : 0;
  set('tx', String(tx), () => (slidesEl.style.transform = tx ? `translate3d(${tx}px,0,0)` : ''));
  const a = PRODUCTS[from].tone, b = PRODUCTS[to].tone;
  const tone = `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * p)).join(',')})`;
  set('tone', tone, () => root.style.setProperty('--tone', tone));
  const near = PRODUCTS[p >= 0.5 ? to : from];
  set('name', near.title, () => (cname.textContent = near.title));

  const c = s.color;
  set('cur', String(c), () => {
    slides.forEach((el, i) => el.toggleAttribute('aria-hidden', i !== c));
    yarns.forEach((el, i) => el.setAttribute('aria-pressed', String(i === c)));
    prevBtn.setAttribute('aria-disabled', String(neighbor(c, -1) < 0));
    nextBtn.setAttribute('aria-disabled', String(neighbor(c, 1) < 0));
    openBtn.setAttribute('aria-label', `View details: ${PRODUCTS[c].title}`);
    updateWant();
  });
  set('ang', String(s.angle), () => dots.forEach((el, i) => el.setAttribute('aria-pressed', String(i === s.angle))));

  if (s.page !== lastPage) {
    const prev = lastPage;
    lastPage = s.page;
    root.dataset.page = s.page;
    detail.hidden = s.page === 'deck';
    deck.inert = s.page === 'opening' || s.page === 'detail';
    detail.inert = s.page === 'closing';
    clearTimeout(pageTimer);
    if ((s.page === 'opening' || s.page === 'closing') && !glDrives()) pageTimer = window.setTimeout(() => bn.pageDone(), s.page === 'opening' ? 280 : 150);
    if (prev === 'deck' && s.page !== 'deck') scrollTo(0, 0);
    updateWant();
    if (s.page === 'deck') armGl();
  }
  if (engine) {
    syncView();
    kick();
  }
  if (bn.animating) kick();
  if (p > 0 || s.page !== 'deck') markVisual();
}
bn.render = render;
bn.committed = (c) => {
  live.textContent = `${PRODUCTS[c].title}, ${c + 1} of ${N}`;
};

// ---------------------------------------------------------------------------------------------
// deck input (M0a rules: first-pixel drag, buttons never suppressed)
// ---------------------------------------------------------------------------------------------
const busy = () => !!engine && engine.busy && !engine.snapClose();
attachDrag(stage, {
  onStart(tr) {
    if (busy()) return;
    engine?.setPress(false);
    bn.dragStart({ x: tr.x0, y: tr.y0 });
  },
  onMove(tr, e) {
    if (busy()) return;
    markInput('drag', e.timeStamp);
    bn.dragMove(tr.p);
  },
  onEnd(tr) {
    if (busy()) return;
    bn.dragEnd(tr.velocity(), tr.width, performance.now());
    kick();
  },
  onCancel() {
    bn.dragCancel(performance.now());
    kick();
  },
});

// press feedback (pointerdown on the card): visual only, never prevents anything
let lastDown: [number, number] | null = null;
openBtn.addEventListener('pointerdown', (e) => {
  lastDown = [e.clientX, e.clientY];
  engine?.setPress(true, e.clientX, e.clientY);
  kick();
});
for (const t of ['pointerup', 'pointercancel', 'pointerleave']) {
  openBtn.addEventListener(t, () => {
    engine?.setPress(false);
    kick();
  });
}

const press = (e: MouseEvent) => markInput('button', e.timeStamp);
prevBtn.addEventListener('click', (e) => {
  press(e);
  if (!busy()) bn.step(-1, center(prevBtn), performance.now());
});
nextBtn.addEventListener('click', (e) => {
  press(e);
  if (!busy()) bn.step(1, center(nextBtn), performance.now());
});
yarns.forEach((el) =>
  el.addEventListener('click', (e) => {
    press(e);
    if (!busy()) bn.go(+el.dataset.i!, center(el), performance.now());
  }),
);
openBtn.addEventListener('click', (e) => {
  press(e);
  const pt = e.clientX || e.clientY ? ([e.clientX, e.clientY] as [number, number]) : lastDown;
  openDetail(true, true, pt);
});

addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const pg = bn.state.page;
  if (e.key === 'Escape' && (pg === 'opening' || pg === 'detail')) closeDetail();
  else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && pg === 'deck' && !busy()) {
    markInput('key', e.timeStamp);
    bn.step(e.key === 'ArrowRight' ? 1 : -1, center(stage), performance.now());
  }
});

// sketch switcher: transition changes live; catalogue is a plain link (reload)
const tBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-t]')];
const markT = () => tBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.t === (engine?.tr.id ?? query.get('t') ?? 'lift'))));
tBtns.forEach((b) =>
  b.addEventListener('click', () => {
    if (!engine || busy() || bn.state.page !== 'deck') return;
    engine.setTransition(b.dataset.t!);
    const u = new URL(location.href);
    u.searchParams.set('t', b.dataset.t!);
    history.replaceState(history.state, '', u);
    document.querySelectorAll<HTMLAnchorElement>('[data-set]').forEach((a) => (a.href = `?set=${a.dataset.set}&t=${b.dataset.t}${DEBUG ? '&debug' : ''}`));
    markT();
    kick();
  }),
);
document.querySelectorAll<HTMLAnchorElement>('[data-set]').forEach((a) => {
  const t = query.get('t');
  a.href = `?set=${a.dataset.set}${t ? `&t=${t}` : ''}${DEBUG ? '&debug' : ''}`;
});
markT();

// ---------------------------------------------------------------------------------------------
// detail
// ---------------------------------------------------------------------------------------------
const heroImgs = new Map<string, HTMLImageElement>();
let heroWant = '';
let heroZ = 1;
let heroTimer = 0;

function fillDetail(c: number) {
  const pr = PRODUCTS[c];
  title.textContent = pr.title;
  $('dsub').textContent = pr.price;
  $('ddesc').textContent = pr.desc;
  $('dmore').innerHTML = pr.details.map(([h, l]) => `<h2>${h}</h2>${l.length === 1 ? `<p>${l[0]}</p>` : `<ul>${l.map((x) => `<li>${x}</li>`).join('')}</ul>`}`).join('');
  dotsEl.innerHTML = pr.images.length > 1 ? pr.images.map((_, i) => `<button class="dot" type="button" data-a="${i}" aria-pressed="false" aria-label="Photo ${i + 1} of ${pr.images.length}"></button>`).join('') : '';
  dots = [...dotsEl.querySelectorAll<HTMLButtonElement>('.dot')];
  dots.forEach((el) =>
    el.addEventListener('click', (e) => {
      press(e);
      bn.setAngle(+el.dataset.a!);
      heroNow();
    }),
  );
  hero.style.background = padCss(imgInfo(pr.images[0]));
  cache.ang = '';
}

function showHero(color: number, angle: number, ms: number) {
  const pr = PRODUCTS[color];
  const a = Math.min(angle, pr.images.length - 1);
  const key = `${color}-${a}`;
  heroWant = key;
  let img = heroImgs.get(key);
  if (!img) {
    const info = imgInfo(pr.images[a]);
    img = new Image();
    img.alt = `${pr.title}, photo ${a + 1}`;
    img.draggable = false;
    img.width = info.w;
    img.height = info.h;
    img.decoding = 'async';
    img.style.background = padCss(info);
    img.src = imgUrl(pr.images[a]);
    heroImgs.set(key, img);
    hero.append(img);
  }
  const im = img;
  const reveal = () => {
    if (heroWant !== key) return; // a newer request owns the hero; this one stays hidden
    if (im.classList.contains('on')) return;
    const d = reducedMq.matches ? 0 : ms;
    im.style.setProperty('--d', d + 'ms');
    im.style.zIndex = String(++heroZ);
    im.classList.add('on');
    clearTimeout(heroTimer);
    heroTimer = window.setTimeout(() => heroImgs.forEach((o) => o !== im && o.classList.remove('on')), d + 30);
  };
  // texture-ready rule: keep the previous photo until the new one is decoded
  if (ms === 0 && im.complete && im.naturalWidth) reveal();
  else im.decode().then(reveal, reveal);
}

const heroNow = () => {
  showHero(bn.state.color, bn.state.angle, 180);
  updateWant();
};

function openDetail(push: boolean, animated = true, tap: [number, number] | null = null) {
  if (!bn.open(animated)) return;
  const id = '#' + PRODUCTS[bn.state.color].id;
  if (push && location.hash !== id) {
    history.pushState({ bonnet: 1 }, '', id);
  } else if (!push) {
    history.replaceState(history.state, '', id);
  }
  fillDetail(bn.state.color);
  heroImgs.forEach((o) => o.classList.remove('on'));
  showHero(bn.state.color, 0, 0);
  if (animated) title.focus({ preventScroll: true });
  if (animated && glDrives() && engine) {
    setGl('run');
    engine.heroPath = null;
    engine.open(tap?.[0], tap?.[1]);
    kick();
  } else if (glMode === 'deck') {
    setGl('detail');
    engine?.hide();
  }
}

/** every close path (button, Esc, Back) goes through here so GL and the state model stay in step */
function startClose() {
  const pg = bn.state.page;
  if (pg !== 'opening' && pg !== 'detail') return false;
  if (engine && !engine.lost && glMode !== 'off') {
    const c = bn.state.color, ang = bn.state.angle;
    const path = PRODUCTS[c].images[Math.min(ang, PRODUCTS[c].images.length - 1)];
    const ok = ang === 0 || engine.g.has(path);
    engine.heroPath = ang === 0 || !ok ? null : path;
    if (engine.close(!ok)) setGl('run');
  }
  bn.close(true);
  kick();
  return true;
}

function closeDetail() {
  if (!(bn.state.page === 'opening' || bn.state.page === 'detail')) return;
  const own = history.state && history.state.bonnet === 1;
  startClose();
  if (own) history.back();
  else history.replaceState(null, '', location.pathname + location.search);
  stage.querySelector<HTMLElement>('.open')!.focus({ preventScroll: true });
}

$('close').addEventListener('click', (e) => {
  press(e);
  closeDetail();
});

addEventListener('popstate', () => {
  const i = productIndexById(location.hash.slice(1));
  const pg = bn.state.page;
  if (i < 0) {
    if (pg === 'opening' || pg === 'detail') startClose();
    return;
  }
  if (i !== bn.state.color) bn.setColor(i, center(stage));
  if (pg === 'deck' || pg === 'closing') {
    openDetail(false, true, null);
    history.replaceState(history.state, '', '#' + PRODUCTS[i].id);
  } else heroNow();
});

attachDrag(hero, {
  onMove(_tr, e) {
    markInput('hero-drag', e.timeStamp);
  },
  onEnd(tr) {
    const n = PRODUCTS[bn.state.color].images.length;
    if (n < 2) return;
    const sign = Math.sign(tr.dx);
    // 0.2 of the hero width is as far as 0.5 of a deck swipe: reuse the same decision function
    if (decide((Math.abs(tr.dx) / tr.width) * 2.5, tr.velocity() * sign) === 'commit') {
      bn.setAngle(((bn.state.angle + (sign < 0 ? 1 : -1)) % n + n) % n);
      heroNow();
    }
  },
  onCancel() {},
});

// ---------------------------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------------------------
addEventListener('resize', () => {
  if (engine && !engine.lost) {
    engine.layout();
    kick();
  }
});
reducedMq.addEventListener('change', () => {
  bn.reduced = reducedMq.matches;
  if (reducedMq.matches && engine) {
    engine.hide();
    setGl('off');
  }
});

root.dataset.gl = 'off';
if (startHash >= 0) {
  bn.render();
  fillDetail(startHash);
  openDetail(false, false);
} else {
  fillDetail(bn.state.color);
  render();
}
updateWant();

initDebug(
  () => bn.state,
  () => {
    if (!engine) return `gl: none (${reducedMq.matches ? 'reduced motion' : 'unavailable'})\n`;
    const st = engine.stats();
    return (
      `${engine.name} ${glMode}${engine.lost ? ' LOST' : ''}  p ${engine.p.toFixed(3)}  dp ${engine.v.toFixed(2)}/s\n` +
      `gl frame p50 ${st.p50.toFixed(1)} p95 ${st.p95.toFixed(1)}ms  >33 ${(st.slow * 100).toFixed(1)}%  stall ${st.longest.toFixed(0)}ms\n` +
      `tex ${st.textures} ~${st.mb.toFixed(1)}MB  ${st.renderer.slice(0, 44)}\n`
    );
  },
  () => engine?.resetStats(),
);
if (DEBUG) {
  Object.defineProperty(window, '__bonnet', {
    get: () => ({
      ...JSON.parse(JSON.stringify(bn.state)),
      animating: bn.animating || !!engine?.busy,
      hero: heroWant,
      scrollY,
      gl: glMode,
      p: engine?.p ?? 0,
      mode: engine?.mode ?? 'none',
    }),
  });
  // test hooks (video/screenshot script): freeze p, or hold the last GL frame and hand off on demand
  (window as unknown as Record<string, unknown>).__gl = {
    scrub: (p: number, open: boolean, t?: string) => engine?.scrub(p, open, t),
    hold: (b: boolean) => engine && (engine.hold = b),
    handoff: () => {
      if (engine) {
        engine.hold = false;
        openedHook();
      }
    },
    release: () => engine?.release(),
  };
}
