// Live Dye static demo (front angle). Raw WebGL2, no framework.
// dye = { from, to, origin{x,y} (photo px), p } is the single state shared by GL (and, later, DOM --dye).
const ASSETS = '../assets/';
const SIZE = 625;                 // photo/mask/cell-map resolution
const JITTER_PX = 10;             // per-cell threshold jitter (photo px)
const SOFT_PX = 6;                // cross-fade width of one cell flipping (in wavefront distance)
const COLORS = [
  { id: 'green',   file: 'green-front.webp',   hex: '#6f8f68' },
  { id: 'red',     file: 'red-front.webp',     hex: '#d3202a' },
  { id: 'skyblue', file: 'skyblue-front.webp', hex: '#a9c6e0' },
  { id: 'ivory',   file: 'ivory-front.webp',   hex: '#efe3cf' },   // synthesized
  { id: 'yellow',  file: 'yellow-front.webp',  hex: '#f3e6a4' },
];
const BASE_INDEX = 4;             // outside the mask ALWAYS samples this photo (yellow == ivory there): face never changes
const qs = new URLSearchParams(location.search);
const QA = qs.has('qa');
const CROP = QA ? 1 : 623 / 625;   // the source photos have a 2px white column at x=623..624: crop it (uniformly) in the live view          // ?qa=1&size=625 -> deterministic export mode

const stage = document.getElementById('stage');
const canvas = document.getElementById('gl');
const rail = document.getElementById('rail');
const readout = document.getElementById('read');
const dbg = { mask: document.getElementById('dbgMask'), cells: document.getElementById('dbgCells'), dist: document.getElementById('dbgDist') };

const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
if (!gl) { stage.textContent = 'WebGL2 not available'; throw new Error('no webgl2'); }

// ---------------------------------------------------------------- shaders
const VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
uniform float uCrop;
void main(){ vUv = vec2(aPos.x*.5+.5, .5-aPos.y*.5) * uCrop; gl_Position = vec4(aPos,0.,1.); }`;

const FS = `#version 300 es
precision highp float; precision highp int;
in vec2 vUv; out vec4 o;
uniform sampler2D uBase, uA, uB, uMask, uCells, uTable;
uniform vec2 uOrigin;          // photo px
uniform float uR;              // wavefront radius (photo px)
uniform float uP;              // 0..1 progress
uniform float uPx;             // photo px per CSS px (seam is 2 CSS px)
uniform float uJit, uSoft;
uniform vec3 uDye;             // target colour (for debug ring tint)
uniform float uRmax;
uniform int uDbgMask, uDbgCells, uDbgDist;
const float S = ${SIZE}.0;

vec3 ramp(float t){ t = clamp(t,0.,1.); return vec3(.5+.5*cos(6.2831*(t+vec3(0.,.33,.67)))); }
float hash(float n){ return fract(sin(n*12.9898)*43758.5453); }

