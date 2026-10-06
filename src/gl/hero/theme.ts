/** Colours come from tokens.css custom properties, read at mount and again when the colour scheme changes. */
export type RGB = [number, number, number];

export interface Theme {
  paper: RGB;
  ink: RGB;
  accent: RGB;
  blue: RGB;
}

function parse(v: string, fallback: RGB): RGB {
  let h = v.trim().replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return fallback;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
}

export function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const g = (name: string, fb: RGB) => parse(cs.getPropertyValue(name), fb);
  return {
    paper: g('--paper', [0.957, 0.941, 0.91]),
    ink: g('--ink', [0.086, 0.078, 0.059]),
    accent: g('--accent', [0.722, 0.227, 0.118]),
    blue: g('--bp-line-on-paper', [0.141, 0.278, 0.659]),
  };
}

/** calls `cb` after the user's colour scheme flips; returns an unsubscribe */
export function watchTheme(cb: (t: Theme) => void): () => void {
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const on = () => requestAnimationFrame(() => cb(readTheme())); // let the new custom-property values apply
  mq.addEventListener('change', on);
  return () => mq.removeEventListener('change', on);
}
