/**
 * Inspect core: a registry of things that can be taken apart, plus the global inspect state. Framework-free.
 *
 * Two kinds of inspectable share one UI contract:
 *   'stages'    an image built in steps (the hero: SDF -> warp -> flow -> ink). The scrub value is a stage index,
 *               0 .. stages.length - 1. Each stage carries a plain-English `explain` and optional developer `detail`.
 *   'timeline'  a recorded interaction to replay (the card study, Phase 5). The scrub value is time in ms,
 *               0 .. timeline.duration. Only the interface exists today; panel.ts renders 'stages' only.
 *
 * Nothing here knows about GL, the DOM layout or the hero. It is loaded lazily (see ./toggle.ts).
 */

/** one row of developer numbers: [label, value] */
export type DetailRow = readonly [label: string, value: string];

export interface InspectStage {
  id: string;
  /** short name for the scrubber stop */
  label: string;
  /** one or two sentences anyone can follow: this is what gets announced */
  explain: string;
  /** developer numbers, read at most ~4x/s while the Details disclosure is open */
  detail?(): DetailRow[];
}

export interface InspectTimeline {
  /** ms */
  duration: number;
  markers?: { at: number; label: string; explain: string }[];
  /** placeholder for gesture replay: start playing from the current scrub position */
  replay?(): void;
  detail?(): DetailRow[];
}

export interface Inspectable {
  id: string;
  title: string;
  /** the region this inspectable owns; the panel is appended inside it and blueprint styling applies to it */
  element: HTMLElement;
  kind: 'stages' | 'timeline';
  stages?: InspectStage[];
  timeline?: InspectTimeline;
  /** scrub value to start from when Inspect turns on (default 0) */
  initialScrub?: number;
  onEnter?(): void;
  onExit?(): void;
  /** the scrub value changed (stages: an integer index; timeline: ms) */
  onScrub?(value: number): void;
}

export type InspectEvent = 'change' | 'scrub';

const registry = new Map<string, Inspectable>();
const listeners: Record<InspectEvent, Set<() => void>> = { change: new Set(), scrub: new Set() };
let enabled = false;
let active: Inspectable | null = null;
let scrub = 0;

const emit = (e: InspectEvent) => listeners[e].forEach((fn) => fn());

function maxScrub(i: Inspectable) {
  return i.kind === 'stages' ? Math.max(0, (i.stages?.length ?? 1) - 1) : (i.timeline?.duration ?? 0);
}

function enter(i: Inspectable) {
  active = i;
  scrub = i.initialScrub ?? 0;
  i.onEnter?.();
  i.onScrub?.(scrub);
}

function leave() {
  const i = active;
  active = null;
  i?.onExit?.();
}

export const inspect = {
  get enabled() {
    return enabled;
  },
  get active() {
    return active;
  },
  /** stages: current stage index (integer); timeline: ms */
  get scrub() {
    return scrub;
  },
  setEnabled(on: boolean) {
    if (on === enabled) return;
    enabled = on;
    if (on) {
      const first = registry.values().next().value;
      if (first) enter(first);
    } else leave();
    emit('change');
  },
  /** switch to another registered inspectable while Inspect is on */
  activate(id: string) {
    const next = registry.get(id);
    if (!enabled || !next || next === active) return;
    leave();
    enter(next);
    emit('change');
  },
  setScrub(v: number) {
    if (!active) return;
    const next = Math.min(Math.max(active.kind === 'stages' ? Math.round(v) : v, 0), maxScrub(active));
    if (next === scrub) return;
    scrub = next;
    active.onScrub?.(next);
    emit('scrub');
  },
  subscribe(event: InspectEvent, fn: () => void) {
    listeners[event].add(fn);
    return () => void listeners[event].delete(fn);
  },
};

/** Register something inspectable. Returns an unregister function. Safe to call before or after Inspect is on. */
export function registerInspectable(def: Inspectable): () => void {
  registry.set(def.id, def);
  if (enabled && !active) {
    enter(def);
    emit('change');
  }
  return () => {
    if (registry.get(def.id) !== def) return;
    registry.delete(def.id);
    if (active === def) {
      leave();
      const next = registry.values().next().value;
      if (enabled && next) enter(next);
      emit('change');
    }
  };
}
