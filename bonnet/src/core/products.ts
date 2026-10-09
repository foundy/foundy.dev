// Product-agnostic content model. The deck shows products; the detail shows a product's images.
// Two catalogues (?set=bonnet|mixed) prove nothing in the UI/GL depends on "bonnet" or on square photos.
import { IMG } from '../images.gen';

export type RGB = [number, number, number];
export interface Product {
  id: string;
  title: string;
  price: string;
  /** image paths relative to assets/ ; images[0] is the deck card */
  images: string[];
  /** page background tone (low saturation) */
  tone: RGB;
  /** mid-tone used by the lift ink flood and the rail dot */
  ink: RGB;
  desc: string;
  details: [string, string[]][];
}

export const SETS = ['bonnet', 'mixed'] as const;
export type SetName = (typeof SETS)[number];

const mixTo = (c: RGB, t: number, to = 255): RGB => c.map((v) => Math.round(v + (to - v) * t)) as RGB;
const sat = (c: RGB, k: number): RGB => {
  const m = (c[0] + c[1] + c[2]) / 3;
  return c.map((v) => Math.max(0, Math.min(255, Math.round(m + (v - m) * k)))) as RGB;
};

const BONNET_COPY =
  'A soft shell-stitch bonnet worked in one piece, with a ruffled edge that frames the face and a ribbon that ties under the chin. Each stitch is a small loop, and the loops add up to a shape that holds.';
const bonnet = (id: string, title: string, file: string, tone: RGB, yarn: RGB, angles = ['front', 'right', 'back', 'left']): Product => ({
  id,
  title: `${title} bonnet`,
  price: '$48 (mock)',
  images: angles.map((a) => `raw/bonnet-${file}-${a}.webp`),
  tone,
  ink: yarn,
  desc: BONNET_COPY,
  details: [
    ['Materials', ['Mercerized cotton, 100%', 'Mother-of-pearl style button closure', 'Cotton ribbon ties']],
    ['Sizes', ['0-3 months', '3-6 months', '6-12 months']],
    ['Care', ['Hand wash cool, reshape and dry flat. Do not wring or tumble dry.']],
  ],
});

const mixed = (id: string, title: string, price: string, images: string[], desc: string): Product => {
  const im = IMG[images[0]];
  const dom = im[2].map((v, i) => Math.round((v + im[3][i]) / 2)) as RGB;
  return { id, title, price, images, tone: mixTo(sat(dom, 0.6), 0.84), ink: sat(mixTo(dom, 0.08), 1.25), desc, details: [['Details', ['Demo catalogue item', 'Photo: Pexels (see CREDITS.md)']]] };
};

const SET_BONNET: Product[] = [
  bonnet('ivory', 'Ivory', 'ivory', [240, 235, 222], [226, 216, 190], ['front']),
  bonnet('moss', 'Moss', 'green', [222, 230, 213], [125, 154, 106]),
  bonnet('poppy', 'Poppy', 'red', [240, 219, 213], [212, 88, 74]),
  bonnet('sky', 'Sky', 'skyblue', [216, 229, 239], [125, 179, 214]),
  bonnet('butter', 'Butter', 'yellow', [243, 236, 200], [232, 201, 77]),
];

const SET_MIXED: Product[] = [
  mixed('field-cap', 'Field cap (on model)', '$64 (mock)', ['catalog/model.webp'], 'A person wearing the product: tall portrait, face in the upper third.'),
  mixed('atomiser', 'Glass atomiser', '$32 (mock)', ['catalog/bottle.webp'], 'A transparent object on a near-white backdrop: almost no contrast against the card padding.'),
  mixed('sake-shelf', 'Label shelf', '$18 (mock)', ['catalog/text.webp', 'catalog/text2.webp'], 'Text-heavy packaging with small print: any unwanted blur or warp is obvious here.'),
  mixed('skincare', 'Skincare flat-lay', '$41 (mock)', ['catalog/flat.webp'], 'A flat-lay on white, square, with fine product typography.'),
  mixed('ceramics', 'Ceramic collection', '$120 (mock)', ['catalog/wide.webp'], 'A very wide 16:9 shot inside the uniform 4:5 card frame.'),
  mixed('summer-hat', 'Summer hat', '$58 (mock)', ['catalog/tall.webp'], 'A very tall 9:16 shot inside the uniform 4:5 card frame.'),
];

const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
export const SET: SetName = q.get('set') === 'mixed' ? 'mixed' : 'bonnet';
export const PRODUCTS: Product[] = SET === 'mixed' ? SET_MIXED : SET_BONNET;
export const BRAND = SET === 'mixed' ? 'catalogue' : 'bonnet';
export const DEMO = SET === 'mixed' ? 'Demo - mixed catalogue (Pexels photos)' : 'Demo - sample product';

export const FRAME_ASPECT = 0.8; // card / hero frame: width / height (4:5), uniform for every product

export const available = (i: number) => i >= 0 && i < PRODUCTS.length;

/** next product index from `from` in direction `dir` (+1/-1), or -1 */
export function neighbor(from: number, dir: 1 | -1): number {
  const i = from + dir;
  return available(i) ? i : -1;
}

export function productIndexById(id: string): number {
  return PRODUCTS.findIndex((c) => c.id === id);
}

export interface ImgInfo {
  w: number;
  h: number;
  /** padding colours 0..255: top/bottom (image wider than the frame) or left/right, drawn as a linear gradient */
  c0: RGB;
  c1: RGB;
  vertical: boolean;
}
export function imgInfo(path: string): ImgInfo {
  const [w, h, c0, c1] = IMG[path];
  return { w, h, c0, c1, vertical: w / h >= FRAME_ASPECT };
}
/** the part of the 4:5 frame (u0,v0,u1,v1; v down) that the photo itself covers when contained; the rest is gradient pad */
export function innerRect(path: string): [number, number, number, number] {
  const i = imgInfo(path);
  const a = i.w / i.h;
  if (a >= FRAME_ASPECT) {
    const h = FRAME_ASPECT / a;
    return [0, (1 - h) / 2, 1, (1 + h) / 2];
  }
  const w = a / FRAME_ASPECT;
  return [(1 - w) / 2, 0, (1 + w) / 2, 1];
}
export const imgUrl =(path: string, base = import.meta.env.BASE_URL) => `${base}assets/${path}`;
export const rgbCss = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`;
export const padCss = (i: ImgInfo) => `linear-gradient(${i.vertical ? 'to bottom' : 'to right'},${rgbCss(i.c0)},${rgbCss(i.c1)})`;
