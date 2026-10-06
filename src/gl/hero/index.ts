/**
 * Hero shader: public entry. `mountHero(canvas, options)` puts a WebGL2 ink-on-paper rendering of the wordmark on
 * top of the static SVG poster (`options.anchor`), aligned to the poster's DOM rect. Throws on any failure; the
 * caller (src/gl/boot.ts) keeps the poster in that case.
 *
 * Pipeline (each stage can be rendered alone, see `HeroStage` / `renderStage`):
 *   1 sdf  ->  2 warp  ->  3 flow (velocity + ink deviation)  ->  4 composite
 */
import { createClock } from '../../lib/core/clock';
import { createQuality, type Tier, TIER_ORDER } from '../../lib/core/quality';
import { createContext, createLoop } from '../renderer';
import { createInput, type Input } from './input';
import { createPipeline, TIER_SPECS, type Force, type Layout } from './pipeline';
import { HeroStage } from './stage';
import { readTheme, watchTheme } from './theme';

export { HeroStage, HERO_STAGES, parseStage } from './stage';
export type { Tier } from '../../lib/core/quality';

export interface HeroOptions {
  /** the poster's SVG element: the canvas is laid out over its DOM rect */
  anchor: Element;
  /** the baked SDF PNG (public/gl/wordmark-sdf.png), as a Blob or a promise of one */
  sdf: Blob | Promise<Blob>;
  stage?: HeroStage;
  /** 'auto' starts at mid and adapts; a fixed tier pins it (QA) */
  tier?: Tier | 'auto';
  /** freeze the animation clock at this time (screenshots, diffs) */
  freezeTime?: number;
  /** show the lean HUD (lazy chunk, absent from the bundle otherwise) */
  hud?: boolean;
  /** fired once, the first time the visitor pushes ink */
  onFirstInteract?: () => void;
}

export interface HeroStats {
  frames: number;
  running: boolean;
  stage: HeroStage;
  tier: Tier;
  tierPinned: boolean;
  tierChanges: { at: number; tier: Tier; reason: string }[];
  dpr: number;
  canvas: [number, number];
  sim: { vel: [number, number]; dev: [number, number] };
  gpu: string;
  frameMs: { n: number; p50: number; p90: number; p95: number; period: number };
  contextLosses: number;
  readyMs: number;
}

export interface HeroHandle {
  readonly canvas: HTMLCanvasElement;
  readonly stage: HeroStage;
  readonly tier: Tier;
  readonly interacted: boolean;
  /** render a single stage in isolation (and keep showing it) */
  renderStage(stage: HeroStage): void;
  setTier(tier: Tier): void;
  stats(): HeroStats;
  dispose(): void;
}

const IDLE_MS = 6500; // exp(-1.4 * 6.5) ~ 1e-4: the ink is back on the wordmark before the loop sleeps
const SETTLE_MS = 160;

