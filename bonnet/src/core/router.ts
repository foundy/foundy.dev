// URL <-> state. Pure functions (testable) plus two tiny storage wrappers.
//   /bonnet/#<productId>        detail page of that product
//   /bonnet/?world=light|water  which world draws the browse view
// Which world opens: ?world= (explicit) > the user's own switch choice (localStorage, PER CATALOGUE) > the catalogue default
// (?set=bonnet -> Light, ?set=mixed -> Water). Only a click on the switch is a "choice"; a default or a ?world= visit is never stored.
import type { WorldId } from './state';

export type SetKey = 'bonnet' | 'mixed';
export const DEFAULT_BY_SET: Record<SetKey, WorldId> = { bonnet: 'light', mixed: 'water' };
export const DEFAULT_WORLD: WorldId = DEFAULT_BY_SET.bonnet;
const KEY = (set: SetKey) => `bonnet.world.${set}`;

export const setOf = (search: string): SetKey => (new URLSearchParams(search).get('set') === 'mixed' ? 'mixed' : 'bonnet');

export function parseWorld(v: string | null | undefined): WorldId | null {
  return v === 'light' || v === 'water' ? v : null;
}

export interface Start {
  world: WorldId;
  /** product index from the hash, or -1 */
  detail: number;
}

/** the URL parameter wins, then the remembered choice (of this catalogue), then the catalogue's default */
export function resolveStart(search: string, hash: string, ids: string[], stored: string | null): Start {
  const q = new URLSearchParams(search);
  const world = parseWorld(q.get('world')) ?? parseWorld(stored) ?? DEFAULT_BY_SET[setOf(search)];
  return { world, detail: indexFromHash(hash, ids) };
}

export function indexFromHash(hash: string, ids: string[]): number {
  const id = hash.replace(/^#/, '');
  return id ? ids.indexOf(id) : -1;
}

/** the location with `world` replaced and the hash set (id) or removed (null); other params survive */
export function buildUrl(loc: { pathname: string; search: string; hash: string }, o: { world?: WorldId; id?: string | null }): string {
  const q = new URLSearchParams(loc.search);
  if (o.world) q.set('world', o.world);
  const s = q.toString();
  const hash = o.id === undefined ? loc.hash : o.id ? '#' + o.id : '';
  return loc.pathname + (s ? '?' + s : '') + hash;
}

export function loadWorld(set: SetKey = 'bonnet'): string | null {
  try {
    return localStorage.getItem(KEY(set));
  } catch {
    return null;
  }
}
export function saveWorld(w: WorldId, set: SetKey = 'bonnet') {
  try {
    localStorage.setItem(KEY(set), w);
  } catch {
    /* private mode */
  }
}
