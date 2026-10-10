// The shared DOM detail page. Both worlds open onto this exact page (same markup, same scroll, same Back behaviour).
// Normal document flow + window scroll: it scrolls natively the moment it exists. The hero is a 4:5 frame
// (gradient pad + contained photo), identical to the layer the worlds draw, so the GL -> DOM hand-off has no seam.
//
// HERO GESTURE RULES (the only gesture surface of this page; the body text area has NO gesture code and scrolls natively)
//   - the hero carries `touch-action: none` (CSS). It is not a scroll start area: horizontal = photo slide, vertical = close drag.
//     (When the page is scrolled away from the top the hero gets [data-scrolled] -> `pan-y pinch-zoom`: scrolling can start on
//     it again, the photo slide still works, the close drag is off.)
//   - pointerdown records the start; the gesture axis locks after SLOP (6 px) of movement from the first pixel:
//       |dx| >= |dy|          -> 'x'  photo slide (only with 2+ photos)
//       |dy| > |dx|, dy > 0   -> 'y'  close drag (only at the top of the page: scrollY <= 2)
//       |dy| > |dx|, dy < 0   -> 'none' upward drags do nothing (no JS scrolling)
//   - the photo follows the finger 1:1 from the FIRST pixel (before the lock too, while horizontal dominates): it never waits for the slop
//   - nothing is preventDefault()ed, no global listeners, no click suppression (the hero has nothing clickable)
import { DragTracker, SETTLE_OMEGA, clamp, decideSwipe, smooth, spring } from './commit';
import { FRAME_ASPECT, PRODUCTS, imgInfo, imgUrl, padCss } from './products';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const AXIS_LOCK = 6; // px

export const detailMarkup = (demo: string) => `
<button id="close" class="close" type="button" aria-label="Close details">&#215;</button>
<div class="sheet">
  <div id="hero" class="hero" style="aspect-ratio:${FRAME_ASPECT}"><canvas class="seam" aria-hidden="true"></canvas><i class="shutter" aria-hidden="true"></i></div>
  <div class="angles">
    <button id="aprev" class="arr" type="button" aria-label="Previous photo"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    <div id="dots" class="dots" role="group" aria-label="Photo"></div>
    <button id="anext" class="arr" type="button" aria-label="Next photo"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
  </div>
  <div class="body">
    <h1 id="dtitle" tabindex="-1"></h1>
    <p class="sub" id="dsub"></p>
    <h2>About</h2><p id="ddesc"></p>
    <div id="dmore"></div>
    <p class="note">${demo}</p>
  </div>
</div>`;

export interface CloseHooks {
  /** a downward drag locked on the hero; return false to refuse (the page is not at rest) */
  start(): boolean;
  move(dx: number, dy: number, vy: number): void;
  /** finger up: vy in px/ms (positive = down) */
  end(dx: number, dy: number, vy: number): void;
  cancel(): void;
}

type Axis = 'pending' | 'x' | 'y' | 'none';
const SPRING_W = SETTLE_OMEGA;

export class Detail {
  readonly el: HTMLElement;
  readonly hero: HTMLElement;
  private title: HTMLElement;
  private dotsEl: HTMLElement;
  private dots: HTMLButtonElement[] = [];
  private arrows: HTMLButtonElement[];
  private canvas: HTMLCanvasElement;
  private shutter: HTMLElement;
  private imgs: HTMLImageElement[] = [];
  private infos: ReturnType<typeof imgInfo>[] = [];
  private want = '';
  private color = 0;
  private n = 1;
  /** photo shown (cur) and the one entering (inc, -1 = none); x = offset of cur in px (negative = moved left) */
  cur = 0;
  private inc = -1;
  private x = 0;
  private v = 0; // px/s
  private target = 0;
  private raf = 0;
  private lastT = 0;
  private W = 1;
  private H = 1;
  /** world flavour of the change moment */
  world: 'light' | 'water' = 'light';
  reduced = false;
  /** the page is at rest on the detail (not opening / closing): gestures are live */
  active = false;
  onAngle: () => void = () => {};
  closeHooks: CloseHooks | null = null;
  /** when set, rect() reports this instead of the DOM rect (drag-down-to-close scrubs the hero without touching the DOM) */
  fake: Rect | null = null;