export async function mountHero(canvas: HTMLCanvasElement, options: HeroOptions): Promise<HeroHandle> {
  const t0 = performance.now();
  const anchor = options.anchor;
  const bitmap = await decodeSdf(await options.sdf);

  let disposed = false;
  let losses = 0;
  let stage: HeroStage = options.stage ?? HeroStage.Composite;
  let layout: Layout | null = null;
  let dpr = 1;
  let idleUntil = 0;
  let lastFrame = -1;
  let readyMs = 0;
  const tierChanges: HeroStats['tierChanges'] = [];

  const quality = createQuality({
    start: options.tier && options.tier !== 'auto' ? options.tier : 'mid',
    pinned: !!options.tier && options.tier !== 'auto',
    onChange: (tier, reason) => {
      tierChanges.push({ at: Math.round(performance.now()), tier, reason });
      relayout();
      poke(SETTLE_MS);
    },
  });
  const clock = createClock();
  if (options.freezeTime != null) clock.freeze(options.freezeTime);

  const ctx = createContext(canvas, {
    onLost() {
      losses++;
      loop.setBlocked(true);
    },
    onRestored() {
      pipeline.rebuild();
      relayout();
      renderNow();
      loop.setBlocked(false);
      poke(SETTLE_MS);
    },
  });
  const pipeline = createPipeline(ctx, bitmap, stage);
  pipeline.setTheme(readTheme());
  const stopTheme = watchTheme((t) => {
    pipeline.setTheme(t);
    poke(SETTLE_MS);
  });

  let firstInteract = !!options.onFirstInteract;
  const input: Input = createInput(canvas, () => {
    if (firstInteract) {
      firstInteract = false;
      options.onFirstInteract?.();
    }
    poke(0);
  });

  /* ---------------- layout: canvas over the poster's DOM rect ---------------- */
  function relayout() {
    const ar = anchor.getBoundingClientRect();
    if (ar.width < 2 || ar.height < 2) return;
    const parent = (canvas.offsetParent as HTMLElement | null) ?? (anchor.parentElement as HTMLElement);
    const pr = parent.getBoundingClientRect();
    // margin around the poster so ink pushed past the wordmark's edge is not cut off
    const m = Math.round(Math.min(16, Math.max(8, ar.width * 0.012)));
    const cssW = ar.width + 2 * m;
    const cssH = ar.height + 2 * m;
    const s = canvas.style;
    s.left = `${ar.left - pr.left - m}px`;
    s.top = `${ar.top - pr.top - m}px`;
    s.width = `${cssW}px`;
    s.height = `${cssH}px`;
    dpr = Math.min(window.devicePixelRatio || 1, TIER_SPECS[quality.tier].dpr);
    const w = Math.max(2, Math.round(cssW * dpr));
    const h = Math.max(2, Math.round(cssH * dpr));
    canvas.width = w;
    canvas.height = h;
    const sx = w / cssW;
    const sy = h / cssH;
    layout = { w, h, px: sx, cssW, cssH, box: [m * sx, m * sy, ar.width * sx, ar.height * sy] };
    pipeline.resize(layout, quality.tier);
  }

  /* ---------------- frames ---------------- */
  const noForce: Force = { a: [0, 0], b: [0, 0], vel: [0, 0], active: 0 };
  function force(dt: number): Force {
    const s = input.take(dt);
    if (!s || !layout) return noForce;
    const H = layout.cssH;
    const k = 0.55 + 0.45 * s.strength; // hover pushes with a fraction of a drag's speed
    return {
      a: [s.from[0] / H, 1 - s.from[1] / H],
      b: [s.to[0] / H, 1 - s.to[1] / H],
      vel: [(s.vel[0] / H) * k, (-s.vel[1] / H) * k],
      active: s.strength,
    };
  }

  function renderNow() {
    if (!layout) return;
    pipeline.frame({ dt: 1 / 60, time: clock.time, force: noForce });
  }

  function poke(ms: number) {
    idleUntil = Math.max(idleUntil, performance.now() + ms);
    loop.wake();
  }

  const loop = createLoop({
    target: canvas,
    onStart(now) {
      clock.resume(now);
      lastFrame = -1;
      quality.reset();
    },
    frame(now) {
      const dt = clock.tick(now);
      const f = force(dt);
      if (f.active > 0) idleUntil = Math.max(idleUntil, now + IDLE_MS);
      pipeline.frame({ dt, time: clock.time, force: f });
      if (lastFrame >= 0 && now - lastFrame < 250) quality.push(now - lastFrame, now);
      lastFrame = now;
      return now < idleUntil;
    },
  });

  const ro = new ResizeObserver(() => {
    if (disposed) return;
    relayout();
    renderNow(); // a resize clears the canvas: paint before the next compositor frame
    poke(SETTLE_MS);
  });
  ro.observe(anchor);

  /* ---------------- first frame ---------------- */
  relayout();
  renderNow();
  renderNow();
  await pipeline.done();
  readyMs = performance.now() - t0;
  poke(SETTLE_MS);

  const handle: HeroHandle = {
    canvas,
    get stage() {
      return stage;
    },
    get tier() {
      return quality.tier;
    },
    get interacted() {
      return input.interacted;
    },
    renderStage(s) {
      stage = s;
      pipeline.setStage(s);
      relayout();
      renderNow();
      poke(SETTLE_MS);
    },
    setTier(t) {
      if (!TIER_ORDER.includes(t)) return;
      quality.set(t); // pins: no further adaptation
      relayout();
      poke(SETTLE_MS);
    },
    stats() {
      return {
        frames: loop.frames,
        running: loop.running,
        stage,
        tier: quality.tier,
        tierPinned: quality.pinned,
        tierChanges,
        dpr,
        canvas: [canvas.width, canvas.height],
        sim: pipeline.simSize,
        gpu: ctx.caps.gpu,
        frameMs: quality.summary(),
        contextLosses: losses,
        readyMs,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      loop.dispose();
      ro.disconnect();
      input.dispose();
      stopTheme();
      pipeline.dispose();
      ctx.dispose();
      bitmap.close?.();
    },
  };

  if (options.hud) {
    import('./hud').then((m) => !disposed && m.mountHud(handle, anchor.parentElement ?? document.body));
  }
  return handle;
}

async function decodeSdf(blob: Blob): Promise<ImageBitmap> {
  // raw distance values: ask for no colour conversion / premultiplication where the browser lets us
  try {
    return await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  } catch {
    return createImageBitmap(blob);
  }
}
