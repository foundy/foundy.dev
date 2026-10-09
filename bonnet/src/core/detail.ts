// The shared DOM detail page. Both worlds open onto this exact page (same markup, same scroll, same Back behaviour).
// Normal document flow + window scroll: it scrolls natively the moment it exists. The hero is a 4:5 frame
// (gradient pad + contained photo), identical to the layer the worlds draw, so the GL -> DOM hand-off has no seam.
import { decideSwipe } from './commit';
import { FRAME_ASPECT, PRODUCTS, imgInfo, imgUrl, padCss } from './products';
import { attachDrag } from './input';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const detailMarkup = (demo: string) => `
<button id="close" class="close" type="button" aria-label="Close details">&#215;</button>
<div class="sheet">
  <div id="hero" class="hero" style="aspect-ratio:${FRAME_ASPECT}"></div>
  <div id="dots" class="dots" role="group" aria-label="Photo"></div>
  <div class="body">
    <h1 id="dtitle" tabindex="-1"></h1>
    <p class="sub" id="dsub"></p>
    <h2>About</h2><p id="ddesc"></p>
    <div id="dmore"></div>
    <p class="note">${demo}</p>
  </div>
</div>`;

export class Detail {
  readonly el: HTMLElement;
  readonly hero: HTMLElement;
  private title: HTMLElement;
  private dotsEl: HTMLElement;
  private dots: HTMLButtonElement[] = [];
  private imgs = new Map<string, HTMLImageElement>();
  private want = '';
  private z = 1;
  private timer = 0;
  private color = 0;
  angle = 0;
  reduced = false;
  onAngle: () => void = () => {};

  constructor(el: HTMLElement, private pointer: (e: Event) => void) {
    this.el = el;
    this.hero = el.querySelector('#hero')!;
    this.title = el.querySelector('#dtitle')!;
    this.dotsEl = el.querySelector('#dots')!;
    // horizontal swipe on the hero changes the photo; vertical gestures stay the browser's (native scroll)
    attachDrag(this.hero, {
      onMove: (_tr, e) => pointer(e),
      onEnd: (tr) => {
        const n = PRODUCTS[this.color].images.length;
        if (n < 2) return;
        const sign = Math.sign(tr.dx);
        // 0.2 of the hero width counts as much as half a browse swipe
        if (decideSwipe((Math.abs(tr.dx) / tr.width) * 2.5, tr.velocity() * sign)) this.setAngle((((this.angle + (sign < 0 ? 1 : -1)) % n) + n) % n);
      },
      onCancel() {},
    });
  }

  rect(): Rect {
    const r = this.hero.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  fill(c: number) {
    this.color = c;
    this.angle = 0;
    const pr = PRODUCTS[c];
    const $ = (id: string) => this.el.querySelector<HTMLElement>('#' + id)!;
    this.title.textContent = pr.title;
    $('dsub').textContent = pr.price;
    $('ddesc').textContent = pr.desc;
    $('dmore').innerHTML = pr.details.map(([h, l]) => `<h2>${h}</h2>${l.length === 1 ? `<p>${l[0]}</p>` : `<ul>${l.map((x) => `<li>${x}</li>`).join('')}</ul>`}`).join('');
    this.dotsEl.innerHTML = pr.images.length > 1 ? pr.images.map((_, i) => `<button class="dot" type="button" data-a="${i}" aria-pressed="false" aria-label="Photo ${i + 1} of ${pr.images.length}"></button>`).join('') : '';
    this.dots = [...this.dotsEl.querySelectorAll<HTMLButtonElement>('.dot')];
    this.dots.forEach((el) =>
      el.addEventListener('click', (e) => {
        this.pointer(e);
        this.setAngle(+el.dataset.a!);
      }),
    );
    this.syncDots();
    this.hero.style.background = padCss(imgInfo(pr.images[0]));
    this.hero.querySelectorAll('img').forEach((i) => i.classList.remove('on'));
    this.el.style.setProperty('--tone', `rgb(${pr.tone.join(',')})`);
    this.el.style.setProperty('--ink-c', `rgb(${pr.ink.join(',')})`);
  }

  private syncDots() {
    this.dots.forEach((el, i) => el.setAttribute('aria-pressed', String(i === this.angle)));
  }

  setAngle(a: number) {
    this.angle = a;
    this.syncDots();
    this.show(this.color, a, 180);
    this.onAngle();
  }

  /** keep the previous photo until the new one is decoded (texture-ready rule) */
  show(color: number, angle: number, ms: number) {
    const pr = PRODUCTS[color];
    const a = Math.min(angle, pr.images.length - 1);
    const key = `${color}-${a}`;
    this.want = key;
    let img = this.imgs.get(key);
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
      this.imgs.set(key, img);
      this.hero.append(img);
    }
    const im = img;
    const reveal = () => {
      if (this.want !== key || im.classList.contains('on')) return;
      const d = this.reduced ? 0 : ms;
      im.style.setProperty('--d', d + 'ms');
      im.style.zIndex = String(++this.z);
      im.classList.add('on');
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.imgs.forEach((o) => o !== im && o.classList.remove('on')), d + 30);
    };
    if (ms === 0 && im.complete && im.naturalWidth) reveal();
    else im.decode().then(reveal, reveal);
  }

  /** the hero photo of the current product (angle 0) is decoded, or `ms` passed */
  decoded(ms = 200): Promise<void> {
    const img = this.imgs.get(this.want);
    if (!img || img.complete) return Promise.resolve();
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
}
