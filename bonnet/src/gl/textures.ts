// Shared texture manager: every product image is composed ONCE into a 4:5 "frame" layer
// (gradient pad + photo contained, identical to the DOM hero) and uploaded ONCE into a texture array that
// both worlds sample. Rules: createImageBitmap off the main frame, <= 1 upload per frame, never on a tap frame.
import { imgInfo, imgUrl, padCss, rgbCss, type Product } from '../core/products';
import type { GL } from './context';

export const LAYER_W = 768;
export const LAYER_H = 960; // 4:5

export class Textures {
  readonly tex: WebGLTexture;
  readonly n: number;
  private ready: boolean[];
  private queue: { i: number; bmp: ImageBitmap }[] = [];
  private started = new Set<number>();
  /** mean colour of each photo, 0..1 (saturated pixels weigh more) */
  readonly avg: [number, number, number][];
  private listeners = new Set<(i: number) => void>();
  private blockUntil = 0;
  private cv: HTMLCanvasElement | OffscreenCanvas;
  private c2: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  private small: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  uploads = 0;
  mb = 0;

  constructor(private g: GL, private products: Product[]) {
    const gl = g.gl;
    this.n = products.length;
    this.ready = products.map(() => false);
    this.avg = products.map(() => [0.6, 0.55, 0.5] as [number, number, number]);
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.floor(Math.log2(LAYER_H)) + 1, gl.RGBA8, LAYER_W, LAYER_H, Math.max(1, this.n));
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const mk = (w: number, h: number) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));
    this.cv = mk(LAYER_W, LAYER_H);
    this.c2 = this.cv.getContext('2d') as CanvasRenderingContext2D;
    this.small = mk(16, 16).getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  }

  has(i: number) {
    return !!this.ready[i];
  }
  get count() {
    return this.ready.reduce((a, b) => a + (b ? 1 : 0), 0);
  }
  onReady(fn: (i: number) => void) {
    this.listeners.add(fn);
  }
  /** an input just happened: do not upload for a few ms (the tap frame must only draw) */
  noteInput(now: number, ms = 140) {
    this.blockUntil = now + ms;
  }

  /** start loading in priority order; each image is fetched, decoded and composed off the render path */
  load(order: number[]) {
    for (const i of order) {
      if (this.started.has(i) || i < 0 || i >= this.n) continue;
      this.started.add(i);
      this.compose(i).catch(() => this.started.delete(i));
    }
  }

  private async compose(i: number) {
    const path = this.products[i].images[0];
    const info = imgInfo(path);
    const blob = await (await fetch(imgUrl(path))).blob();
    const bm = await createImageBitmap(blob);
    const g = this.c2;
    const gr = info.vertical ? g.createLinearGradient(0, 0, 0, LAYER_H) : g.createLinearGradient(0, 0, LAYER_W, 0);
    gr.addColorStop(0, rgbCss(info.c0));
    gr.addColorStop(1, rgbCss(info.c1));
    g.fillStyle = gr;
    g.fillRect(0, 0, LAYER_W, LAYER_H);
    const k = Math.min(LAYER_W / bm.width, LAYER_H / bm.height);
    const dw = bm.width * k, dh = bm.height * k;
    g.imageSmoothingQuality = 'high';
    g.drawImage(bm, (LAYER_W - dw) / 2, (LAYER_H - dh) / 2, dw, dh);
    // mean colour
    this.small.drawImage(bm, 0, 0, 16, 16);
    const d = this.small.getImageData(0, 0, 16, 16).data;
    let r = 0, gg = 0, b = 0, ws = 0;
    for (let q = 0; q < d.length; q += 4) {
      const mx = Math.max(d[q], d[q + 1], d[q + 2]), mn = Math.min(d[q], d[q + 1], d[q + 2]);
      const wt = 0.25 + (mx - mn) / 255;
      r += d[q] * wt;
      gg += d[q + 1] * wt;
      b += d[q + 2] * wt;
      ws += wt;
    }
    this.avg[i] = [r / ws / 255, gg / ws / 255, b / ws / 255];
    bm.close();
    const layer = await createImageBitmap(this.cv as ImageBitmapSource);
    this.queue.push({ i, bmp: layer });
    this.listeners.forEach((f) => f(-1)); // wake the loop so the upload gets a frame
  }

  /** upload at most one layer; returns true while more are waiting */
  pump(now: number): boolean {
    if (!this.queue.length) return false;
    if (now < this.blockUntil) return true;
    const { i, bmp } = this.queue.shift()!;
    const gl = this.g.gl;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, LAYER_W, LAYER_H, 1, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    bmp.close();
    this.ready[i] = true;
    this.uploads++;
    this.mb += (LAYER_W * LAYER_H * 4 * 4) / 3 / 1048576;
    this.listeners.forEach((f) => f(i));
    return this.queue.length > 0;
  }

  get pending() {
    return this.queue.length;
  }
  /** css background of the frame, for DOM fallbacks */
  static pad(path: string) {
    return padCss(imgInfo(path));
  }
}
