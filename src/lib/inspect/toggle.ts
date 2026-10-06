/**
 * Inspect's eager half (~0.5 KB gz). Wires the toggle button and the keyboard, and fetches the real Inspect chunk
 * (./runtime) only when it is first needed: on activation, or as a prefetch when the visitor shows intent
 * (hover / focus / touch on the button). The button is in the static HTML, so it is usable the moment the page shows.
 */
type Runtime = typeof import('./runtime');

export function initInspectToggle() {
  const btn = document.querySelector<HTMLButtonElement>('[data-inspect-toggle]');
  if (!btn) return;
  let rt: Promise<Runtime> | undefined;
  const load = () => (rt ??= import('./runtime'));
  let on = false;

  const set = (next: boolean) => {
    on = next;
    btn.setAttribute('aria-pressed', String(on));
    document.body.dataset.inspect = on ? 'on' : 'off';
    load().then(
      (m) => m.inspect.setEnabled(on),
      () => {
        // the chunk failed to load (offline): put the toggle back instead of pretending
        on = false;
        btn.setAttribute('aria-pressed', 'false');
        document.body.dataset.inspect = 'off';
        rt = undefined;
      },
    );
  };

  btn.addEventListener('click', () => set(!on));
  for (const ev of ['pointerenter', 'focus', 'touchstart'] as const) btn.addEventListener(ev, load, { once: true, passive: true });

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
