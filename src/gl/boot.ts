/**
 * Progressive enhancement for the home hero. The SVG poster is the first paint and the permanent fallback; this
 * tiny script (the only JS on the page) decides whether to load the GL chunk at all, then cross-fades to it.
 *
 *   load -> requestIdleCallback (timeout) -> [conditions] -> import('./hero') + SDF fetch in parallel -> mount -> fade
 *
 * Conditions: WebGL2 present, no `?gl=none`, not prefers-reduced-motion (the poster stays, no canvas is created),
 * not Save-Data. Any failure leaves the poster in place (one console.warn).
 *
 * QA flags:  ?gl=none | webgl2 (webgl2 ignores Save-Data and the idle wait)   ?hud=1   ?stage=sdf|warp|flow|composite
 *            ?tier=low|mid|high   ?t=<seconds> (freeze the shader clock)
 * With ?hud=1 the handle is exposed as window.__hero and timing marks are written (hero:chunk, hero:ready).
 */
import { bridge } from '../lib/inspect/bridge';
import type { HeroHandle } from './hero';

declare global {
  interface Window {
    __hero?: HeroHandle;
  }
}

const FADE_MS = 400;

export function bootHero() {
  const params = new URLSearchParams(location.search);
  const flag = params.get('gl');
  if (flag === 'none') return;

  const poster = document.querySelector<HTMLElement>('[data-hero-poster]');
  const stage = poster?.querySelector<HTMLElement>('.stage');
  const anchor = stage?.querySelector<SVGElement>('.art');
  if (!poster || !stage || !anchor) return;

  const forced = flag === 'webgl2';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  if (reduced.matches || (saveData && !forced) || !('WebGL2RenderingContext' in window)) return;

  const whenIdle = (fn: () => void) => {
    if (forced) return fn();
    const go = () => ('requestIdleCallback' in window ? window.requestIdleCallback(fn, { timeout: 2500 }) : setTimeout(fn, 250));
    if (document.readyState === 'complete') go();
    else addEventListener('load', go, { once: true });
  };

  whenIdle(async () => {
    let hero: HeroHandle | undefined;
    let canvas: HTMLCanvasElement | undefined;
    const teardown = () => {
      bridge.setHero(undefined);
      hero?.dispose();
      canvas?.remove();
      poster.classList.remove('gl-on', 'gl-instant', 'gl-done');
    };
    try {
      if (reduced.matches) return;
      const sdfUrl = `${import.meta.env.BASE_URL}gl/wordmark-sdf.png`.replace(/\/{2,}/g, '/');
      const sdf = fetch(sdfUrl).then((r) => {
        if (!r.ok) throw new Error(`sdf ${r.status}`);
        return r.blob();
      });
      sdf.catch(() => {}); // surfaced below, avoid an unhandled-rejection race
      const mod = await import('./hero');
      performance.mark('hero:chunk');

      canvas = document.createElement('canvas');
      canvas.className = 'hero-gl';
      canvas.setAttribute('aria-hidden', 'true');
      stage.appendChild(canvas);

      const tierParam = params.get('tier');
      const tFlag = params.get('t');
      hero = await mod.mountHero(canvas, {
        anchor,
        sdf,
        stage: mod.parseStage(params.get('stage')) ?? undefined,
        tier: tierParam === 'low' || tierParam === 'mid' || tierParam === 'high' ? tierParam : 'auto',
        freezeTime: tFlag != null && tFlag !== '' && Number.isFinite(Number(tFlag)) ? Number(tFlag) : undefined,
        hud: params.get('hud') === '1',
        onFirstInteract: () => poster.classList.add('gl-instant'),
      });
      performance.mark('hero:ready');
      bridge.setHero(hero);
      if (params.get('hud') === '1') window.__hero = hero;

      // two frames so the first image is really on screen before the poster lets go
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!hero) return;
          // already interacting: no point animating a fade the user is pushing through
          if (hero.interacted) poster.classList.add('gl-instant');
          poster.classList.add('gl-on');
          // gl-done = the canvas is fully opaque: wait for the real transitionend, with a timer as the fallback
          const cv = canvas;
          let finished = false;
          const finish = () => {
            if (finished) return;
            finished = true;
            cv?.removeEventListener('transitionend', onEnd);
            poster.classList.add('gl-done');
          };
          const onEnd = (e: TransitionEvent) => e.propertyName === 'opacity' && finish();
          cv?.addEventListener('transitionend', onEnd);
          setTimeout(finish, FADE_MS + 250);
        }),
      );

      // the visitor can turn reduced motion on mid-session: give them the static poster back
      reduced.addEventListener('change', () => {
        if (reduced.matches) {
          teardown();
          hero = undefined;
          canvas = undefined;
        }
      });
    } catch (e) {
      console.warn('[hero] staying on the static poster:', e instanceof Error ? e.message : e);
      teardown();
    }
  });
}
