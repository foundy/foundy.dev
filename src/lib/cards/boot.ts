/**
 * Eager half of the work cards (~0.6 KB gz). Without JS the cards are plain links to /work/[slug] and stay that way.
 * With JS this turns a click on a card's picture or title into "open the preview sheet", and fetches the real chunk
 * (./index: sheet, springs, gestures) on the first sign of intent (pointerdown / focus on a card) or when idle,
 * so a click usually finds it already there. A direct load of `/#work/<slug>` opens the sheet straight away.
 */
type Cards = typeof import('./index');

export function initCards() {
  const cards = document.querySelectorAll<HTMLElement>('[data-card]');
  if (!cards.length) return;
  let mod: Promise<Cards> | undefined;
  const load = () => (mod ??= import('./index'));

  document.documentElement.dataset.cards = '';
  cards.forEach((c) => {
    const t = c.querySelector<HTMLElement>('[data-card-title]');
    t?.setAttribute('aria-haspopup', 'dialog');
    t?.setAttribute('aria-expanded', 'false');
    t?.setAttribute('aria-controls', 'work-sheet');
  });

  const intent = (e: Event) => {
    if ((e.target as Element | null)?.closest?.('[data-card]')) void load();
  };
  document.addEventListener('pointerdown', intent, { capture: true, passive: true });
  document.addEventListener('focusin', intent, { capture: true, passive: true });

  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.<HTMLAnchorElement>('[data-card-trigger]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const slug = a.closest<HTMLElement>('[data-card]')?.dataset.card;
    if (!slug) return;
    e.preventDefault();
    load().then(
      (m) => m.openCard(slug),
      () => (location.href = a.href), // the chunk failed: a link still works
    );
  });

  if (/^#work\/[a-z0-9-]+$/.test(location.hash)) void load().then((m) => m.openFromHash());
  else {
    const idle = () => ('requestIdleCallback' in window ? window.requestIdleCallback(() => void load(), { timeout: 4000 }) : setTimeout(() => void load(), 2000));
    if (document.readyState === 'complete') idle();
    else addEventListener('load', idle, { once: true });
  }
  // a hash change we did not cause (typed URL, a link to #work/...) while the chunk is not loaded yet
  addEventListener('popstate', () => {
    if (!mod && /^#work\/[a-z0-9-]+$/.test(location.hash)) void load().then((m) => m.openFromHash());
  });
}
