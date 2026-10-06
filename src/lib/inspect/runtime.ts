/**
 * The lazy Inspect chunk: core + panel UI + the hero's inspectable. Imported on first activation (see ./toggle.ts).
 */
import '../../styles/inspect.css';
import { registerHeroInspectable } from '../../gl/hero/inspect';
import { inspect } from './core';
import { mountStagesPanel } from './panel';

export { inspect };

let unmount: (() => void) | undefined;
inspect.subscribe('change', () => {
  const had = unmount && document.activeElement && document.querySelector('.inspect-panel')?.contains(document.activeElement);
  unmount?.();
  unmount = undefined;
  const a = inspect.active;
  if (a?.kind === 'stages') unmount = mountStagesPanel(a);
  // the focused control just left the DOM: hand focus back to the toggle instead of dropping it on <body>
  if (had && !a) document.querySelector<HTMLElement>('[data-inspect-toggle]')?.focus();
});

registerHeroInspectable();
