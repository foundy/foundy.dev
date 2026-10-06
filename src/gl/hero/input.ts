/**
 * Pointer -> ink force.
 *
 * Desktop (mouse / pen):  moving over the canvas adds a gentle force (HOVER_STRENGTH); holding the button and dragging
 *                         adds a strong one (1.0). The drag keeps working outside the canvas (pointer capture).
 * Touch:                  the canvas has `touch-action: pan-y`, so vertical swipes scroll the page as usual and
 *                         never reach us. Force is added by (a) a horizontal drag, or (b) a long press: hold still for
 *                         HOLD_MS, then move in any direction. While a long press is armed we cancel the browser's
 *                         scroll (non-passive touchmove) so the finger can go vertical without scrolling the page.
 */
export const HOVER_STRENGTH = 0.35;
export const HOLD_MS = 300;
const SLOP = 9; // px a finger may wander during the hold and still count as "holding"

type Mode = 'idle' | 'hover' | 'drag' | 'pending' | 'held' | 'scroll';

export interface PointerSample {
  /** css px relative to the canvas, y down */
  from: [number, number];
  to: [number, number];
  /** css px / s */
  vel: [number, number];
  strength: number;
}

export interface Input {
  /** returns the motion since the previous call, or null when there is none */
  take(dt: number): PointerSample | null;
  /** true once the user has actually pushed ink (used to make the cross-fade instant) */
  readonly interacted: boolean;
  /** true while a finger/button is down on the canvas */
  readonly down: boolean;
  dispose(): void;
}

export function createInput(canvas: HTMLCanvasElement, onActivity: () => void): Input {
  let mode: Mode = 'idle';
  let id = -1;
  let x = 0;
  let y = 0;
  let px = 0;
  let py = 0;
  let vx = 0;
  let vy = 0;
  let moved = false;
  let seen = false;
  let sx = 0;
  let sy = 0;
  let holdTimer = 0;
  let interacted = false;
  let strength = 0;

  const local = (e: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const setPos = (p: [number, number]) => {
    x = p[0];
    y = p[1];
    if (!seen) {
      px = x;
      py = y;
      seen = true;
    }
  };
  const clearHold = () => {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = 0;
  };
  const end = () => {
    clearHold();
    mode = 'idle';
    id = -1;
    seen = false;
    moved = false;
  };

  const onDown = (e: PointerEvent) => {
    setPos(local(e));
    px = x;
    py = y;
    sx = x;
    sy = y;
    id = e.pointerId;
    if (e.pointerType === 'touch') {
      mode = 'pending';
      clearHold();
      holdTimer = window.setTimeout(() => {
        if (mode === 'pending') mode = 'held';
      }, HOLD_MS);
    } else {
      mode = 'drag';
      strength = 1;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best effort */
      }
    }
  };

  const onMove = (e: PointerEvent) => {
    const p = local(e);
    if (e.pointerType === 'touch') {
      if (e.pointerId !== id) return;
      if (mode === 'pending') {
        const dx = p[0] - sx;
        const dy = p[1] - sy;
        if (Math.hypot(dx, dy) > SLOP) {
          clearHold();
          // pan-y means a vertical swipe is the browser's; if it is mostly horizontal it is ours
          mode = Math.abs(dx) > Math.abs(dy) ? 'drag' : 'scroll';
        }
      }
      if (mode !== 'drag' && mode !== 'held') return;
      strength = 1;
    } else {
      if (mode === 'idle') mode = 'hover';
      strength = e.buttons & 1 ? 1 : HOVER_STRENGTH;
    }
    setPos(p);
    moved = true;
    interacted = true;
    onActivity();
  };

  const onUp = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || mode === 'drag') {
      if (e.pointerId === id || e.pointerType !== 'touch') end();
    }
    if (e.pointerType !== 'touch') mode = 'hover';
  };
  const onLeave = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' && mode === 'hover') end();
  };
  const onCancel = () => end();
  // Cancelling touchmove is what keeps the page from scrolling once a long press is armed. It only works from a
  // non-passive listener, and only before the browser has started scrolling.
  const onTouchMove = (e: TouchEvent) => {
    if ((mode === 'held' || mode === 'drag') && e.cancelable) e.preventDefault();
  };
  const onContext = (e: Event) => e.preventDefault();

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('contextmenu', onContext);

  return {
    take(dt) {
      if (!moved) {
        vx *= 0.5;
        vy *= 0.5;
        return null;
      }
      const d = Math.max(dt, 1 / 240);
      const k = 1 - Math.exp(-d * 25);
      vx += ((x - px) / d - vx) * k;
      vy += ((y - py) / d - vy) * k;
      const s: PointerSample = { from: [px, py], to: [x, y], vel: [vx, vy], strength };
      px = x;
      py = y;
      moved = false;
      return s;
    },
    get interacted() {
      return interacted;
    },
    get down() {
      return mode === 'drag' || mode === 'held' || mode === 'pending';
    },
    dispose() {
      end();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('contextmenu', onContext);
    },
  };
}