  // gesture
  private axis: Axis = 'pending';
  private down = false;
  private pid = -1;
  private tr: DragTracker | null = null;
  private ys: { y: number; t: number }[] = [];
  private base = 0;
  private canClose = false;
  private closing = false;

  constructor(el: HTMLElement, private pointer: (e: Event) => void) {
    this.el = el;
    this.hero = el.querySelector('#hero')!;
    this.title = el.querySelector('#dtitle')!;
    this.dotsEl = el.querySelector('#dots')!;
    this.canvas = el.querySelector('.seam')!;
    this.shutter = el.querySelector('.shutter')!;
    this.arrows = [...el.querySelectorAll<HTMLButtonElement>('.arr')];
    this.arrows[0].addEventListener('click', (e) => (this.pointer(e), this.step(-1)));
    this.arrows[1].addEventListener('click', (e) => (this.pointer(e), this.step(1)));
    const h = this.hero;
    h.addEventListener('pointerdown', (e) => this.onDown(e));
    h.addEventListener('pointermove', (e) => this.onMove(e));
    h.addEventListener('pointerup', (e) => this.onUp(e, false));
    h.addEventListener('pointercancel', (e) => this.onUp(e, true));
    h.addEventListener('lostpointercapture', (e) => e.pointerId === this.pid && this.down && this.onUp(e, true));
  }