void main(){
  vec3 base = texture(uBase, vUv).rgb;
  float m = texture(uMask, vUv).r;
  vec2 px = vUv * S;
  vec4 cell = texelFetch(uCells, ivec2(clamp(px, vec2(0.), vec2(S-1.))), 0);
  int id = int(cell.r*255.+.5) + int(cell.g*255.+.5)*256;
  vec4 cd = texelFetch(uTable, ivec2(id & 511, id >> 9), 0);   // cx, cy, jitter, row
  vec2 c = cell.a > .5 ? cd.xy : px;
  float thr = distance(c, uOrigin) + cd.z * uJit;
  float f = uR - thr;                                  // >0: this cell has flipped
  float flip = smoothstep(0., uSoft, f);
  vec3 A = texture(uA, vUv).rgb, B = texture(uB, vUv).rgb;
  vec3 yarn = mix(A, B, flip);
  // stitch pop: a cell brightens briefly as it flips
  float pop = smoothstep(0., 3., f) * (1. - smoothstep(3., 34., f));
  yarn += pop * 0.16 * (1. - yarn) ;
  // 2 CSS px bright seam on the wavefront, only inside the mask
  float w = 1.0 * uPx;                                 // half width in photo px (=1 CSS px)
  float d = distance(px, uOrigin);
  float seam = 1. - smoothstep(w*.6, w + .9*uPx, abs(d - uR));
  seam *= smoothstep(0., .02, uP) * (1. - smoothstep(.97, 1., uP));
  yarn = mix(yarn, vec3(1.0, .97, .90), seam * .85);
  vec3 col = mix(base, yarn, m);                       // m == 0  ->  exactly base

  if (uDbgDist == 1) {
    float t = (distance(c, uOrigin) + cd.z*uJit) / uRmax;
    vec3 v = ramp(t*.85);
    float iso = 1. - smoothstep(.0, 1.2*uPx, abs(fract(d/20.)-.5)*20. - 8.8);
    col = mix(col, v, .55 * step(.5, m) + .12);
    col = mix(col, vec3(0.), iso*.35);
    col = mix(col, vec3(1.), 1. - smoothstep(0., 1.5*uPx, abs(d-uR)));
  }
  if (uDbgCells == 1 && cell.a > .5) {
    vec3 h = vec3(hash(float(id)), hash(float(id)+17.), hash(float(id)+41.));
    col = mix(col, .25 + .7*h, .65 * step(.01, m));
  }
  if (uDbgMask == 1) {
    col = mix(col, vec3(1., 0., 1.), .45 * m);
    col = mix(col, vec3(0., 1., 0.), .8 * step(.02, m) * step(m, .98));
  }
  o = vec4(col, 1.);
}`;

function compile(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
const prog = gl.createProgram();
gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
gl.useProgram(prog);
const vbo = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
const aPos = gl.getAttribLocation(prog, 'aPos');
gl.enableVertexAttribArray(aPos);
gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
const U = {};
for (const n of ['uCrop', 'uBase', 'uA', 'uB', 'uMask', 'uCells', 'uTable', 'uOrigin', 'uR', 'uP', 'uPx', 'uJit', 'uSoft', 'uDye', 'uRmax', 'uDbgMask', 'uDbgCells', 'uDbgDist'])
  U[n] = gl.getUniformLocation(prog, n);

// ---------------------------------------------------------------- textures
async function bitmap(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status);
  // no colour conversion, no premultiply: ids / masks must stay exact
  return createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}
function tex2d(unit, { linear, mips }) {
  const t = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : (linear ? gl.LINEAR : gl.NEAREST));
  return t;
}
gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

const photos = [];       // per colour texture
let rmaxCache = 0, table = null;      // table: cells {cx,cy,jitter}

async function boot() {
  const [maskBmp, cellsBmp, tableJson, ...photoBmps] = await Promise.all([
    bitmap(ASSETS + 'mask-front.png'), bitmap(ASSETS + 'cells-front.png'),
    fetch(ASSETS + 'cells-front.json').then(r => r.json()),
    ...COLORS.map(c => bitmap(ASSETS + c.file)),
  ]);
  // units: 0 base, 1 A, 2 B (bound per frame from photos[]), 3 mask, 4 cells, 5 table
  photos.length = 0;
  photoBmps.forEach((b) => {
    const t = tex2d(7, { linear: true, mips: true });
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, b);
    gl.generateMipmap(gl.TEXTURE_2D);
    photos.push(t);
  });
  tex2d(3, { linear: true, mips: false });
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, maskBmp);
  tex2d(4, { linear: false, mips: false });
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, cellsBmp);
  // cell table texture: 512 wide, RGBA32F texelFetch (cx, cy, jitter, row)
  table = tableJson.cells;
  const n = table.length + 1, hgt = Math.ceil(n / 512);
  const data = new Float32Array(512 * hgt * 4);
  for (const c of table) { const o = c.id * 4; data[o] = c.cx; data[o + 1] = c.cy; data[o + 2] = c.jitter; data[o + 3] = c.row; }
  tex2d(5, { linear: false, mips: false });
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 512, hgt, 0, gl.RGBA, gl.FLOAT, data);
  gl.uniform1i(U.uBase, 0); gl.uniform1i(U.uA, 1); gl.uniform1i(U.uB, 2);
  gl.uniform1i(U.uMask, 3); gl.uniform1i(U.uCells, 4); gl.uniform1i(U.uTable, 5);
  gl.uniform1f(U.uJit, JITTER_PX); gl.uniform1f(U.uSoft, SOFT_PX);
}

// ---------------------------------------------------------------- shared dye state
const dye = { from: 0, to: 0, origin: { x: SIZE / 2, y: SIZE / 2 }, p: 0, rmax: 1 };
let cur = 3;      // start on ivory (synthesized) to judge it first
dye.from = dye.to = cur;

function maxThreshold(ox, oy) {
  let m = 0;
  for (const c of table) m = Math.max(m, Math.hypot(c.cx - ox, c.cy - oy) + c.jitter * JITTER_PX);
  return m;
}
function beginDye(from, to, ox, oy) {
  dye.from = from; dye.to = to; dye.origin = { x: ox, y: oy }; dye.p = 0;
  dye.rmax = maxThreshold(ox, oy) + SOFT_PX + 4;
}

let needsDraw = true;
function draw() {
  needsDraw = false;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, photos[BASE_INDEX]);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, photos[dye.from]);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, photos[dye.to]);
  // R(p): p=0 -> nothing flipped (R<0), p=1 -> everything flipped incl. soft edge
  const R = -2 + dye.p * (dye.rmax + 4);
  gl.uniform2f(U.uOrigin, dye.origin.x, dye.origin.y);
  gl.uniform1f(U.uR, dye.p <= 0 ? -1e4 : R);
  gl.uniform1f(U.uP, dye.p);
  gl.uniform1f(U.uPx, SIZE * CROP / (QA ? canvas.width : stage.clientWidth));
  gl.uniform1f(U.uCrop, CROP);
  gl.uniform1f(U.uRmax, dye.rmax);
  gl.uniform1i(U.uDbgMask, dbg.mask.checked ? 1 : 0);
  gl.uniform1i(U.uDbgCells, dbg.cells.checked ? 1 : 0);
  gl.uniform1i(U.uDbgDist, dbg.dist.checked ? 1 : 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  readout.textContent = `${COLORS[dye.from].id} -> ${COLORS[dye.to].id}  p=${dye.p.toFixed(3)}  origin=(${dye.origin.x.toFixed(0)},${dye.origin.y.toFixed(0)})  canvas=${canvas.width}px`;
}
function invalidate() { needsDraw = true; requestTick(); }

// ---------------------------------------------------------------- animation (springs / tweens)
let anim = null;     // {type:'spring', target, v, onDone} | {type:'tween', t0, dur, onDone}
let raf = 0, last = 0;
function requestTick() { if (!raf) { raf = requestAnimationFrame(tick); } }
function finish(commit) {
  if (commit) { cur = dye.to; }
  dye.from = dye.to = cur; dye.p = 0; anim = null; updateRail(); needsDraw = true;
}
function tick(t) {
  raf = 0;
  const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
  if (anim) {
    if (anim.type === 'spring') {
      const w = 20, steps = Math.max(1, Math.ceil(dt / (1 / 240)));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const a = -w * w * (dye.p - anim.target) - 2 * w * anim.v;      // critically damped
        anim.v += a * h; dye.p += anim.v * h;
        // never overshoot the target
        if ((anim.target === 1 && dye.p >= 1) || (anim.target === 0 && dye.p <= 0)) { dye.p = anim.target; anim.v = 0; break; }
      }
      if (Math.abs(dye.p - anim.target) < 0.0008 && Math.abs(anim.v) < 0.02) { dye.p = anim.target; finish(anim.target === 1); }
    } else {
      const k = Math.min(1, (t - anim.t0) / anim.dur);
      dye.p = k >= 1 ? 1 : 1 - Math.pow(2, -10 * k);                    // easeOutExpo
      if (k >= 1) finish(true);
    }
    needsDraw = true;
  }
  if (needsDraw) draw();
  if (anim) { last = t; raf = requestAnimationFrame(tick); } else last = 0;
}

// ---------------------------------------------------------------- input
const idxNext = (i) => (i + 1) % COLORS.length, idxPrev = (i) => (i + COLORS.length - 1) % COLORS.length;
let drag = null;
function toPhoto(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * SIZE * CROP, y: (e.clientY - r.top) / r.height * SIZE * CROP, w: r.width };
}
stage.addEventListener('pointerdown', (e) => {
  if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
  if (anim) finish(true);                       // finish remaining progress instantly, then start the new gesture
  const o = toPhoto(e);
  drag = { id: e.pointerId, x0: e.clientX, o, w: o.w, samples: [{ t: e.timeStamp, x: e.clientX }], dir: 0 };
  try { stage.setPointerCapture(e.pointerId); } catch (_) {}
});
stage.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x0;
  drag.samples.push({ t: e.timeStamp, x: e.clientX });
  while (drag.samples.length > 2 && e.timeStamp - drag.samples[0].t > 100) drag.samples.shift();
  const dir = dx < 0 ? 1 : -1;                  // drag left -> next colour, right -> previous
  if (dx === 0) return;
  if (dir !== drag.dir) {                       // direction (re)chosen: target colour changes, origin stays at touch start
    drag.dir = dir;
    beginDye(cur, dir === 1 ? idxNext(cur) : idxPrev(cur), drag.o.x, drag.o.y);
  }
  dye.p = Math.min(1, Math.abs(dx) / drag.w);   // 1:1 from the first pixel
  invalidate();
});
function release(e, cancelled) {
  if (!drag || e.pointerId !== drag.id) return;
  const s = drag.samples, a = s[0], b = s[s.length - 1];
  const v = b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0;           // px/ms, signed
  const dirV = drag.dir === 1 ? -v : v;                          // speed along the committed direction
  const commit = !cancelled && drag.dir !== 0 && (dye.p > 0.5 || (dirV > 0.3 && dye.p > 0.02));
  const had = drag.dir !== 0;
  drag = null;
  if (!had) return;
  const vp = Math.max(-6, Math.min(6, (dirV / (stage.clientWidth)) * 1000));   // p/s
  anim = { type: 'spring', target: commit ? 1 : 0, v: commit ? Math.max(0, vp) : Math.min(0, vp) };
  requestTick();
}
stage.addEventListener('pointerup', (e) => release(e, false));
stage.addEventListener('pointercancel', (e) => release(e, true));

function buttonDye(index, btn) {
  if (anim) finish(true);
  if (index === cur) return;
  const r = canvas.getBoundingClientRect(), b = btn.getBoundingClientRect();
  // wavefront originates under the pressed swatch (below the stage), projected into photo space
  const ox = ((b.left + b.width / 2) - r.left) / r.width * SIZE * CROP;
  const oy = ((b.top + b.height / 2) - r.top) / r.height * SIZE * CROP;
  beginDye(cur, index, ox, oy);
  anim = { type: 'tween', t0: performance.now(), dur: 220 };
  invalidate();
}
COLORS.forEach((c, i) => {
  const b = document.createElement('button');
  b.className = 'sw'; b.style.setProperty('--c', c.hex); b.setAttribute('aria-label', c.id + (c.id === 'ivory' ? ' (synthesized)' : ''));
  b.dataset.i = i;
  b.addEventListener('click', () => buttonDye(i, b));
  rail.appendChild(b);
});
function updateRail() {
  rail.querySelectorAll('.sw').forEach((b, i) => b.setAttribute('aria-pressed', i === cur ? 'true' : 'false'));
  document.documentElement.style.setProperty('--dye', COLORS[cur].hex);
}
for (const k of Object.values(dbg)) k.addEventListener('change', invalidate);

// ---------------------------------------------------------------- sizing (DPR <= 2)
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = QA ? Number(qs.get('size') || SIZE) : stage.clientWidth;
  if (QA) { stage.style.width = cssW + 'px'; stage.style.borderRadius = '0'; }
  const px = QA ? cssW : Math.round(cssW * dpr);
  if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
  invalidate();
}
new ResizeObserver(resize).observe(stage);

// ---------------------------------------------------------------- QA hook
window.__dye = {
  ready: false,
  // render one deterministic frame; returns PNG data URL of the canvas
  frame({ from, to, ox, oy, p, debug }) {
    beginDye(COLORS.findIndex(c => c.id === from), COLORS.findIndex(c => c.id === to), ox, oy);
    dye.p = p;
    dbg.mask.checked = dbg.cells.checked = dbg.dist.checked = false;
    if (debug) dbg[debug].checked = true;
    draw();
    return canvas.toDataURL('image/png');
  },
  state: () => ({ cur, dye, anim: !!anim }),
  // programmatic start for screenshots: begin a drag-like progress without pointer events
  setProgress({ to, ox, oy, p }) {
    beginDye(cur, COLORS.findIndex(c => c.id === to), ox, oy); dye.p = p; invalidate();
  },
};

boot().then(() => {
  updateRail(); resize(); draw(); window.__dye.ready = true;
}).catch((e) => { stage.textContent = String(e); console.error(e); });
