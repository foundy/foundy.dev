/**
 * Gesture pipeline on Pointer Events, split in two so it can be recorded and replayed:
 *
 *   GesturePipeline   pure state machine. Fed `Sample`s ({t, x, y, type}), emits GestureEvents. No DOM, no clock.
 *                     Tap vs drag (slop), axis lock, the claim decision, velocity at release.
 *   bindPointerGesture  the DOM half: Pointer Events, pointer capture, cancel handling (pointercancel,
 *                     lostpointercapture, window blur, a second finger), and the touchmove preventDefault that keeps
 *                     the browser from turning a claimed pull into a scroll.
 *
 * Replay (./recorder) feeds the same samples to a fresh pipeline, so a recording reproduces the live decision.
 *
 * touch-action: the element should be `pan-y` (or `pan-x`) rather than `none`, so the browser keeps native scrolling
 * for gestures we decline. A gesture we claim is protected by preventDefault on its first cancelable touchmove.
 */
import { VelocityTracker } from './velocity';

/** px of travel before a pointer press stops being a tap and becomes a candidate drag */
export const SLOP_MOUSE = 8;
export const SLOP_TOUCH = 10;

export type SampleType = 'down' | 'move' | 'up' | 'cancel';
export interface Sample {
  /** ms, any origin (recordings use ms since pointerdown) */
  t: number;
  x: number;
  y: number;
  type: SampleType;
}
export type Axis = 'x' | 'y';
export type PointerKind = 'mouse' | 'touch' | 'pen';

export interface ClaimContext {
  axis: Axis;
  /** travel from the press point at the moment slop was crossed */
  dx: number;
  dy: number;
  pointerType: PointerKind;
}

export interface GestureConfig {
  slop: number;
  /** after slop: should this gesture become a drag we own? (default: yes) */
  claim?(c: ClaimContext): boolean;
}

interface Base {
  sample: Sample;
}
export type GestureEvent =
  | (Base & { kind: 'down' })
  /** slop crossed. `claimed` says whether the pipeline took the gesture. */
  | (Base & { kind: 'slop'; axis: Axis; dx: number; dy: number; claimed: boolean })
  /** dx, dy are measured from the claim point, so a claimed drag starts at 0 with no jump */
  | (Base & { kind: 'drag'; dx: number; dy: number; vx: number; vy: number })
  | (Base & { kind: 'release'; dx: number; dy: number; vx: number; vy: number; samples: number })
  | (Base & { kind: 'tap' })
  | (Base & { kind: 'cancel'; claimed: boolean; dx: number; dy: number });

type Phase = 'idle' | 'pending' | 'dragging' | 'ignored' | 'done';

export class GesturePipeline {
  phase: Phase = 'idle';
  axis: Axis | null = null;
  private down?: Sample;
  private claim?: Sample;
  private vel = new VelocityTracker();

  constructor(
    private cfg: GestureConfig,
    private pointerType: PointerKind,
    private emit: (e: GestureEvent) => void,
  ) {}

  get claimed() {
    return this.phase === 'dragging';
  }

  feed(s: Sample) {
    switch (s.type) {
      case 'down':
        if (this.phase !== 'idle') return;
        this.phase = 'pending';
        this.down = s;
        this.vel.reset();
        this.vel.add(s.t, s.x, s.y);
        this.emit({ kind: 'down', sample: s });
        return;
      case 'move':
        if (this.phase === 'pending') this.onPendingMove(s);
        else if (this.phase === 'dragging') {
          this.vel.add(s.t, s.x, s.y);
          const c = this.claim!;
          const v = this.vel.at(s.t);
          this.emit({ kind: 'drag', sample: s, dx: s.x - c.x, dy: s.y - c.y, vx: v.vx, vy: v.vy });
        }
        return;
      case 'up':
        if (this.phase === 'pending') this.emit({ kind: 'tap', sample: s });
        else if (this.phase === 'dragging') {
          this.vel.add(s.t, s.x, s.y);
          const c = this.claim!;
          const v = this.vel.at(s.t);
          this.emit({ kind: 'release', sample: s, dx: s.x - c.x, dy: s.y - c.y, vx: v.vx, vy: v.vy, samples: v.n });
        }
        this.phase = 'done';
        return;
      case 'cancel': {
        if (this.phase === 'idle' || this.phase === 'done') return;
        const claimed = this.phase === 'dragging';
        const c = this.claim ?? this.down!;
        this.emit({ kind: 'cancel', sample: s, claimed, dx: s.x - c.x, dy: s.y - c.y });
        this.phase = 'done';
      }
    }
  }

