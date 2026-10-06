/** Lean QA HUD, loaded only for `?hud=1` (separate chunk, never in the default bundle). */
import type { HeroHandle } from './index';

export function mountHud(hero: HeroHandle, host: HTMLElement) {
  const el = document.createElement('pre');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText =
    'position:fixed;left:8px;bottom:8px;max-width:calc(100vw - 16px);overflow:hidden;margin:0;padding:6px 8px;font:11px/1.35 var(--font-mono,monospace);' +
    'background:color-mix(in srgb,var(--paper) 82%,transparent);color:var(--ink);border:1px solid var(--rule);' +
    'pointer-events:none;white-space:pre;z-index:5';
  host.appendChild(el);
  const draw = () => {
    const s = hero.stats();
    const f = s.frameMs;
    el.textContent = [
      `hero  stage=${s.stage}  tier=${s.tier}${s.tierPinned ? ' (pinned)' : ''}  ${s.running ? 'running' : 'idle'}`,
      `canvas ${s.canvas.join('x')} @dpr ${s.dpr.toFixed(2)}  sim vel ${s.sim.vel.join('x')} dev ${s.sim.dev.join('x')}`,
      `frame ms  p50 ${f.p50.toFixed(1)}  p90 ${f.p90.toFixed(1)}  p95 ${f.p95.toFixed(1)}  (n=${f.n}, ~${(1000 / f.period).toFixed(0)}Hz)`,
      `frames ${s.frames}  ready ${s.readyMs.toFixed(0)}ms  ctx lost x${s.contextLosses}`,
      `tier changes: ${s.tierChanges.map((c) => `${c.reason}->${c.tier}@${c.at}`).join(', ') || 'none'}`,
      s.gpu,
    ].join('\n');
  };
  draw();
  const id = setInterval(() => {
    if (!hero.canvas.isConnected) {
      clearInterval(id);
      el.remove();
      return;
    }
    draw();
  }, 250);
}
