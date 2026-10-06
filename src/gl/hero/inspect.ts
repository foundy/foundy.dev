/**
 * The hero as an Inspectable (src/lib/inspect). Lives in the lazy Inspect chunk, never in the hero chunk.
 *
 *   GL running   -> scrubbing calls handle.renderStage(); the ink stays interactive in every stage.
 *   no GL        -> (?gl=none, prefers-reduced-motion, no WebGL2, GL failure) the same four stages are pre-rendered
 *                   stills (public/gl/stages, made by scripts/hero/render-stages.mjs) swapped over the poster.
 * If the GL hero arrives or goes away while Inspect is on, the mode follows.
 */
import { bridge } from '../../lib/inspect/bridge';
import { registerInspectable, type DetailRow, type InspectStage } from '../../lib/inspect/core';
import { sdf } from './wordmark.json';
import { HERO_STAGES, type HeroStage } from './stage';

const FADE_MS = 140;
const BASE = `${import.meta.env.BASE_URL}gl/stages/`.replace(/\/{2,}/g, '/');

const ms = (n: number) => n.toFixed(1);

let lastMs: [number, number] | undefined; // last measured p50/p90: the loop sleeps when nothing moves

function rowsCommon(): DetailRow[] {
  const h = bridge.hero;
  if (!h) return [['Renderer', 'not running: pre-rendered stills (WebP)']];
  const s = h.stats();
  const f = s.frameMs;
  if (f.n) lastMs = [f.p50, f.p90];
  return [
    ['Quality tier', `${s.tier} (${s.tierPinned ? 'pinned' : 'auto'})`],
    ['Canvas', `${s.canvas[0]}×${s.canvas[1]} px at DPR ${s.dpr.toFixed(2)}`],
    ['Frame time', f.n ? `p50 ${ms(f.p50)} ms · p90 ${ms(f.p90)} ms` : s.running ? 'measuring…' : 'asleep until you touch it'],
  ];
}

function rowsSim(): DetailRow[] {
  const s = bridge.hero?.stats();
  if (!s) return [];
  const [vx, vy] = s.sim.vel;
  const [dx, dy] = s.sim.dev;
  return [
    ['Sim grid', vx ? `velocity ${vx}×${vy} · ink ${dx}×${dy}` : 'not allocated at this stage'],
    ['Sim textures', 'RGBA16F (half float), ping-pong pairs'],
    ['Pointer force', s.force ? `${s.force.toFixed(2)} (${s.force < 1 ? 'hover' : 'drag'})` : '0 (no pointer)'],
  ];
}

const STAGES: InspectStage[] = [
  {
    id: 'sdf',
    label: 'SDF',
    explain:
      'Every pixel knows how far it is from the letters, and that distance is all the shader works with. The blue rings are like contour lines on a map.',
    detail: () => [
      ['Source', `baked at build time, ${sdf.width}×${sdf.height} px PNG`],
      ['Texture', 'RGBA8, distance in the red channel'],
      ['Range', `±${sdf.spread} units around each edge (box 1200×372)`],
      ...rowsCommon(),
    ],
  },
  {
    id: 'warp',
    label: 'Warp',
    explain:
      'A little noise nudges every distance, so the clean edges wobble the way ink settles into rough paper. The thin blue line is where the edge was before.',
    detail: () => [
      ['Noise', '2 octaves of value noise, drifting slowly'],
      ['Warp amount', '5 units peak to peak'],
      ['Cost', 'one extra texture lookup per pixel'],
      ...rowsCommon(),
    ],
  },
  {
    id: 'flow',
    label: 'Flow',
    explain:
      'Your pointer pushes an invisible current across the page. Each arrow shows which way the ink is being pushed there, and how hard: drag across the word to see it.',
    detail: () => [...rowsSim(), ['Damping', 'velocity × e^(−2.2 t), ink relaxes at 1.4 /s'], ...rowsCommon()],
  },
  {
    id: 'composite',
    label: 'Ink',
    explain:
      "The last step turns distance into ink: dark inside the letters, soft and uneven at the edges, with the paper's grain showing through. Push it around and it settles back into the word.",
    detail: () => [...rowsSim(), ['Edge', 'grain-thresholded while moving, crisp at rest'], ...rowsCommon()],
  },
];

export function registerHeroInspectable() {
  const poster = document.querySelector<HTMLElement>('[data-hero-poster]');
  const stage = poster?.querySelector<HTMLElement>('.stage');
  if (!poster || !stage) return;
  const caption = poster.querySelector<HTMLElement>('[data-inspect-caption]');
  const captionRest = caption?.textContent ?? '';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const dark = matchMedia('(prefers-color-scheme: dark)');
  let current = HERO_STAGES.length - 1;
  let on = false;
  let token = 0;
  let still: HTMLImageElement | undefined;
  let unsub: (() => void) | undefined;

  const stillUrl = (s: HeroStage) => `${BASE}${s}${dark.matches ? '-dark' : ''}.webp`;

  function clearStill() {
    still?.remove();
    still = undefined;
  }

  function showStill(s: HeroStage, my: number) {
    const img = new Image();
    img.className = 'inspect-still';
    img.alt = '';
    img.decoding = 'async';
    img.src = stillUrl(s);
    const put = () => {
      if (my !== token) return;
      const old = still;
      still = img;
      stage!.append(img);
      if (!old) return img.classList.add('in');
      requestAnimationFrame(() => img.classList.add('in'));
      setTimeout(() => old.remove(), reduced.matches ? 0 : FADE_MS + 40);
    };
    img.decode().then(put, put);
  }

  function showGL(s: HeroStage, my: number) {
    const h = bridge.hero!;
    const cv = h.canvas;
    clearStill();
    if (reduced.matches || h.stage === s) {
      cv.style.opacity = '';
      return h.renderStage(s);
    }
    // short dip instead of a blend: the last scrub wins, so dragging the slider never queues fades
    cv.style.opacity = '0';
    setTimeout(() => {
      if (my !== token || bridge.hero !== h) return;
      h.renderStage(s);
      requestAnimationFrame(() => my === token && (cv.style.opacity = ''));
    }, FADE_MS);
  }

  function show() {
    if (!on) return;
    const s = HERO_STAGES[current];
    const my = ++token;
    if (bridge.hero) showGL(s, my);
    else showStill(s, my);
    if (caption) caption.textContent = `Fig. 0 · Poster · stage ${current + 1} of ${HERO_STAGES.length}, ${s}`;
  }

  registerInspectable({
    id: 'hero',
    title: 'Hero',
    element: poster,
    kind: 'stages',
    stages: STAGES,
    initialScrub: HERO_STAGES.length - 1,
    onEnter() {
      on = true;
      if (!bridge.hero) for (const s of HERO_STAGES) new Image().src = stillUrl(s); // warm the cache for instant swaps
      unsub = bridge.onHero(() => {
        // GL arrived (or went away) while Inspect is on: follow it
        if (bridge.hero) clearStill();
        show();
      });
    },
    onScrub(v) {
      current = v;
      show();
    },
    onExit() {
      on = false;
      token++;
      unsub?.();
      clearStill();
      const h = bridge.hero;
      if (h) {
        h.canvas.style.opacity = '';
        h.renderStage('composite');
      }
      if (caption) caption.textContent = captionRest;
    },
  });
}