  private onPendingMove(s: Sample) {
    const d = this.down!;
    const dx = s.x - d.x;
    const dy = s.y - d.y;
    this.vel.add(s.t, s.x, s.y);
    if (Math.hypot(dx, dy) < this.cfg.slop) return;
    this.axis = Math.abs(dy) >= Math.abs(dx) ? 'y' : 'x';
    const claimed = this.cfg.claim ? this.cfg.claim({ axis: this.axis, dx, dy, pointerType: this.pointerType }) : true;
    this.emit({ kind: 'slop', sample: s, axis: this.axis, dx, dy, claimed });
    if (claimed) {
      this.phase = 'dragging';
      this.claim = s;
    } else this.phase = 'ignored';
  }
}

export interface BindOptions {
  /** called on pointerdown: return false to leave this press alone (links, buttons, text for mouse...) */
  accept?(e: PointerEvent): boolean;
  /** slop/claim config for this press */
  config(e: PointerEvent): GestureConfig;
  onEvent(e: GestureEvent, ctx: { pointerType: PointerKind; target: EventTarget | null }): void;
  /** every raw sample of an accepted press, before the pipeline sees it (the recorder hooks in here) */
  onSample?(s: Sample, ctx: { pointerType: PointerKind }): void;
}

/** Wire Pointer Events on `el` into a GesturePipeline. Returns an unbind function. */
export function bindPointerGesture(el: HTMLElement, o: BindOptions): () => void {
  let pipe: GesturePipeline | undefined;
  let pid = -1;
  let t0 = 0;
  let kind: PointerKind = 'mouse';
  let target: EventTarget | null = null;

  let lastT = 0;
  const sample = (e: PointerEvent, type: Sample['type']): Sample => ({ t: (lastT = e.timeStamp - t0), x: e.clientX, y: e.clientY, type });
  const feed = (s: Sample) => {
    o.onSample?.(s, { pointerType: kind });
    pipe?.feed(s);
  };
  const end = () => {
    if (pid >= 0) {
      try {
        el.releasePointerCapture(pid);
      } catch {
        /* not captured */
      }
    }
    pipe = undefined;
    pid = -1;
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', cancel, true);
    window.removeEventListener('blur', abort);
  };
  const abort = () => {
    if (!pipe) return;
    feed({ t: lastT, x: lastX, y: lastY, type: 'cancel' });
    end();
  };
  let lastX = 0;
  let lastY = 0;

  const down = (e: PointerEvent) => {
    if (pipe) {
      abort(); // a second finger: this is not our gesture
      return;
    }
    if (e.button !== 0 || !e.isPrimary || (o.accept && !o.accept(e))) return;
    kind = (e.pointerType as PointerKind) || 'mouse';
    pid = e.pointerId;
    t0 = e.timeStamp;
    target = e.target;
    lastX = e.clientX;
    lastY = e.clientY;
    pipe = new GesturePipeline(o.config(e), kind, (ev) => {
      o.onEvent(ev, { pointerType: kind, target });
      if (ev.kind === 'slop' && ev.claimed) {
        try {
          el.setPointerCapture(pid);
        } catch {
          /* pointer already gone */
        }
      }
    });
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('blur', abort);
    feed(sample(e, 'down'));
  };
  const move = (e: PointerEvent) => {
    if (!pipe || e.pointerId !== pid) return;
    lastX = e.clientX;
    lastY = e.clientY;
    feed(sample(e, 'move'));
  };
  const up = (e: PointerEvent) => {
    if (!pipe || e.pointerId !== pid) return;
    lastX = e.clientX;
    lastY = e.clientY;
    feed(sample(e, 'up'));
    end();
  };
  const cancel = (e: PointerEvent) => {
    if (!pipe || e.pointerId !== pid) return;
    lastX = e.clientX;
    lastY = e.clientY;
    feed(sample(e, 'cancel'));
    end();
  };
  const lost = (e: PointerEvent) => {
    // Capture ends on its own after up/cancel (pipe is already gone by then); anything else is a hijack.
    // lostpointercapture bubbles, and touch has an implicit capture on the original target that is released when we
    // capture on `el` ourselves: only capture lost ON el counts.
    if (pipe && e.target === el && e.pointerId === pid && pipe.claimed) abort();
  };
  // Pointer events run first, so by the time the browser would start a scroll `pipe.claimed` is already settled
  const touchmove = (e: TouchEvent) => {
    if (pipe?.claimed && e.cancelable) e.preventDefault();
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('lostpointercapture', lost);
  el.addEventListener('touchmove', touchmove, { passive: false });
  return () => {
    abort();
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
    el.removeEventListener('lostpointercapture', lost);
    el.removeEventListener('touchmove', touchmove);
  };
}
