// Short fade-scale path: used when the hero is off-screen at close time (never selectable by the user).
import { type Transition, smooth } from '../types';

export const fade: Transition = {
  id: 'fade',
  open: { k: 520, c: 44 },
  close: { k: 760, c: 52 },
  draw(g, e) {
    g.bg(e.tone);
    g.backs(e, {}, 0);
    const s = e.slot;
    const a = 1 - smooth(e.p, 0.25, 1);
    const k = 1 + 0.08 * e.p;
    g.card({ tex: g.get(g.paths[e.deck.from]), cx: s.x + s.w / 2, cy: s.y + s.h / 2, w: s.w * k, h: s.h * k, alpha: a });
  },
};
