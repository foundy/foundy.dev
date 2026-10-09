import './style.css';
import { ANGLE_LABELS, COLORS, COPY, colorIndexById, neighbor, photoUrl } from './data';
import { Bonnet, type Point } from './deck';
import { attachDrag } from './drag';
import { DEBUG, initDebug, markInput, markVisual } from './debug';
import { decide } from './motion';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');

// ---------------------------------------------------------------------------------------------
// markup
// ---------------------------------------------------------------------------------------------
const N = COLORS.length;
$('app').innerHTML = `
<section id="deck" aria-roledescription="carousel" aria-label="Bonnet colors">
  <header class="top"><span class="brand">bonnet</span><span class="demo">${COPY.demo}</span></header>
  <div class="mid">
    <div id="stage" class="stage">
      <div id="slides" class="slides">${COLORS.map(
        (c, i) =>
          `<div class="slide" role="group" aria-roledescription="slide" aria-label="${c.name}, ${i + 1} of ${N}">${
            c.file ? `<img src="${photoUrl(i, 0)}" alt="${c.name} bonnet" width="625" height="625" draggable="false" decoding="async"${i === 1 ? ' fetchpriority="high"' : ''}>` : ''
          }</div>`,
      ).join('')}</div>
      <button id="open" class="open" type="button" data-gesture aria-label="View details"></button>
    </div>
    <div class="meta">
      <button id="prev" class="nav" type="button" aria-label="Previous color">&#8249;</button>
      <div id="cname" class="cname" aria-hidden="true"></div>
      <button id="next" class="nav" type="button" aria-label="Next color">&#8250;</button>
    </div>
  </div>
  <div id="rail" class="rail" role="group" aria-label="Choose color">${COLORS.map(
    (c, i) =>
      `<button class="yarn" type="button" data-i="${i}" style="--y:${c.yarn}" aria-pressed="false" aria-label="${c.name}${c.file ? '' : ' (coming soon)'}"${c.file ? '' : ' disabled'}></button>`,
  ).join('')}</div>
  <p id="live" class="sr" aria-live="polite"></p>
</section>
<main id="detail" hidden aria-label="Product details">
  <button id="close" class="close" type="button" aria-label="Close details">&#215;</button>
  <div class="sheet">
    <div id="hero" class="hero"></div>
    <div id="dots" class="dots" role="group" aria-label="Photo angle">${ANGLE_LABELS.map(
      (l, i) => `<button class="dot" type="button" data-a="${i}" aria-pressed="false" aria-label="${l}"></button>`,
    ).join('')}</div>
    <div class="body">
      <h1 id="dtitle" tabindex="-1">${COPY.name}</h1>
      <p class="sub"><span id="dcolor"></span> &middot; ${COPY.price}</p>
      <div id="swatches" class="swatches" role="group" aria-label="Color">${COLORS.map(
        (c, i) =>
          `<button class="swatch" type="button" data-i="${i}" style="--y:${c.yarn}" aria-pressed="false" aria-label="${c.name}${c.file ? '' : ' (coming soon)'}"${c.file ? '' : ' disabled'}></button>`,
      ).join('')}</div>
      <h2>Story</h2><p>${COPY.story}</p>
      <h2>Materials</h2><ul>${COPY.materials.map((m) => `<li>${m}</li>`).join('')}</ul>
      <h2>Sizes</h2><ul>${COPY.sizes.map((m) => `<li>${m}</li>`).join('')}</ul>
      <h2>Care</h2><p>${COPY.care}</p>
      <p class="note">${COPY.demo}</p>
    </div>
  </div>
</main>`;

const deck = $('deck'), detail = $('detail'), stage = $('stage'), slidesEl = $('slides'), openBtn = $('open');
const slides = [...slidesEl.children] as HTMLElement[];
const yarns = [...document.querySelectorAll<HTMLButtonElement>('.yarn')];
const swatches = [...document.querySelectorAll<HTMLButtonElement>('.swatch')];
const dots = [...document.querySelectorAll<HTMLButtonElement>('.dot')];
const prevBtn = $('prev'), nextBtn = $('next'), cname = $('cname'), live = $('live'), hero = $('hero'), title = $('dtitle');
const root = document.documentElement;

history.scrollRestoration = 'manual';

// ---------------------------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------------------------
const startHash = colorIndexById(location.hash.slice(1));
const bn = new Bonnet(startHash >= 0 ? startHash : 1);
bn.reduced = reducedMq.matches;
reducedMq.addEventListener('change', () => (bn.reduced = reducedMq.matches));

const center = (el: Element): Point => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

