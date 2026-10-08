/** Mock content for a sample product. Nothing here is for sale. */
export interface Colorway {
  id: string;
  name: string;
  /** soft tint behind the deck, deep tint behind the open detail (rgb) */
  tint: [number, number, number];
  deep: [number, number, number];
  swatch: string;
  note: string;
  /** width of the large image file (the small one is always 480) */
  large: number;
}

export const ANGLES = ['front', 'right', 'back', 'left'] as const;
export const ANGLE_LABELS = ['Front', 'Right', 'Back', 'Left'] as const;

export const COLORS: Colorway[] = [
  { id: 'ivory', name: 'Ivory', tint: [241, 230, 211], deep: [216, 193, 160], swatch: '#efe3cc', note: 'Ivory is the undyed original, the colour of warm milk.', large: 960 },
  { id: 'moss', name: 'Moss', tint: [219, 229, 205], deep: [152, 180, 138], swatch: '#5e7d4f', note: 'Moss is a deep forest green that reads soft in daylight.', large: 625 },
  { id: 'poppy', name: 'Poppy', tint: [244, 217, 209], deep: [224, 154, 142], swatch: '#c93a2f', note: 'Poppy is the bright one: a true red with a warm undertone.', large: 625 },
  { id: 'sky', name: 'Sky', tint: [217, 231, 241], deep: [155, 187, 214], swatch: '#9dc0e0', note: 'Sky is a pale, clear blue, the colour of early morning.', large: 625 },
  { id: 'butter', name: 'Butter', tint: [247, 235, 195], deep: [232, 205, 114], swatch: '#f0d878', note: 'Butter is a gentle yellow that looks good on everyone.', large: 625 },
];

export const PRICE = '$42';
export const TITLE = 'Crochet Bonnet';
export const STORY =
  'Cut close and tied under the chin, the Bonnet stays put through naps, strolls and everything between. The scalloped edge is crocheted one shell at a time, so no two caps are exactly alike.';
export const DETAILS: [string, string][] = [
  ['Materials', 'Organic cotton yarn, soft cotton-jersey lining, cotton ribbon ties.'],
  ['Sizes', '0-3 months, 3-6 months, 6-12 months. Runs true to size.'],
  ['Care', 'Hand wash cool, reshape flat and dry in the shade. Do not tumble dry.'],
];
export const SIZES = ['0-3 m', '3-6 m', '6-12 m'];

export const indexOfId = (id: string) => COLORS.findIndex((c) => c.id === id);

export function imgSrcset(c: Colorway, angle: number): { src: string; srcset: string } {
  const base = `${import.meta.env.BASE_URL}assets/img/${c.id}-${['front', 'right', 'back', 'left'][angle]}`;
  return { src: `${base}-480.webp`, srcset: `${base}-480.webp 480w, ${base}-L.webp ${c.large}w` };
}
