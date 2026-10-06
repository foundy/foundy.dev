/**
 * Inspect's eager half (~0.5 KB gz). Wires the toggle button and the keyboard, and fetches the real Inspect chunk
 * (./runtime) only when it is first needed: on activation, or as a prefetch when the visitor shows intent
 * (hover / focus / touch on the button). The button is in the static HTML, so it is usable the moment the page shows.
 */
type Runtime = typeof import('./runtime');

export function initInspectToggle() {
  const SEL = '[data-inspect-toggle]';
  if (!document.querySelector(SEL)) return;
  // there can be more than one toggle (header/hero, and one inside the card sheet, whose background is inert while open)
  const all = () => document.querySelectorAll<HTMLButtonElement>(SEL);
  const mark = () => all().forEach((b) => b.setAttribute('aria-pressed', String(on)));
  let rt: Promise<Runtime> | undefined;
  const load = () => (rt ??= import('./runtime'));
  let on = false;

  const set = (next: boolean) => {
    on = next;
    mark();
    document.body.dataset.inspect = on ? 'on' : 'off';
    load().then(
      (m) => m.inspect.setEnabled(on),
      () => {
        // the chunk failed to load (offline): put the toggle back instead of pretending
        on = false;
        mark();
        document.body.dataset.inspect = 'off';
        rt = undefined;
      },
    );
  };

  document.addEventListener('click', (e) => {
    if ((e.target as Element | null)?.closest?.(SEL)) set(!on);
  });
  // intent on any toggle: fetch the chunk now so the click does not wait for it
  for (const ev of ['pointerover', 'focusin', 'touchstart'] as const) {
    const once = (e: Event) => {
      if (!(e.target as Element | null)?.closest?.(SEL)) return;
      document.removeEventListener(ev, once, true);
      load();
    };
    document.addEventListener(ev, once, { capture: true, passive: true });
  }

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    if (e.key === 'Escape') {
      if (on) set(false);
      return;
    }
    if (e.key.toLowerCase() !== 'i' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat) return;
    const t = e.target as HTMLElement | null;
    // typing contexts only: a focused slider or checkbox is not text entry
    if (t?.closest('textarea, select, [contenteditable]:not([contenteditable="false"])') || t?.isContentEditable) return;
    if (t instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button', 'submit'].includes(t.type)) return;
    set(!on);
  });
}
