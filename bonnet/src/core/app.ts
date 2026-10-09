// The shared product engine. Owns: products, the state machine (world, index, page, p), the router, the DOM detail page,
// the input rules, the GL -> DOM hand-off and the debug overlay. Worlds only render.
import { LightWorld } from '../worlds/light';
import { WaterWorld } from '../worlds/water';
import { Wake, type DragPoint, type Host, type View, type World } from '../worlds/types';
import { Compositor, GL } from '../gl/context';
import { Textures } from '../gl/textures';
import { LIGHT_DECIDE, WATER_DECIDE, clamp, decideTarget, smooth } from './commit';
import { DEBUG, initDebug, markInput, markVisual } from './debug';
import { Detail, detailMarkup, type Rect } from './detail';
import { attachStage } from './input';
import { BRAND, DEMO, PRODUCTS, SET, SETS, imgInfo, imgUrl, padCss, rgbCss } from './products';
import { buildUrl, indexFromHash, loadWorld, resolveStart, saveWorld } from './router';
import { Core, DEFAULT_SPRING, WORLDS, type WorldId } from './state';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const N = PRODUCTS.length;
const IDS = PRODUCTS.map((p) => p.id);
const ZERO: Rect = { x: 0, y: 0, w: 0, h: 0 };
const WORLD_NAME: Record<WorldId, string> = { light: 'Light', water: 'Water' };
const HINT: Record<WorldId, string> = { light: 'drag to spin · tap the light', water: 'touch the water' };
const CHEV = (d: string) => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function boot() {
  const root = document.documentElement;
  const query = new URLSearchParams(location.search);
  const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
  history.scrollRestoration = 'manual';

  // -------------------------------------------------------------------------------------------
  // markup
  // -------------------------------------------------------------------------------------------
  $('app').innerHTML = `
<div id="browse" class="browse">
  <header class="hud">
    <div class="hud-l"><span class="brand">${BRAND}</span><nav class="sets" aria-label="Catalogue">${SETS.map((s) => `<a data-set="${s}" href="?set=${s}" aria-current="${s === SET}">${s}</a>`).join('')}</nav></div>
    <div class="switch" role="group" aria-label="World">${WORLDS.map((w) => `<button type="button" data-w="${w}" aria-pressed="false">${WORLD_NAME[w]}</button>`).join('')}</div>
  </header>
  <div id="stage" class="stage" aria-roledescription="carousel" aria-label="Products">
    <div id="fb" class="fb" aria-hidden="true"><div class="fbc"></div></div>
    <button id="open" class="open" type="button" data-gesture aria-label="View details"></button>
  </div>
  <p id="hint" class="hint"></p>
  <div class="meta">
    <button id="prev" class="nav" type="button" aria-label="Previous product">${CHEV('M15 5l-7 7 7 7')}</button>
    <div class="cap" aria-hidden="true"><span id="cidx"></span><span id="cname"></span><span id="cprice"></span></div>
    <button id="next" class="nav" type="button" aria-label="Next product">${CHEV('M9 5l7 7-7 7')}</button>
  </div>
  <p id="live" class="sr" aria-live="polite"></p>
</div>
<main id="detail" hidden aria-label="Product details">${detailMarkup(DEMO)}</main>
<canvas id="gl" aria-hidden="true"></canvas>`;

  const browseEl = $('browse'), stage = $('stage'), openBtn = $('open'), canvas = $<HTMLCanvasElement>('gl');
  const prevBtn = $('prev'), nextBtn = $('next'), live = $('live'), hint = $('hint'), fbc = document.querySelector<HTMLElement>('#fb .fbc')!;
  const cidx = $('cidx'), cname = $('cname'), cprice = $('cprice');
  const wBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-w]')];

  // -------------------------------------------------------------------------------------------
  // state
  // -------------------------------------------------------------------------------------------
  const start = resolveStart(location.search, location.hash, IDS, loadWorld());
  const core = new Core(N, start.world, start.detail >= 0 ? start.detail : Math.min(1, N - 1));
  core.reduced = reducedMq.matches;
  const pointerMark = (e: Event) => markInput('button', e.timeStamp);
  const detail = new Detail($('detail'), pointerMark);
  detail.reduced = core.reduced;
  const titleEl = $('dtitle');

  let G: GL | null = null;
  let textures: Textures | null = null;
  let comp: Compositor | null = null;
  const worlds: Partial<Record<WorldId, World>> = {};
  let glMode: 'boot' | 'off' | 'on' | 'hidden' = 'boot';
  const setGl = (m: typeof glMode) => {
    glMode = m;
    root.dataset.gl = m;
  };
  const glOk = () => !!G && !G.lost && glMode !== 'off' && !core.reduced;
  const curWorld = () => worlds[core.state.world] ?? null;

  // -------------------------------------------------------------------------------------------
  // GL setup (optional presentation layer)
  // -------------------------------------------------------------------------------------------
  const host = (): Host => ({ g: G!, textures: textures!, products: PRODUCTS, wake: () => kick() });
  function makeWorld(id: WorldId): World | null {
    if (!G) return null;
    if (worlds[id]) return worlds[id]!;
    try {
      const w = id === 'light' ? new LightWorld() : new WaterWorld();
      w.init(host());
      w.resize(G.W, G.H, G.dpr);
      w.setIndex(core.state.index, true);
      worlds[id] = w;
      return w;
    } catch (e) {
      console.warn('world init failed', id, e);
      return null;
    }
  }
  function sizeGl() {
    if (!G) return;
    G.resize(innerWidth, innerHeight, devicePixelRatio);
    for (const w of Object.values(worlds)) w?.resize(G.W, G.H, G.dpr);
    comp?.free();
    kick();
  }
  function initGl() {
    if (core.reduced || query.has('nogl')) return fallback();
    try {
      G = new GL(canvas);
      textures = new Textures(G, PRODUCTS);
      comp = new Compositor(G);
      G.resize(innerWidth, innerHeight, devicePixelRatio);
      textures.onReady(() => kick());
      const cur = core.state.index;
      textures.load([cur, cur + 1, cur - 1, cur + 2, cur - 2, ...PRODUCTS.map((_, i) => i)]);
      canvas.addEventListener('webglcontextlost', () => fallback());
      const w = makeWorld(core.state.world);
      if (!w) return fallback();
      w.enter?.();
      setGl(core.state.page === 'browse' ? 'on' : 'hidden');
      // compile the other world while idle so switching never pays for it on a tap frame
      const other = WORLDS.find((x) => x !== core.state.world)!;
      const warm = () => {
        if (G && !G.lost) makeWorld(other);
      };
      if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 2500 });
      else setTimeout(warm, 1500);
      kick();
    } catch (e) {
      console.warn('webgl unavailable', e);
      fallback();
    }
  }
  function fallback() {
    setGl('off');
    syncFallback();
    const pg = core.state.page;
    if (pg === 'opening') {
      core.settle();
      finishOpenDom();
    } else if (pg === 'closing') {
      core.settle();
      finishCloseDom();
    }
    renderPage();
  }
  function syncFallback() {
    const pr = PRODUCTS[core.state.index];
    const im = imgInfo(pr.images[0]);
    fbc.style.background = padCss(im);
    fbc.innerHTML = `<img src="${imgUrl(pr.images[0])}" alt="${pr.title}" width="${im.w}" height="${im.h}" draggable="false">`;
  }

  // -------------------------------------------------------------------------------------------
  // frame loop
  // -------------------------------------------------------------------------------------------
  let raf = 0, tmo = 0, last = 0;
  function kick() {
    if (document.hidden) return;
    if (tmo) (clearTimeout(tmo), (tmo = 0));
    if (!raf) raf = requestAnimationFrame(frame);
  }
  const view = (now: number): View => {
    const s = core.state;
    const pr = PRODUCTS[s.index];
    return { index: s.index, p: s.p, pv: s.pv, hero: s.page === 'browse' && s.p === 0 ? ZERO : detail.rect(), tone: pr.tone, ink: pr.ink, time: now / 1000 };
  };
  let firstDrawn = false;
  let fadeUntil = 0;
  let handing = false;

  function drawGl(now: number, dt: number): Wake {
    if (!G || G.lost) return Wake.Sleep;
    const st = core.state;
    const v = view(now);
    const w = worlds[st.world];
    if (!w) return Wake.Sleep;
    let wake: Wake;
    if (st.sw && worlds[st.sw.from] && comp) {
      const [ta, tb] = comp.targets();
      worlds[st.sw.from]!.render(dt, v, ta);
      w.render(dt, v, tb);
      comp.draw(core.mix, G.screen());
      wake = Wake.Active;
    } else {
      wake = w.render(dt, v, G.screen());
      comp?.tickIdle(dt);
    }
    if (!firstDrawn) {
      firstDrawn = true;
      requestAnimationFrame(() => root.classList.add('ready'));
    }
    return wake;
  }

  function frame(now: number) {
    raf = 0;
    const dt = last ? clamp((now - last) / 1000, 0, 0.05) : 1 / 60;
    last = now;
    const w = curWorld();
    let more = core.tick(dt, w?.spring ?? DEFAULT_SPRING);
    if (textures) more = textures.pump(now) || more;
    let wake: Wake = Wake.Sleep;
    if (glMode === 'on') wake = drawGl(now, dt);
    renderPage();
    stepHandoff(now);
    if (core.state.sw) {
      // swap the chrome theme at the midpoint of the crossfade
      if (core.state.sw.t > 0.45) root.dataset.world = core.state.world;
    }
    if (DEBUG && (core.state.p > 0 || core.state.sw)) markVisual();
    // schedule
    if (document.hidden) return;
    if (more || wake === Wake.Active || core.state.sw || handing || core.transitioning) raf = requestAnimationFrame(frame);
    else if (wake === Wake.Idle) tmo = window.setTimeout(() => ((tmo = 0), (raf = requestAnimationFrame(frame))), 34);
  }

  // -------------------------------------------------------------------------------------------
  // page rendering: pure function of core state (writes only what changed)
  // -------------------------------------------------------------------------------------------
  const cache: Record<string, string> = {};
  const set = (k: string, v: string, fn: () => void) => {
    if (cache[k] !== v) (cache[k] = v), fn();
  };
  let lastPage = '';
  function renderPage() {
    const s = core.state;
    const w = curWorld();
    set('world', s.world + (s.sw ? '~' : ''), () => {
      wBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.w === s.world)));
      if (!s.sw) root.dataset.world = s.world;
      hint.textContent = HINT[s.world];
    });
    if (!s.sw) set('world2', s.world, () => (root.dataset.world = s.world));
    const near = glMode === 'on' && w ? w.nearest() : s.index;
    set('near', String(near), () => {
      const pr = PRODUCTS[near];
      cidx.textContent = `${String(near + 1).padStart(2, '0')} / ${String(N).padStart(2, '0')}`;
      cname.textContent = pr.title;
      cprice.textContent = pr.price;
    });
    set('cur', String(s.index), () => {
      prevBtn.setAttribute('aria-disabled', String(core.neighbor(-1) < 0));
      nextBtn.setAttribute('aria-disabled', String(core.neighbor(1) < 0));
      openBtn.setAttribute('aria-label', `View details: ${PRODUCTS[s.index].title}`);
      if (glMode === 'off') syncFallback();
      live.textContent = `${PRODUCTS[s.index].title}, ${s.index + 1} of ${N}`;
    });
    const chrome = (1 - smooth(0, 0.28, s.p)).toFixed(3);
    set('chrome', chrome, () => root.style.setProperty('--chrome', chrome));
    const tr = w?.textRange ?? [0.5, 0.9];
    const tp = (s.page === 'detail' ? 1 : smooth(tr[0], tr[1], s.p)).toFixed(3);
    set('tp', tp, () => root.style.setProperty('--tp', tp));
    if (s.page !== lastPage) {
      lastPage = s.page;
      root.dataset.page = s.page;
      browseEl.inert = s.page === 'opening' || s.page === 'detail';
      detail.el.inert = s.page === 'closing';
    }
  }

  // -------------------------------------------------------------------------------------------
  // hand-off contract
  //   open : p reaches 1 -> decode the DOM hero -> show it (GL still drawn underneath) -> next rAF hide GL
  //   close: draw the GL hero at the DOM hero's exact rect -> next rAF hide the DOM hero -> spring p to 0 from there
  //   off-screen hero on close: short crossfade instead (the hero cannot be matched)
  // -------------------------------------------------------------------------------------------
  function stepHandoff(now: number) {
    const s = core.state;
    if (s.page === 'opening' && s.p === 1 && !handing) {
      handing = true;
      detail.decoded(250).then(() => {
        handing = false;
        if (core.state.page !== 'opening' || core.state.p !== 1) return;
        detail.el.classList.remove('gl-hero'); // DOM hero on top of the identical GL frame
        root.classList.add('solid');
        requestAnimationFrame(() => {
          if (core.state.page !== 'opening') return;
          setGl('hidden');
          worlds[core.state.world]?.sleep();
          core.settle();
          renderPage();
        });
      });
    }
    if (s.page === 'closing' && s.p === 0 && now >= fadeUntil) finishClose();
  }

  const onScreen = (r: Rect) => Math.min(r.y + r.h, innerHeight) - Math.max(r.y, 0) > r.h * 0.5;

  function finishOpenDom() {
    detail.el.classList.remove('gl-hero');
    root.classList.add('solid');
  }
  function finishCloseDom() {
    detail.el.hidden = true;
    detail.el.classList.remove('gl-hero', 'fadeout');
    root.classList.remove('solid', 'fadeclose');
    scrollTo(0, 0);
  }
  function finishClose() {
    if (core.state.page !== 'closing') return;
    core.settle();
    finishCloseDom();
    if (glMode === 'hidden') setGl('on');
    renderPage();
    worlds[core.state.world]?.wake();
    kick();
  }

  function openDetail(push: boolean, animated = true) {
    const idx = core.state.index;
    const gl = glOk() && animated && glMode === 'on' && !!curWorld();
    if (!core.open(gl)) return;
    const id = '#' + PRODUCTS[idx].id;
    const url = buildUrl(location, { id: PRODUCTS[idx].id });
    if (push && location.hash !== id) history.pushState({ bonnet: 1 }, '', url);
    else if (!push) history.replaceState(history.state, '', url);
    detail.fill(idx);
    root.style.setProperty('--tone', rgbCss(PRODUCTS[idx].tone));
    detail.show(idx, 0, 0);
    detail.el.hidden = false;
    detail.el.classList.remove('fadeout');
    scrollTo(0, 0);
    if (core.state.page === 'opening') {
      detail.el.classList.add('gl-hero');
      curWorld()!.setIndex(idx, true);
      root.classList.remove('solid', 'fadeclose');
    } else {
      finishOpenDom();
      if (glMode === 'on') setGl('hidden');
    }
    renderPage();
    if (animated) titleEl.focus({ preventScroll: true });
    kick();
  }

  /** every close path (button, Esc, Back) goes through here so GL and the state model stay in step */
  function startClose(): boolean {
    const s = core.state;
    if (s.page !== 'opening' && s.page !== 'detail') return false;
    const w = curWorld();
    const wasDetail = s.page === 'detail';
    if (!glOk() || !w) {
      core.close(false);
      finishCloseDom();
      renderPage();
      return true;
    }
    core.close(true);
    if (wasDetail) {
      const r = detail.rect();
      if (onScreen(r)) {
        // GL draws the hero at the DOM hero's exact rect first, then the DOM hero goes away on the next frame
        if (glMode === 'hidden') setGl('on');
        w.wake();
        drawGl(performance.now(), 1 / 60);
        requestAnimationFrame(() => {
          detail.el.classList.add('gl-hero');
          root.classList.remove('solid');
        });
      } else {
        // the hero is scrolled away: nothing to match, a short crossfade back to the world
        core.state.p = 0;
        core.state.pv = 0;
        fadeUntil = performance.now() + 300;
        if (glMode === 'hidden') setGl('on');
        root.classList.add('fadeclose');
        detail.el.classList.add('fadeout');
        w.wake();
      }
    }
    renderPage();
    kick();
    return true;
  }

  function closeDetail() {
    if (!(core.state.page === 'opening' || core.state.page === 'detail')) return;
    const own = history.state && history.state.bonnet === 1;
    startClose();
    if (own) history.back();
    else history.replaceState(null, '', buildUrl(location, { id: null }));
    openBtn.focus({ preventScroll: true });
  }
  $('close').addEventListener('click', (e) => {
    pointerMark(e);
    closeDetail();
  });

  addEventListener('popstate', () => {
    const i = indexFromHash(location.hash, IDS);
    const pg = core.state.page;
    if (i < 0) {
      if (pg === 'opening' || pg === 'detail') startClose();
      return;
    }
    if (i !== core.state.index) {
      core.forceIndex(i);
      for (const w of Object.values(worlds)) w?.setIndex(i, true);
      if (pg === 'detail' || pg === 'opening') {
        detail.fill(i);
        detail.show(i, 0, 0);
        root.style.setProperty('--tone', rgbCss(PRODUCTS[i].tone));
      }
    }
    if (pg === 'browse' || pg === 'closing') {
      if (pg === 'closing') finishCloseDom(), core.settle();
      openDetail(false, true);
      history.replaceState(history.state, '', buildUrl(location, { id: PRODUCTS[i].id }));
    }
    renderPage();
  });

  // -------------------------------------------------------------------------------------------
  // browse input
  // -------------------------------------------------------------------------------------------
  const decideOpts = (id: WorldId) => ({ ...(id === 'light' ? LIGHT_DECIDE : WATER_DECIDE), n: N });
  let dragging = false;
  const pt = (x: number, y: number, dx: number, dy: number, vx: number, e: PointerEvent): DragPoint => ({ x, y, dx, dy, vx, now: e.timeStamp });
  const busy = () => core.state.page !== 'browse';

  function commitIndex(i: number) {
    const s = core.state;
    const changed = core.setIndex(i);
    for (const [id, w] of Object.entries(worlds)) w?.setIndex(i, id !== s.world);
    if (changed && glMode === 'off') syncFallback();
    renderPage();
    kick();
  }

  attachStage(stage, {
    onDown(x, y, e) {
      textures?.noteInput(e.timeStamp);
      hint.classList.add('gone');
      const w = curWorld();
      if (busy() || !w || glMode !== 'on') return;
      dragging = true;
      markInput('down', e.timeStamp);
      w.drag('start', pt(x, y, 0, 0, 0, e));
      kick();
    },
    onMove(x, y, dx, dy, vx, e) {
      if (!dragging) return;
      markInput('drag', e.timeStamp);
      curWorld()!.drag('move', pt(x, y, dx, dy, vx, e));
      kick();
    },
    onEnd(x, y, dx, dy, vx, e) {
      if (!dragging) {
        if (glMode === 'off' && !busy() && (Math.abs(dx) > 50 || Math.abs(vx) > 0.3)) {
          const to = core.step(dx < 0 ? 1 : -1);
          if (to >= 0) commitIndex(to);
        }
        return;
      }
      dragging = false;
      const w = curWorld()!;
      const rel = w.drag('end', pt(x, y, dx, dy, vx, e));
      commitIndex(rel ? decideTarget(rel, decideOpts(w.id)) : core.state.index);
    },
    onTap() {
      if (!dragging) return;
      dragging = false;
      curWorld()?.drag('cancel', { x: 0, y: 0, dx: 0, dy: 0, vx: 0, now: performance.now() });
      curWorld()?.setIndex(core.state.index);
      kick();
    },
    onCancel() {
      if (!dragging) return;
      dragging = false;
      curWorld()?.drag('cancel', { x: 0, y: 0, dx: 0, dy: 0, vx: 0, now: performance.now() });
      curWorld()?.setIndex(core.state.index);
      kick();
    },
  });

  function go(dir: 1 | -1) {
    if (busy() || dragging) return;
    textures?.noteInput(performance.now());
    hint.classList.add('gone');
    const to = core.step(dir);
    if (to >= 0) commitIndex(to);
  }
  prevBtn.addEventListener('click', (e) => (pointerMark(e), go(-1)));
  nextBtn.addEventListener('click', (e) => (pointerMark(e), go(1)));
  openBtn.addEventListener('click', (e) => {
    pointerMark(e);
    if (busy()) return;
    const w = curWorld();
    const keyboard = !e.clientX && !e.clientY;
    const hit = keyboard || !w || glMode !== 'on' ? 'open' : w.hit(e.clientX, e.clientY);
    if (hit === 'open') {
      if (w && glMode === 'on' && w.nearest() !== core.state.index) commitIndex(w.nearest()); // open what is on screen
      openDetail(true, true);
    }
    else if (hit === 'prev') go(-1);
    else if (hit === 'next') go(1);
  });
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const pg = core.state.page;
    if (e.key === 'Escape' && (pg === 'opening' || pg === 'detail')) closeDetail();
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && pg === 'browse') {
      markInput('key', e.timeStamp);
      go(e.key === 'ArrowRight' ? 1 : -1);
    }
  });

  // ---- world switch ---------------------------------------------------------------------------
  function setWorld(id: WorldId) {
    if (core.state.page !== 'browse' || id === core.state.world) return;
    const nw = glOk() ? makeWorld(id) : null;
    if (!core.switchWorld(id)) return;
    if (!nw) core.state.sw = null; // no GL: nothing to crossfade
    saveWorld(id);
    history.replaceState(history.state, '', buildUrl(location, { world: id }));
    if (nw) {
      nw.setIndex(core.state.index, true);
      nw.enter?.();
      curWorld() === nw && worlds[core.state.sw?.from ?? id]?.wake();
    } else root.dataset.world = id;
    renderPage();
    kick();
  }
  wBtns.forEach((b) =>
    b.addEventListener('click', (e) => {
      pointerMark(e);
      setWorld(b.dataset.w as WorldId);
    }),
  );
  document.querySelectorAll<HTMLAnchorElement>('[data-set]').forEach((a) => {
    a.href = `?set=${a.dataset.set}&world=${core.state.world}${DEBUG ? '&debug' : ''}`;
  });

  // ---- environment ------------------------------------------------------------------------------
  addEventListener('resize', sizeGl);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      last = 0;
      curWorld()?.wake();
      kick();
    }
  });
  reducedMq.addEventListener('change', () => {
    core.reduced = reducedMq.matches;
    detail.reduced = core.reduced;
    if (core.reduced && glMode !== 'off') {
      const pg = core.state.page;
      if (pg === 'opening' || pg === 'closing') core.settle();
      if (pg === 'opening') finishOpenDom();
      if (pg === 'closing') finishCloseDom();
      setGl('off');
      syncFallback();
      renderPage();
    }
  });
  detail.onAngle = () => kick();

  // ---- boot -------------------------------------------------------------------------------------
  root.dataset.world = core.state.world;
  setGl('boot');
  hint.textContent = HINT[core.state.world];
  renderPage();
  if (start.detail >= 0) {
    // deep link: the detail page exists immediately, no animation; GL is brought up behind it for the way back
    core.open(false);
    detail.fill(start.detail);
    root.style.setProperty('--tone', rgbCss(PRODUCTS[start.detail].tone));
    detail.show(start.detail, 0, 0);
    detail.el.hidden = false;
    finishOpenDom();
    renderPage();
    history.replaceState({ bonnet: 0 }, '', buildUrl(location, { id: PRODUCTS[start.detail].id }));
  } else history.replaceState(history.state, '', buildUrl(location, { world: core.state.world }));
  saveWorld(core.state.world);
  if (core.reduced || query.has('nogl')) fallback();
  else requestAnimationFrame(() => setTimeout(initGl, 0));

  initDebug(
    () => {
      const s = core.state;
      return `${s.world}${s.sw ? ` sw ${s.sw.from}>${s.world} ${s.sw.t.toFixed(2)}` : ''} ${s.page} i${s.index} p${s.p.toFixed(3)} gl:${glMode}`;
    },
    () => (G ? `${G.gpu.slice(0, 44)} dpr ${G.dpr.toFixed(2)} ${G.canvas.width}x${G.canvas.height}\ntex ${textures?.count}/${N} ~${textures?.mb.toFixed(1)}MB\n` : 'gl: none\n'),
  );
  if (DEBUG || query.has('probe')) {
    Object.defineProperty(window, '__bonnet', {
      get: () => {
        const s = core.state;
        const w = curWorld();
        return {
          world: s.world,
          index: s.index,
          page: s.page,
          p: s.p,
          sw: s.sw ? s.sw.t : null,
          gl: glMode,
          animating: core.transitioning || !!s.sw || dragging || !!raf,
          near: w && glMode === 'on' ? w.nearest() : s.index,
          settled: w && glMode === 'on' ? w.settled() : true,
          probe: w && glMode === 'on' ? w.probe() : null,
          slotPx: w && glMode === 'on' ? w.slotPx() : 0,
          scrollY,
          hero: detail.heroKey,
          uploads: textures?.uploads ?? 0,
          fmt: (worlds.water as WaterWorld | undefined)?.fmt ?? '',
        };
      },
    });
  }
}