  rect(): Rect {
    if (this.fake) return this.fake;
    const r = this.hero.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  /** the page scrolled away from the top: the hero may start native scrolls again */
  setScrolled(on: boolean) {
    this.hero.toggleAttribute('data-scrolled', on);
  }

  // ---- content -------------------------------------------------------------------------------
  fill(c: number) {
    this.stop();
    this.color = c;
    this.cur = 0;
    this.inc = -1;
    this.x = 0;
    this.v = 0;
    const pr = PRODUCTS[c];
    this.n = pr.images.length;
    const $ = (id: string) => this.el.querySelector<HTMLElement>('#' + id)!;
    this.title.textContent = pr.title;
    $('dsub').textContent = pr.price;
    $('ddesc').textContent = pr.desc;
    $('dmore').innerHTML = pr.details.map(([h, l]) => `<h2>${h}</h2>${l.length === 1 ? `<p>${l[0]}</p>` : `<ul>${l.map((x) => `<li>${x}</li>`).join('')}</ul>`}`).join('');
    this.dotsEl.innerHTML = this.n > 1 ? pr.images.map((_, i) => `<button class="dot" type="button" data-a="${i}" aria-pressed="false" aria-label="Photo ${i + 1} of ${this.n}"></button>`).join('') : '';
    this.dots = [...this.dotsEl.querySelectorAll<HTMLButtonElement>('.dot')];
    this.dots.forEach((el) =>
      el.addEventListener('click', (e) => {
        this.pointer(e);
        this.setAngle(+el.dataset.a!);
      }),
    );
    this.el.querySelector('.angles')!.toggleAttribute('data-single', this.n < 2);
    this.syncDots();
    // every photo of the product is in the hero from the start (decoded early), so a drag never waits for an image
    this.hero.querySelectorAll('img').forEach((i) => i.remove());
    this.infos = pr.images.map((p) => imgInfo(p));
    this.imgs = pr.images.map((p, a) => {
      const info = this.infos[a];
      const img = new Image();
      img.alt = `${pr.title}, photo ${a + 1}`;
      img.draggable = false;
      img.width = info.w;
      img.height = info.h;
      img.decoding = 'async';
      img.style.background = padCss(info);
      img.src = imgUrl(p);
      this.hero.insertBefore(img, this.canvas);
      return img;
    });
    this.hero.style.background = padCss(this.infos[0]);
    this.want = `${c}-0`;
    this.layout();
    this.el.style.setProperty('--tone', `rgb(${pr.tone.join(',')})`);
    this.el.style.setProperty('--ink-c', `rgb(${pr.ink.join(',')})`);
  }

  private syncDots() {
    this.dots.forEach((el, i) => el.setAttribute('aria-pressed', String(i === this.cur)));
  }

  /** immediate: show photo `angle` of `color` (opening, deep link, history navigation) */
  show(color: number, angle: number, _ms = 0) {
    void _ms;
    if (color !== this.color) this.fill(color);
    this.stop();
    this.cur = Math.min(angle, this.n - 1);
    this.inc = -1;
    this.x = 0;
    this.want = `${color}-${this.cur}`;
    this.syncDots();
    this.layout();
  }

  /** the hero photo of the current product is decoded, or `ms` passed */
  decoded(ms = 200): Promise<void> {
    const img = this.imgs[this.cur];
    if (!img || (img.complete && img.naturalWidth)) return Promise.resolve();
    return new Promise((res) => {
      const t = setTimeout(res, ms);
      img.decode().then(
        () => (clearTimeout(t), res()),
        () => (clearTimeout(t), res()),
      );
    });
  }
  get heroKey() {
    return this.want;
  }
  /** debug/test: where the photos are right now */
  probe() {
    const r = (i: number) => (i >= 0 && this.imgs[i] ? this.imgs[i].getBoundingClientRect().left - this.hero.getBoundingClientRect().left : null);
    return { cur: this.cur, inc: this.inc, x: this.x, curX: r(this.cur), incX: r(this.inc), axis: this.axis, anim: !!this.raf, W: this.W };
  }

  // ---- angle change API (dots, arrows, keys) --------------------------------------------------
  step(d: 1 | -1) {
    if (this.n < 2 || !this.active) return;
    this.slideTo((((this.cur + d) % this.n) + this.n) % this.n, d);
  }
  setAngle(a: number) {
    if (this.n < 2 || a === this.cur || a < 0 || a >= this.n) return;
    this.slideTo(a, a > this.cur ? 1 : -1);
  }
  /** dir = +1: the new photo enters from the right (the current one leaves to the left) */
  private slideTo(a: number, dir: 1 | -1) {
    this.commitNow(); // a slide already in flight lands first
    this.measure();
    this.inc = a;
    this.x = 0;
    this.v = 0;
    this.target = -dir * this.W;
    if (this.reduced) return this.land(true);
    this.run();
  }

  // ---- layout (the one place that positions photos) ----------------------------------------------
  private measure() {
    this.W = this.hero.clientWidth || this.W;
    this.H = this.hero.clientHeight || this.H;
  }

  private layout() {
    const W = this.W = this.hero.clientWidth || this.W;
    const moving = this.x !== 0 && this.inc >= 0;
    if (moving && this.inc === this.cur) this.inc = -1;
    // while dragging, the entering photo is whichever side the finger opens
    if (this.down && (this.axis === 'x' || this.axis === 'pending')) this.inc = this.x < 0 ? (this.cur + 1) % this.n : (this.cur - 1 + this.n) % this.n;
    const prog = clamp(Math.abs(this.x) / W);
    const light = this.world === 'light' && !this.reduced;
    this.imgs.forEach((img, i) => {
      const s = img.style;
      if (i === this.cur) {
        s.opacity = '1';
        s.visibility = '';
        s.transform = this.x ? `translate3d(${this.x}px,0,0)` : '';
        s.filter = light && this.x ? `brightness(${(1 - 0.28 * prog).toFixed(3)})` : '';
        s.zIndex = '1';
      } else if (i === this.inc && this.x !== 0) {
        const off = this.x + (this.x < 0 ? W - 1 : -(W - 1)); // 1 px overlap: no hairline gap between the two photos
        s.opacity = '1';
        s.visibility = '';
        s.transform = `translate3d(${off}px,0,0)`;
        // Light: the incoming slide is pulled into focus as it arrives
        s.filter = light ? `blur(${(5 * Math.pow(1 - prog, 1.6)).toFixed(2)}px) brightness(${(0.72 + 0.28 * prog).toFixed(3)})` : '';
        s.zIndex = '2';
      } else {
        s.opacity = '0';
        s.transform = '';
        s.filter = '';
        s.zIndex = '0';
      }
    });
    this.drawSeam(prog);
  }

  // ---- Water: a ripple-like refraction band passing at the seam (tiny in-flow canvas inside the hero) -------------
  private seamOn = false;
  private drawSeam(prog: number) {
    const wantFx = this.world === 'water' && !this.reduced && this.x !== 0 && this.inc >= 0;
    const amp = Math.sqrt(smooth(0, 0.16, prog) * (1 - smooth(0.82, 1, prog)));
    if (!wantFx || amp < 0.01) {
      if (this.seamOn) {
        this.canvas.style.opacity = '0';
        this.seamOn = false;
      }
      return;
    }
    const a = this.imgs[this.cur], b = this.imgs[this.inc];
    if (!a || !b || !a.naturalWidth || !b.naturalWidth) return;
    const W = this.W, H = this.hero.clientHeight || this.H;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) (this.canvas.width = cw), (this.canvas.height = ch);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const seam = this.x < 0 ? this.x + W : this.x;
    const t = performance.now() / 1000;
    const STRIP = 3, R = 38;
    const paint = (img: HTMLImageElement, info: ReturnType<typeof imgInfo>, offX: number, x0: number, x1: number) => {
      const sc = Math.min(W / img.naturalWidth, H / img.naturalHeight);
      const dw = img.naturalWidth * sc, dh = img.naturalHeight * sc, ox = (W - dw) / 2, oy = (H - dh) / 2;
      const g = info.vertical ? ctx.createLinearGradient(0, 0, 0, H) : ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, `rgb(${info.c0})`);
      g.addColorStop(1, `rgb(${info.c1})`);
      for (let cx = Math.max(0, Math.floor(x0 / STRIP) * STRIP); cx < Math.min(W, x1); cx += STRIP) {
        const lx = cx - offX; // local x inside this photo's box
        const gs = Math.exp(-Math.pow((cx + STRIP / 2 - seam) / R, 2));
        const dy = 9 * amp * gs * Math.sin((cx - seam) / 8 - t * 16);
        const dxs = 3 * amp * gs * Math.cos((cx - seam) / 8 - t * 16);
        ctx.fillStyle = g;
        ctx.save();
        ctx.translate(cx - lx, 0);
        ctx.fillRect(lx, 0, STRIP, H);
        ctx.restore();
        if (lx + STRIP > ox && lx < ox + dw) {
          const sx = clamp((lx + dxs - ox) / sc, 0, img.naturalWidth - 1);
          ctx.drawImage(img, sx, 0, Math.min(STRIP / sc, img.naturalWidth - sx), img.naturalHeight, cx, oy + dy, STRIP + 0.6, dh);
        }
      }
    };
    const curOff = this.x, incOff = this.x + (this.x < 0 ? W - 1 : -(W - 1));
    if (this.x < 0) {
      paint(a, this.infos[this.cur], curOff, 0, seam);
      paint(b, this.infos[this.inc], incOff, seam, W);
    } else {
      paint(b, this.infos[this.inc], incOff, 0, seam);
      paint(a, this.infos[this.cur], curOff, seam, W);
    }
    // the glassy crest: a soft light ridge riding on the seam
    const ridge = ctx.createLinearGradient(seam - 26, 0, seam + 26, 0);
    ridge.addColorStop(0, 'rgba(210,235,245,0)');
    ridge.addColorStop(0.5, `rgba(225,243,250,${(0.3 * amp).toFixed(3)})`);
    ridge.addColorStop(1, 'rgba(210,235,245,0)');
    ctx.fillStyle = ridge;
    ctx.fillRect(seam - 26, 0, 52, H);
    if (!this.seamOn) {
      this.canvas.style.opacity = '1';
      this.seamOn = true;
    }
  }

  // ---- motion --------------------------------------------------------------------------------
  private stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
  private run() {
    this.lastT = performance.now();
    this.layout();
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.tick(t));
    this.onAngle();
  }
  private tick(now: number) {
    this.raf = 0;
    const dt = clamp((now - this.lastT) / 1000, 0, 0.05);
    this.lastT = now;
    const r = spring(this.x, this.v, this.target, dt, SPRING_W);
    this.x = r.x;
    this.v = r.v;
    if (Math.abs(this.x - this.target) < 0.4 && Math.abs(this.v) < 8) return this.land(this.target !== 0);
    this.layout();
    this.raf = requestAnimationFrame((t) => this.tick(t));
    this.onAngle();
  }
  /** the spring arrived: commit (the entering photo becomes the current one) or revert */
  private land(commit: boolean) {
    this.stop();
    if (commit && this.inc >= 0) {
      this.cur = this.inc;
      this.want = `${this.color}-${this.cur}`;
      this.syncDots();
      if (this.world === 'light' && !this.reduced) this.flashShutter();
    }
    this.inc = -1;
    this.x = 0;
    this.v = 0;
    this.layout();
    this.onAngle();
  }
  /** finish a running slide at once (used when a new one starts on top of it) */
  private commitNow() {
    if (this.raf || (this.x !== 0 && !this.down)) this.land(Math.abs(this.target) > 0 && Math.abs(this.x) > Math.abs(this.target) / 2);
  }
  /** Light: a brief shutter dip as the new slide seats (CSS keyframes on the in-hero overlay) */
  private flashShutter() {
    const s = this.shutter;
    s.classList.remove('snap');
    void s.offsetWidth;
    s.classList.add('snap');
  }

  // ---- hero gesture --------------------------------------------------------------------------
  private onDown(e: PointerEvent) {
    if (!this.active || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0) || this.down) return;
    this.measure();
    this.down = true;
    this.pid = e.pointerId;
    this.axis = 'pending';
    this.tr = new DragTracker(e.clientX, e.clientY, e.timeStamp, this.W);
    this.ys = [{ y: e.clientY, t: e.timeStamp }];
    this.closing = false;
    this.canClose = scrollY <= 2 && !this.hero.hasAttribute('data-scrolled');
    this.capture(e); // the hero has nothing clickable: capture at once so a mouse release outside it still ends the gesture
    // catch a slide in flight: the photo stays exactly where it is and follows from there
    if (this.raf || this.x !== 0) {
      this.stop();
      this.base = this.x;
      if (this.inc < 0) this.base = 0;
      this.axis = this.n > 1 ? 'x' : 'pending';
    } else this.base = 0;
  }
  private capture(e: PointerEvent) {
    try {
      this.hero.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }
  private onMove(e: PointerEvent) {
    if (!this.down || e.pointerId !== this.pid || !this.tr) return;
    this.tr.move(e.clientX, e.clientY, e.timeStamp);
    this.ys.push({ y: e.clientY, t: e.timeStamp });
    if (this.ys.length > 16) this.ys.shift();
    const dx = this.tr.dx, dy = this.tr.dy;
    if (this.axis === 'pending' && Math.hypot(dx, dy) >= AXIS_LOCK) {
      if (Math.abs(dx) >= Math.abs(dy)) this.axis = this.n > 1 ? 'x' : 'none';
      else if (dy > 0 && this.canClose && this.closeHooks?.start()) this.axis = 'y', (this.closing = true);
      else this.axis = 'none';
      if (this.axis !== 'x') this.resetX();
    }
    if (this.axis === 'x' || (this.axis === 'pending' && this.n > 1 && Math.abs(dx) > Math.abs(dy))) {
      // 1:1 from the first pixel, provisional until the axis locks
      this.x = clamp(this.base + dx, -this.W, this.W);
      this.v = 0;
      this.layout();
      this.onAngle();
    } else if (this.axis === 'pending' && this.x !== 0 && !this.closing) this.resetX();
    else if (this.axis === 'y') this.closeHooks!.move(dx, dy, this.vy());
  }
  private resetX() {
    if (this.x === 0 && this.inc < 0) return;
    this.x = 0;
    this.inc = -1;
    this.layout();
  }
  private vy(): number {
    const s = this.ys;
    const last = s[s.length - 1];
    let first = last;
    for (let i = s.length - 2; i >= 0; i--) {
      if (last.t - s[i].t > 90) break;
      first = s[i];
    }
    const dt = last.t - first.t;
    return dt > 0 ? (last.y - first.y) / dt : 0;
  }
  private onUp(e: PointerEvent, cancel: boolean) {
    if (!this.down || e.pointerId !== this.pid) return;
    const tr = this.tr!;
    if (!cancel) tr.move(e.clientX, e.clientY, e.timeStamp);
    this.down = false;
    this.pid = -1;
    const axis = this.axis;
    this.axis = 'pending';
    try {
      this.hero.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (axis === 'y') {
      if (cancel) this.closeHooks!.cancel();
      else this.closeHooks!.end(tr.dx, tr.dy, this.vy());
    } else if (axis === 'x' || (this.x !== 0 && this.inc >= 0)) {
      if (this.inc < 0) return this.land(false);
      const sign = Math.sign(this.x) || 1;
      const v = cancel ? 0 : tr.velocity(); // px/ms
      const commit = !cancel && decideSwipe((Math.abs(this.x) / this.W) * 2.5, v * sign);
      this.target = commit ? sign * this.W : 0;
      this.v = v * 1000;
      if (this.reduced) return this.land(commit);
      this.run();
    } else if (this.x !== 0) this.land(false);
  }
}
