/**
 * What the (lazy) feature chunks and the (lazy) Inspect chunk share: the live hero handle (nothing when the hero runs as
 * the static poster) and the card deck's handle. Kept separate from both so neither drags the other into its bundle.
 */
import type { HeroHandle } from '../../gl/hero';
import type { CardsHandle } from '../cards/types';

let hero: HeroHandle | undefined;
const subs = new Set<() => void>();
let cards: CardsHandle | undefined;
const cardSubs = new Set<() => void>();

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
  /** the card deck's handle, once its chunk has loaded */
  get cards() {
    return cards;
  },
  setCards(c: CardsHandle | undefined) {
    cards = c;
    cardSubs.forEach((fn) => fn());
  },
  onCards(fn: () => void) {
    cardSubs.add(fn);
    return () => void cardSubs.delete(fn);
  },
};
