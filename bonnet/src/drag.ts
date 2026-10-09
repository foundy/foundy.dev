// One horizontal-drag helper for gesture surfaces (deck stage, detail hero).
// Rules baked in:
//  - the surface carries `touch-action: pan-y pinch-zoom` in CSS, so vertical pans are the browser's and we never fight them
//  - a pointerdown that starts inside a <button> (other than the surface itself, marked data-gesture) is ignored
//  - nothing is preventDefault()ed on pointer/touch move; no global listeners except cleanup (blur / visibilitychange)
//  - ghost-click suppression: only this element, only the one click that follows a real drag, expiring after 400 ms
import { DragTracker } from './motion';

export interface DragHandlers {
  onStart?(tr: DragTracker, e: PointerEvent): void;
  onMove(tr: DragTracker, e: PointerEvent): void;
  onEnd(tr: DragTracker, e: PointerEvent): void;
  onCancel(): void;
}

export function attachDrag(el: HTMLElement, h: DragHandlers) {
  let tr: DragTracker | null = null;
  let id = -1;
  let suppressUntil = 0;

  const clean = (cancel: boolean) => {
    const was = tr;
    tr = null;
    id = -1;
    if (cancel && was && was.intent === 'drag') h.onCancel();
  };

  el.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    suppressUntil = 0;
    const btn = (e.target as Element).closest('button');
    if (btn && btn !== el && !btn.hasAttribute('data-gesture')) return;
    if (tr) clean(true);
    tr = new DragTracker(e.clientX, e.clientY, e.timeStamp, el.clientWidth || 1);
    id = e.pointerId;
  });

  el.addEventListener('pointermove', (e) => {
    if (!tr || e.pointerId !== id) return;
    const before = tr.intent;
    const now = tr.move(e.clientX, e.clientY, e.timeStamp);
    if (now === 'reject') {
      tr = null;
      return;
    }
    if (now !== 'drag') return;
    if (before !== 'drag') {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {}
      h.onStart?.(tr, e);
    }
    h.onMove(tr, e);
  });

  el.addEventListener('pointerup', (e) => {
    if (!tr || e.pointerId !== id) return;
    const t = tr;
    tr = null;
    id = -1;
    if (t.intent === 'drag') {
      suppressUntil = performance.now() + 400;
      t.move(e.clientX, e.clientY, e.timeStamp);
      h.onEnd(t, e);
    }
  });

  el.addEventListener('pointercancel', () => clean(true));
  // lostpointercapture bubbles: moving capture from the inner <button> to `el` fires it on the button, which is not a loss for us
  el.addEventListener('lostpointercapture', (e) => e.target === el && e.pointerId === id && clean(true));

  // a drag that ends on this element must not also "tap" it: swallow that one click here, and only here
  el.addEventListener(
    'click',
    (e) => {
      if (suppressUntil && performance.now() < suppressUntil) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      suppressUntil = 0;
    },
    true,
  );

  const away = () => clean(true);
  window.addEventListener('blur', away);
  document.addEventListener('visibilitychange', () => document.hidden && away());
}
