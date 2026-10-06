/**
 * The one thing the (eager) hero boot script and the (lazy) Inspect chunk share: the live hero handle, or nothing
 * when the hero runs as the static poster. Kept separate from both so neither drags the other into its bundle.
 */
import type { HeroHandle } from '../../gl/hero';

let hero: HeroHandle | undefined;
const subs = new Set<() => void>();

export const bridge = {
  get hero() {
    return hero;
  },
  setHero(h: HeroHandle | undefined) {
    hero = h;
    subs.forEach((fn) => fn());
  },
  onHero(fn: () => void) {
    subs.add(fn);
    return () => void subs.delete(fn);
  },
};
