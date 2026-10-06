/**
 * Spike shared code: SDF bake, query params, theme colours, input, loop
 * lifecycle (offscreen / hidden / reduced motion / resize / dispose) and HUD.
 * Both renderer variants (raw WebGL2, three TSL) plug into `run()`.
 */

export type Stage = 'sdf' | 'warp' | 'flow' | 'composite';
export type Look = 'ink' | 'refract' | 'riso';

export interface Query {
  stage: Stage;
  look: Look;
  hud: boolean;
  dprCap: number;
  forceWebGL: boolean;
  bench: boolean;
  /** freeze animation clock at this time (screenshots) */
  freeze: number | null;
}

export function readQuery(): Query {
  const p = new URLSearchParams(location.search);
  const stage = p.get('stage') as Stage;
  const look = p.get('look') as Look;
  return {
    stage: ['sdf', 'warp', 'flow', 'composite'].includes(stage) ? stage : 'composite',
    look: ['ink', 'refract', 'riso'].includes(look) ? look : 'ink',
    hud: p.get('hud') === '1',
    dprCap: Math.max(1, Number(p.get('dpr')) || 1.5),
    forceWebGL: p.get('gl') === 'webgl2' || p.get('forceWebGL') === '1',
    bench: p.get('bench') === '1',
    freeze: p.has('t') ? Number(p.get('t')) : null,
  };
}

/* ------------------------------------------------------------------ */
/* Theme: colours come from tokens.css custom properties               */
/* ------------------------------------------------------------------ */
export type RGB = [number, number, number];
export interface Theme {
  paper: RGB;
  paperSunk: RGB;
  ink: RGB;
  inkSoft: RGB;
  inkMuted: RGB;
  accent: RGB;
  blue: RGB;
}

function hex(v: string): RGB {
  const h = v.trim().replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
}

export function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const g = (n: string) => hex(cs.getPropertyValue(n));
  return {
    paper: g('--paper'),
    paperSunk: g('--paper-sunk'),
    ink: g('--ink'),
    inkSoft: g('--ink-soft'),
    inkMuted: g('--ink-muted'),
    accent: g('--accent'),
    blue: g('--bp-line-on-paper'),
  };
}

/* ------------------------------------------------------------------ */
/* SDF bake: canvas text -> anti-aliased Felzenszwalb EDT (as TinySDF)  */
/* ------------------------------------------------------------------ */
export interface SDF {
  data: Uint16Array; // R16F bits, row 0 = bottom (GL convention), 0.5 = edge, >0.5 inside
  width: number;
  height: number;
  /** distance range in sdf pixels mapped to [0..0.5] */
  radius: number;
  bakeMs: number;
}

const INF = 1e20;

function edt1d(f: Float64Array, d: Float64Array, v: Uint16Array, z: Float64Array, n: number) {
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1, k = 0; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  for (let q = 0, k = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

function edt(grid: Float64Array, w: number, h: number) {
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Uint16Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, d, v, z, h);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    edt1d(f, d, v, z, w);
    for (let x = 0; x < w; x++) grid[y * w + x] = Math.sqrt(d[x]);
  }
}

/** float -> IEEE half bits (values here are in [0,1]; no inf/nan handling needed) */
function toHalf(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 0x3c00;
  let e = Math.floor(Math.log2(v));
  let m = Math.round((v / 2 ** e - 1) * 1024);
  if (m === 1024) {
    m = 0;
    e++;
  }
  if (e < -14) return Math.round(v / 2 ** -24); // subnormal
  return ((e + 15) << 10) | m;
}