let raf = 0;
const kick = () => {
  if (!raf) raf = requestAnimationFrame(loop);
};
function loop() {
  raf = 0;
  if (bn.tick(performance.now())) kick();
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
  const a = COLORS[from].tone, b = COLORS[to].tone;
  const tone = `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * p)).join(',')})`;
  set('tone', tone, () => root.style.setProperty('--tone', tone));
  const near = COLORS[p >= 0.5 ? to : from];
  set('name', near.name, () => (cname.textContent = near.name));

  const c = s.color;
  set('cur', String(c), () => {
    slides.forEach((el, i) => el.toggleAttribute('aria-hidden', i !== c));
    yarns.forEach((el, i) => el.setAttribute('aria-pressed', String(i === c)));
    swatches.forEach((el, i) => el.setAttribute('aria-pressed', String(i === c)));
    prevBtn.setAttribute('aria-disabled', String(neighbor(c, -1) < 0));
    nextBtn.setAttribute('aria-disabled', String(neighbor(c, 1) < 0));
    $('dcolor').textContent = COLORS[c].name;
    openBtn.setAttribute('aria-label', `View details: ${COLORS[c].name}`);
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
    if (s.page === 'opening' || s.page === 'closing') pageTimer = window.setTimeout(() => bn.pageDone(), s.page === 'opening' ? 280 : 150);
    if (prev === 'deck' && s.page !== 'deck') scrollTo(0, 0);
  }
  if (bn.animating) kick();
  if (p > 0 || s.page !== 'deck') markVisual();
}
bn.render = render;
bn.committed = (c) => {
  live.textContent = `${COLORS[c].name}, ${c + 1} of ${N}`;
};

// ---------------------------------------------------------------------------------------------
// deck input
// ---------------------------------------------------------------------------------------------
attachDrag(stage, {
  onStart(tr) {
    bn.dragStart({ x: tr.x0, y: tr.y0 });
  },
  onMove(tr, e) {
    markInput('drag', e.timeStamp);
    bn.dragMove(tr.p);
  },
  onEnd(tr) {
    bn.dragEnd(tr.velocity(), tr.width, performance.now());
    kick();
  },
  onCancel() {
    bn.dragCancel(performance.now());
    kick();
  },
});

const press = (e: MouseEvent) => markInput('button', e.timeStamp);
prevBtn.addEventListener('click', (e) => {
  press(e);
  bn.step(-1, center(prevBtn), performance.now());
});
nextBtn.addEventListener('click', (e) => {
  press(e);
  bn.step(1, center(nextBtn), performance.now());
});
yarns.forEach((el) =>
  el.addEventListener('click', (e) => {
    press(e);
    bn.go(+el.dataset.i!, center(el), performance.now());
  }),
);
openBtn.addEventListener('click', (e) => {
  press(e);
  openDetail(true);
});

addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const pg = bn.state.page;
  if (e.key === 'Escape' && (pg === 'opening' || pg === 'detail')) closeDetail();
  else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && pg === 'deck') {
    markInput('key', e.timeStamp);
    bn.step(e.key === 'ArrowRight' ? 1 : -1, center(stage), performance.now());
  }
});

// ---------------------------------------------------------------------------------------------
// detail
// ---------------------------------------------------------------------------------------------
const heroImgs = new Map<string, HTMLImageElement>();
let heroWant = '';
let heroZ = 1;
let heroTimer = 0;

function showHero(color: number, angle: number, ms: number) {
  const key = `${color}-${angle}`;
  heroWant = key;
  let img = heroImgs.get(key);
  if (!img) {
    img = new Image();
    img.alt = `${COLORS[color].name} bonnet, ${ANGLE_LABELS[angle].toLowerCase()}`;
    img.draggable = false;
    img.width = img.height = 625;
    img.decoding = 'async';
    img.src = photoUrl(color, angle);
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

const heroNow = () => showHero(bn.state.color, bn.state.angle, 180);

function openDetail(push: boolean, animated = true) {
  if (!bn.open(animated)) return;
  const id = '#' + COLORS[bn.state.color].id;
  if (push && location.hash !== id) {
    history.pushState({ bonnet: 1 }, '', id);
  } else if (!push) {
    history.replaceState(history.state, '', id);
  }
  heroImgs.forEach((o) => o.classList.remove('on'));
  showHero(bn.state.color, 0, 0);
  if (animated) title.focus({ preventScroll: true });
}

function closeDetail() {
  const pg = bn.state.page;
  if (pg !== 'opening' && pg !== 'detail') return;
  const own = history.state && history.state.bonnet === 1;
  bn.close(true);
  if (own) history.back();
  else history.replaceState(null, '', location.pathname + location.search);
  stage.querySelector<HTMLElement>('.open')!.focus({ preventScroll: true });
}

$('close').addEventListener('click', (e) => {
  press(e);
  closeDetail();
});

addEventListener('popstate', () => {
  const i = colorIndexById(location.hash.slice(1));
  const pg = bn.state.page;
  if (i < 0) {
    if (pg === 'opening' || pg === 'detail') bn.close(true);
    return;
  }
  if (i !== bn.state.color) bn.setColor(i, center(stage));
  if (pg === 'deck' || pg === 'closing') {
    bn.open(true);
    showHero(i, 0, 0);
    title.focus({ preventScroll: true });
  } else heroNow();
});

swatches.forEach((el) =>
  el.addEventListener('click', (e) => {
    press(e);
    const i = +el.dataset.i!;
    if (bn.setColor(i, center(el))) {
      history.replaceState(history.state, '', '#' + COLORS[i].id);
      showHero(i, bn.state.angle, 200);
    }
  }),
);
dots.forEach((el) =>
  el.addEventListener('click', (e) => {
    press(e);
    bn.setAngle(+el.dataset.a!);
    heroNow();
  }),
);

attachDrag(hero, {
  onMove(_tr, e) {
    markInput('hero-drag', e.timeStamp);
  },
  onEnd(tr) {
    const sign = Math.sign(tr.dx);
    // 0.2 of the hero width is as far as 0.5 of a deck swipe: reuse the same decision function
    if (decide((Math.abs(tr.dx) / tr.width) * 2.5, tr.velocity() * sign) === 'commit') {
      bn.setAngle(bn.state.angle + (sign < 0 ? 1 : -1));
      heroNow();
    }
  },
  onCancel() {},
});

// ---------------------------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------------------------
if (startHash >= 0) {
  bn.render();
  openDetail(false, false);
} else render();

initDebug(() => bn.state);
if (DEBUG) {
  Object.defineProperty(window, '__bonnet', {
    get: () => ({ ...JSON.parse(JSON.stringify(bn.state)), animating: bn.animating, hero: heroWant, scrollY }),
  });
}
