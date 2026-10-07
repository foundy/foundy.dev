/**
 * The lazy Inspect chunk: core + panel UIs (stages, timeline) + the hero's inspectable; the card deck's inspectable follows. Imported on first activation (see ./toggle.ts).
 */
import '../../styles/inspect.css';
import { registerHeroInspectable } from '../../gl/hero/inspect';
import { inspect } from './core';
import { mountStagesPanel } from './panel';
import { mountTimelinePanel } from './timeline';
import { bridge } from './bridge';

export { inspect };

let unmount: (() => void) | undefined;
inspect.subscribe('change', () => {
  const had = unmount && document.activeElement && document.querySelector('.inspect-panel')?.contains(document.activeElement);
  unmount?.();
  unmount = undefined;
  const a = inspect.active;
  if (a?.kind === 'stages') unmount = mountStagesPanel(a);
  else if (a?.kind === 'timeline') unmount = mountTimelinePanel(a);
  // the focused control just left the DOM: hand focus back to the toggle instead of dropping it on <body>
  if (had && !a) document.querySelector<HTMLElement>('[data-inspect-toggle]')?.focus();
});

registerHeroInspectable();

// the card deck registers itself once its chunk is on the page (it may have been there first, or arrive later)
let cardsHooked = false;
const hookCards = () => {
  if (cardsHooked || !bridge.cards) return;
  cardsHooked = true;
  void import('../cards/inspect').then((m) => m.registerCardsInspectable(bridge.cards!));
};
hookCards();
bridge.onCards(hookCards);