export async function bakeSDF(text = 'foundy', W = 1024, radius = 24): Promise<SDF> {
  const family = '"Schibsted Grotesk Variable"';
  await document.fonts.load(`820 200px ${family}`, text);
  const t0 = performance.now();
  const c = document.createElement('canvas');
  const probe = c.getContext('2d', { willReadFrequently: true })!;
  const weight = 820;
  probe.font = `${weight} 200px ${family}, system-ui, sans-serif`;
  const m = probe.measureText(text);
  const inkW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
  const inkH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  const targetW = W - 2 * radius;
  const size = (200 * targetW) / inkW;
  const H = Math.ceil((inkH * size) / 200 + 2 * radius);
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.font = `${weight} ${size}px ${family}, system-ui, sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  const m2 = ctx.measureText(text);
  const x = radius + m2.actualBoundingBoxLeft;
  const y = radius + m2.actualBoundingBoxAscent;
  ctx.fillText(text, x, y);
  const img = ctx.getImageData(0, 0, W, H).data;
  const n = W * H;
  const outer = new Float64Array(n);
  const inner = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = img[i * 4 + 3] / 255;
    if (a === 1) {
      outer[i] = 0;
      inner[i] = INF;
    } else if (a === 0) {
      outer[i] = INF;
      inner[i] = 0;
    } else {
      const dd = 0.5 - a;
      outer[i] = dd > 0 ? dd * dd : 0;
      inner[i] = dd < 0 ? dd * dd : 0;
    }
  }
  edt(outer, W, H);
  edt(inner, W, H);
  const data = new Uint16Array(n);
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const i = row * W + col;
      const signed = inner[i] - outer[i]; // >0 inside
      const v = Math.min(1, Math.max(0, 0.5 + signed / (2 * radius)));
      data[(H - 1 - row) * W + col] = toHalf(v);
    }
  }
  return { data, width: W, height: H, radius, bakeMs: performance.now() - t0 };
}

/* ------------------------------------------------------------------ */
/* Renderer contract                                                    */
/* ------------------------------------------------------------------ */
export interface FrameState {
  time: number; // seconds (animation clock)
  dt: number; // seconds, clamped
  aspect: number; // canvas w / h
  /** pointer segment in height-normalised units (x*aspect, y), y up */
  a: [number, number];
  b: [number, number];
  vel: [number, number]; // height-units / s
  active: number; // 0..1
}

export interface RendererInit {
  canvas: HTMLCanvasElement;
  sdf: SDF;
  theme: Theme;
  query: Query;
}

export interface Renderer {
  backend: string;
  gpuInfo: string;
  /** compile/prepare everything */
  init(): Promise<void>;
  resize(pxW: number, pxH: number, dpr: number): void;
  frame(s: FrameState): void;
  /** resolve when submitted GPU work is done (for bench / first-frame timing) */
  gpuSync(): Promise<void>;
  dispose(): void;
}

/* ------------------------------------------------------------------ */
/* Stats                                                                */
/* ------------------------------------------------------------------ */
function pct(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

export interface Stats {
  frames: number;
  median: number;
  p95: number;
  max: number;
  over167: number;
  over33: number;
  cpuMedian: number;
  cpuP95: number;
}

export function summarize(dts: number[], cpu: number[]): Stats {
  const s = [...dts].sort((a, b) => a - b);
  const c = [...cpu].sort((a, b) => a - b);
  return {
    frames: dts.length,
    median: pct(s, 0.5),
    p95: pct(s, 0.95),
    max: s[s.length - 1] ?? 0,
    over167: dts.filter((x) => x > 16.7 + 0.5).length,
    over33: dts.filter((x) => x > 33.4).length,
    cpuMedian: pct(c, 0.5),
    cpuP95: pct(c, 0.95),
  };
}

/* ------------------------------------------------------------------ */
/* run(): lifecycle + HUD                                               */
/* ------------------------------------------------------------------ */
export interface SpikeApi {
  ready: Promise<void>;
  info: Record<string, unknown>;
  disposed: boolean;
  stats(): Stats;
  resetStats(): void;
  bench(ms: number): Promise<Stats>;
  dispose(): void;
}

declare global {
  interface Window {
    __spike?: SpikeApi;
  }
}

const WIN = 240;

export function run(
  make: (init: RendererInit) => Renderer,
  canvas: HTMLCanvasElement,
  hudEl: HTMLElement | null,
  label: string,
) {
  const query = readQuery();
  const tStart = performance.now();
  const info: Record<string, unknown> = { label, query };
  const dts: number[] = [];
  const cpus: number[] = [];
  let disposed = false;
  let renderer: Renderer | null = null;
  let raf = 0;
  let lastNow = 0;
  let visible = !document.hidden;
  let inView = true;
  let running = false;
  let clock = 0;
  let benching = false;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  info.reducedMotion = reduced.matches;

  const P = { x: 0.5, y: 0.5, px: 0.5, py: 0.5, vx: 0, vy: 0, moved: false, seen: false };
  const st: FrameState = {
    time: 0,
    dt: 1 / 60,
    aspect: 1,
    a: [0, 0],
    b: [0, 0],
    vel: [0, 0],
    active: 0,
  };
  const onMove = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    P.x = (e.clientX - r.left) / r.height; // height units
    P.y = 1 - (e.clientY - r.top) / r.height;
    P.moved = true;
    if (!P.seen) {
      P.px = P.x;
      P.py = P.y;
      P.seen = true;
    }
  };
  const onLeave = () => (P.seen = false);

  const updatePointer = (dt: number) => {
    if (P.moved && P.seen) {
      const vx = (P.x - P.px) / dt;
      const vy = (P.y - P.py) / dt;
      const k = 1 - Math.exp(-dt * 25);
      P.vx += (vx - P.vx) * k;
      P.vy += (vy - P.vy) * k;
      st.a = [P.px, P.py];
      st.b = [P.x, P.y];
      st.active = 1;
    } else {
      st.active = 0;
      P.vx *= 0.5;
      P.vy *= 0.5;
    }
    st.vel = [P.vx, P.vy];
    P.px = P.x;
    P.py = P.y;
    P.moved = false;
  };

  const sizeCanvas = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, query.dprCap);
    const w = Math.max(2, Math.round(r.width * dpr));
    const h = Math.max(2, Math.round(r.height * dpr));
    info.canvasPx = [w, h];
    info.dpr = dpr;
    info.cssPx = [Math.round(r.width), Math.round(r.height)];
    st.aspect = w / h;
    renderer?.resize(w, h, dpr);
  };

  const hud = hudEl && query.hud ? hudEl : null;
  if (hudEl && !hud) hudEl.hidden = true;
  let hudT = 0;
  const drawHud = (now: number) => {
    if (!hud || now - hudT < 250) return;
    hudT = now;
    const s = summarize(dts, cpus);
    const js = performance
      .getEntriesByType('resource')
      .filter((e) => e.name.includes('.js')) as PerformanceResourceTiming[];
    const kb = (n: number) => (n / 1024).toFixed(0);
    const dec = js.reduce((a, e) => a + e.decodedBodySize, 0);
    const enc = js.reduce((a, e) => a + e.encodedBodySize, 0);
    const f = (v: unknown) => (typeof v === 'number' ? v.toFixed(0) : '-');
    hud.textContent = [
      `${label}  backend=${info.backend}`,
      `stage=${query.stage} look=${query.look} dpr=${info.dpr} px=${(info.canvasPx as number[])?.join('x')}`,
      `frame ms  med ${s.median.toFixed(1)}  p95 ${s.p95.toFixed(1)}  max ${s.max.toFixed(1)}   (n=${s.frames})`,
      `cpu ms    med ${s.cpuMedian.toFixed(2)}  p95 ${s.cpuP95.toFixed(2)}`,
      `long      >16.7: ${s.over167}   >33: ${s.over33}`,
      `sdf bake ${f(info.sdfMs)}ms  init ${f(info.initMs)}ms  first frame ${f(info.firstFrameMs)}ms`,
      `js ${kb(dec)} KB decoded / ${kb(enc)} KB transferred (gzip: see docs)`,
      `${info.gpu}`,
      info.reducedMotion ? 'reduced motion: static frame' : running ? 'running' : 'paused',
    ].join('\n');
  };

  const step = (now: number) => {
    raf = 0;
    if (!running || benching || disposed) return;
    const dtMs = now - lastNow;
    lastNow = now;
    if (dtMs > 0 && dtMs < 1000) {
      dts.push(dtMs);
      if (dts.length > WIN) dts.shift();
    }
    const dt = Math.min(dtMs / 1000, 1 / 20);
    const c0 = performance.now();
    updatePointer(Math.max(dt, 1 / 240));
    clock += dt;
    st.dt = dt;
    st.time = query.freeze ?? clock;
    renderer!.frame(st);
    cpus.push(performance.now() - c0);
    if (cpus.length > WIN) cpus.shift();
    drawHud(now);
    raf = requestAnimationFrame(step);
  };

  const updateRunning = () => {
    const want = !disposed && visible && inView && !reduced.matches && !!renderer;
    if (want && !running) {
      running = true;
      lastNow = performance.now();
      raf = requestAnimationFrame(step);
    } else if (!want && running) {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }
    if (hud && !running) drawHud(performance.now() + 1000);
  };

  const onVis = () => {
    visible = !document.hidden;
    updateRunning();
  };
  const io = new IntersectionObserver((es) => {
    inView = es[es.length - 1].isIntersecting;
    updateRunning();
  });
  const redrawStatic = () => {
    st.dt = 100;
    renderer!.frame(st);
    st.dt = 0;
    renderer!.frame(st);
  };
  const ro = new ResizeObserver(() => {
    if (!renderer || disposed) return;
    sizeCanvas();
    // a paused / static (reduced-motion) canvas must redraw after a resize
    if (!running && !benching) redrawStatic();
  });
  const onReduce = () => {
    info.reducedMotion = reduced.matches;
    updateRunning();
  };

  const api: SpikeApi = {
    info,
    disposed: false,
    ready: undefined as unknown as Promise<void>,
    stats: () => summarize(dts, cpus),
    resetStats: () => {
      dts.length = 0;
      cpus.length = 0;
    },
    async bench(ms: number) {
      // back-to-back frames, each awaiting GPU completion: GPU-inclusive ms/frame
      benching = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      const times: number[] = [];
      const cp: number[] = [];
      const t0 = performance.now();
      let i = 0;
      while (performance.now() - t0 < ms && !disposed) {
        const now = performance.now();
        const dt = 1 / 60;
        i++;
        const a = (Math.sin(i * 0.045) * 0.5 + 0.5) * st.aspect;
        const b = Math.sin(i * 0.071 + 1) * 0.35 + 0.5;
        st.a = [P.px, P.py];
        st.b = [a, b];
        st.vel = [(a - P.px) / dt, (b - P.py) / dt];
        st.active = i > 1 ? 1 : 0;
        P.px = a;
        P.py = b;
        clock += dt;
        st.dt = dt;
        st.time = clock;
        const c0 = performance.now();
        renderer!.frame(st);
        const c1 = performance.now();
        await renderer!.gpuSync();
        times.push(performance.now() - now);
        cp.push(c1 - c0);
      }
      benching = false;
      st.active = 0;
      updateRunning();
      return summarize(times, cp);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      api.disposed = true;
      running = false;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      reduced.removeEventListener('change', onReduce);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('pagehide', api.dispose);
      renderer?.dispose();
      renderer = null;
    },
  };

  api.ready = (async () => {
    const sdf = await bakeSDF();
    info.sdfMs = sdf.bakeMs;
    info.sdfSize = [sdf.width, sdf.height];
    const theme = readTheme();
    const t1 = performance.now();
    renderer = make({ canvas, sdf, theme, query });
    sizeCanvas();
    await renderer.init();
    info.backend = renderer.backend;
    info.gpu = renderer.gpuInfo;
    info.initMs = performance.now() - t1;
    // prime: huge dt snaps the density to its rest state; then one real frame
    st.time = query.freeze ?? 0;
    st.dt = 100;
    st.active = 0;
    renderer.frame(st);
    st.dt = reduced.matches ? 0 : 1 / 60;
    renderer.frame(st);
    await renderer.gpuSync();
    info.firstFrameMs = performance.now() - tStart; // from script start incl. SDF bake
    info.firstFrameAfterInitMs = performance.now() - t1; // incl. shader compile + first draw
    canvas.dataset.ready = '1';
    if (!reduced.matches) {
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerleave', onLeave);
    }
    document.addEventListener('visibilitychange', onVis);
    reduced.addEventListener('change', onReduce);
    window.addEventListener('pagehide', api.dispose);
    io.observe(canvas);
    ro.observe(canvas);
    updateRunning();
    if (query.bench) info.benchStats = await api.bench(4000);
  })();
  api.ready.catch((e) => {
    info.error = String(e);
    console.error(e);
    if (hud) hud.textContent = `ERROR: ${e}`;
  });
  window.__spike = api;
  return api;
}
