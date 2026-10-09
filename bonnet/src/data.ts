// Product data. Order is fixed by the plan: ivory, moss, poppy, sky, butter.
// M0a: ivory is a disabled slot (the synthesized ivory photos arrive in M0b). It is skipped by every navigation path.
export interface Color {
  id: string;
  name: string;
  /** file token in assets/raw/bonnet-<file>-<angle>.webp; null = not available yet */
  file: string | null;
  /** low-saturation page tone */
  tone: [number, number, number];
  /** yarn / swatch colour */
  yarn: string;
}

export const COLORS: Color[] = [
  { id: 'ivory', name: 'Ivory', file: null, tone: [240, 235, 222], yarn: '#f1ead8' },
  { id: 'moss', name: 'Moss', file: 'green', tone: [222, 230, 213], yarn: '#7d9a6a' },
  { id: 'poppy', name: 'Poppy', file: 'red', tone: [240, 219, 213], yarn: '#d4584a' },
  { id: 'sky', name: 'Sky', file: 'skyblue', tone: [216, 229, 239], yarn: '#7db3d6' },
  { id: 'butter', name: 'Butter', file: 'yellow', tone: [243, 236, 200], yarn: '#e8c94d' },
];

export const ANGLES = ['front', 'right', 'back', 'left'] as const;
export const ANGLE_LABELS = ['Front view', 'Right view', 'Back view', 'Left view'];

export const available = (i: number) => i >= 0 && i < COLORS.length && COLORS[i].file !== null;

/** next available color index from `from` in direction `dir` (+1/-1), or -1 */
export function neighbor(from: number, dir: 1 | -1): number {
  for (let i = from + dir; i >= 0 && i < COLORS.length; i += dir) if (available(i)) return i;
  return -1;
}

export function colorIndexById(id: string): number {
  const i = COLORS.findIndex((c) => c.id === id);
  return i >= 0 && available(i) ? i : -1;
}

export function photoUrl(color: number, angle: number, base = import.meta.env.BASE_URL): string {
  return `${base}assets/raw/bonnet-${COLORS[color].file}-${ANGLES[angle]}.webp`;
}

export const COPY = {
  name: 'Hand-knit baby bonnet',
  story:
    'A soft shell-stitch bonnet worked in one piece, with a ruffled edge that frames the face and a ribbon that ties under the chin. Each stitch is a small loop, and the loops add up to a shape that holds.',
  materials: ['Mercerized cotton, 100%', 'Mother-of-pearl style button closure', 'Cotton ribbon ties'],
  sizes: ['0-3 months', '3-6 months', '6-12 months'],
  care: 'Hand wash cool, reshape and dry flat. Do not wring or tumble dry.',
  price: '$48 (mock)',
  demo: 'Demo — sample product',
};
