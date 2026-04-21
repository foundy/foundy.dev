import './style.css';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProjectNode {
  id: string;
  title: string;
  description: string;
  tech: string[];
  ai: string;
  status: 'live' | 'experiment' | 'building';
  url?: string;
  connections?: string[];
  date: string;
}

interface ProjectData {
  identity: string;
  tagline: string;
  nodes: ProjectNode[];
}

interface Phys {
  x: number; y: number;
  baseX: number; baseY: number;
  vx: number; vy: number;
  phaseX: number; phaseY: number;
  freqX: number; freqY: number;
}

interface Signal {
  key: number;
  fromId: string; toId: string;
  t: number; speed: number;
  color: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SPRING_K = 0.085;
const DAMPING = 0.74;
const PUSH = 380;
const FLOAT = { x: 6, y: 11 };
const SIG_INTERVAL = 2400;

// Organic brain positions [rx, ry] — desktop / mobile
const POS_D = [[0.21,0.26],[0.77,0.21],[0.75,0.70],[0.23,0.72],[0.50,0.46]];
const POS_M = [[0.20,0.17],[0.78,0.20],[0.74,0.50],[0.24,0.53],[0.50,0.34]];

// ── Helpers ───────────────────────────────────────────────────────────────────

let _key = 0;

const AI_COLOR: Record<string, string> = {
  claude:  '#e8a07a',
  openai:  '#10d9a0',
  gemini:  '#4fa3f7',
  chatgpt: '#74c8b8',
};
const AI_GLOW: Record<string, string> = {
  claude:  'rgba(232,160,122,0.55)',
  openai:  'rgba(16,217,160,0.55)',
  gemini:  'rgba(79,163,247,0.55)',
  chatgpt: 'rgba(116,200,184,0.55)',
};
const col  = (ai: string) => AI_COLOR[ai.toLowerCase()] ?? '#b39dfa';
const glow = (ai: string) => AI_GLOW[ai.toLowerCase()]  ?? 'rgba(179,157,250,0.55)';

function bez(t: number, x1: number, y1: number, cx: number, cy: number, x2: number, y2: number) {
  const u = 1 - t;
  return { x: u*u*x1 + 2*u*t*cx + t*t*x2, y: u*u*y1 + 2*u*t*cy + t*t*y2 };
}

function cp(x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1+x2)/2, my = (y1+y2)/2;
  return { cx: mx - (y2-y1)*0.28, cy: my + (x2-x1)*0.28 };
}

// ── State ─────────────────────────────────────────────────────────────────────

let physMap = new Map<string, Phys>();
let signals: Signal[] = [];
let nodeList: ProjectNode[] = [];
let edges: { from: string; to: string }[] = [];
let hovered: string | null = null;
let sigClock = 0;

// ── Physics ───────────────────────────────────────────────────────────────────

function initPhys(nodes: ProjectNode[], w: number, h: number) {
  const pos = w < 600 ? POS_M : POS_D;
  physMap.clear();
  nodes.forEach((n, i) => {
    const [rx, ry] = pos[i] ?? [0.5, 0.5];
    const bx = rx * w, by = ry * h;
    physMap.set(n.id, {
      x: bx, y: by, baseX: bx, baseY: by,
      vx: 0, vy: 0,
      phaseX: Math.random() * Math.PI * 2,
      phaseY: Math.random() * Math.PI * 2,
      freqX: 3.5e-4 + Math.random() * 3e-4,
      freqY: 4.5e-4 + Math.random() * 3e-4,
    });
  });
}

function buildEdges(nodes: ProjectNode[]) {
  edges = [];
  nodes.forEach(n => n.connections?.forEach(tid => {
    if (!edges.find(e => (e.from===n.id&&e.to===tid)||(e.from===tid&&e.to===n.id)))
      edges.push({ from: n.id, to: tid });
  }));
}

// ── Frame ─────────────────────────────────────────────────────────────────────

function frame(svg: SVGSVGElement, nodesCont: HTMLElement, t: number, dt: number) {
  // Physics
  physMap.forEach(p => {
    const fx = Math.sin(t * p.freqX + p.phaseX) * FLOAT.x;
    const fy = Math.sin(t * p.freqY + p.phaseY) * FLOAT.y;
    p.vx += (p.baseX + fx - p.x) * SPRING_K;
    p.vy += (p.baseY + fy - p.y) * SPRING_K;
    p.vx *= DAMPING; p.vy *= DAMPING;
    p.x  += p.vx;    p.y  += p.vy;
  });

  // Ambient signals
  sigClock += dt;
  if (sigClock > SIG_INTERVAL && edges.length) {
    sigClock = 0;
    const e = edges[Math.floor(Math.random() * edges.length)];
    const n = nodeList.find(n => n.id === e.from);
    if (n) signals.push({ key: _key++, fromId: e.from, toId: e.to, t: 0, speed: .007 + Math.random()*.005, color: col(n.ai) });
  }
  signals = signals.filter(s => { s.t += s.speed; return s.t < 1.1; });

  // Build SVG
  const grads: string[] = [];
  const paths: string[] = [];
  const dots: string[] = [];

  edges.forEach((e, i) => {
    const a = physMap.get(e.from), b = physMap.get(e.to);
    if (!a || !b) return;
    const { cx, cy } = cp(a.x, a.y, b.x, b.y);
    const hot = hovered === e.from || hovered === e.to;
    const op  = hovered ? (hot ? 0.75 : 0.06) : 0.22;
    const sw  = hot ? 1.8 : 0.8;
    const na  = nodeList.find(n => n.id === e.from);
    const nb  = nodeList.find(n => n.id === e.to);
    const gid = `eg${i}`;
    grads.push(
      `<linearGradient id="${gid}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" gradientUnits="userSpaceOnUse">` +
      `<stop offset="0%" stop-color="${na ? col(na.ai) : '#a78bfa'}"/>` +
      `<stop offset="100%" stop-color="${nb ? col(nb.ai) : '#a78bfa'}"/></linearGradient>`
    );
    paths.push(
      `<path d="M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}" ` +
      `stroke="url(#${gid})" stroke-width="${sw}" fill="none" opacity="${op}"/>`
    );
  });

  signals.forEach(s => {
    const a = physMap.get(s.fromId), b = physMap.get(s.toId);
    if (!a || !b) return;
    const { cx, cy } = cp(a.x, a.y, b.x, b.y);
    const p0 = bez(Math.min(s.t, 1), a.x, a.y, cx, cy, b.x, b.y);
    const fade = 1 - s.t * 0.6;
    dots.push(`<circle cx="${p0.x}" cy="${p0.y}" r="4" fill="${s.color}" opacity="${0.95*fade}" filter="url(#sf)"/>`);
    if (s.t > 0.07) {
      const p1 = bez(Math.max(s.t-.07,0), a.x, a.y, cx, cy, b.x, b.y);
      dots.push(`<circle cx="${p1.x}" cy="${p1.y}" r="2.5" fill="${s.color}" opacity="${0.45*fade}"/>`);
    }
    if (s.t > 0.14) {
      const p2 = bez(Math.max(s.t-.14,0), a.x, a.y, cx, cy, b.x, b.y);
      dots.push(`<circle cx="${p2.x}" cy="${p2.y}" r="1.5" fill="${s.color}" opacity="${0.2*fade}"/>`);
    }
  });

  svg.innerHTML =
    `<defs><filter id="sf"><feGaussianBlur stdDeviation="3.5"/></filter>${grads.join('')}</defs>` +
    paths.join('') + dots.join('');

  // Node positions
  physMap.forEach((p, id) => {
    const el = nodesCont.querySelector<HTMLElement>(`[data-id="${id}"]`);
    if (el) el.style.transform = `translate(${p.x}px,${p.y}px) translate(-50%,-50%)`;
  });
}

// ── Interaction ───────────────────────────────────────────────────────────────

function pushNode(id: string, tx: number, ty: number) {
  const p = physMap.get(id);
  if (!p) return;
  const dx = p.x - tx, dy = p.y - ty;
  const d  = Math.sqrt(dx*dx + dy*dy) || 1;
  p.vx += (dx/d) * PUSH;
  p.vy += (dy/d) * PUSH;
}

function burstSignals(id: string) {
  const n = nodeList.find(n => n.id === id);
  if (!n) return;
  edges.forEach(e => {
    if (e.from === id || e.to === id) {
      const other = e.from === id ? e.to : e.from;
      signals.push({ key: _key++, fromId: id, toId: other, t: 0, speed: .016, color: col(n.ai) });
      signals.push({ key: _key++, fromId: id, toId: other, t: 0, speed: .018, color: '#ffffff' });
    }
  });
}

function spawnParticles(container: HTMLElement, x: number, y: number, c: string) {
  const count = 24;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    p.className = 'particle';
    const angle = (i/count)*Math.PI*2 + Math.random()*.4;
    const dist  = 55 + Math.random()*70;
    const size  = 2 + Math.random()*4;
    const dur   = .45 + Math.random()*.4;
    const isWhite = i % 4 === 0;
    p.style.cssText =
      `left:${x}px;top:${y}px;` +
      `width:${size}px;height:${size}px;` +
      `background:${isWhite ? '#ffffff' : c};` +
      `--dx:${Math.cos(angle)*dist}px;--dy:${Math.sin(angle)*dist}px;` +
      `animation-duration:${dur}s`;
    container.appendChild(p);
    p.addEventListener('animationend', () => p.remove());
  }
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

function showDetail(panel: HTMLElement, node: ProjectNode) {
  const c = col(node.ai), g = glow(node.ai);
  panel.innerHTML = `
    <div class="sheet" style="--ac:${c};--ag:${g}">
      <div class="sheet-handle"></div>
      <button class="sheet-close">✕</button>
      <div class="sheet-badge">${node.ai}</div>
      <div class="sheet-head">
        <h2 class="sheet-title">${node.title}</h2>
        <span class="sheet-status s-${node.status}">${node.status}</span>
      </div>
      <p class="sheet-desc">${node.description}</p>
      <div class="sheet-tags">${node.tech.map(t=>`<span class="tag">${t}</span>`).join('')}</div>
      <div class="sheet-foot">
        <span class="sheet-date">${node.date}</span>
        ${node.url ? `<a class="sheet-link" href="${node.url}" target="_blank">↗ visit</a>` : ''}
      </div>
    </div>
  `;
  panel.classList.add('active');
  panel.querySelector('.sheet-close')?.addEventListener('click', () => {
    panel.classList.remove('active');
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function main() {
  const data: ProjectData = await fetch('/data/projects.json').then(r => r.json());
  nodeList = data.nodes;
  buildEdges(data.nodes);

  const app = document.querySelector<HTMLDivElement>('#app')!;
  app.innerHTML = `
    <div class="scene">
      <div class="bg-dots"></div>
      <div class="bg-aura"></div>
      <svg class="scene-svg" width="100%" height="100%"></svg>
      <div class="scene-nodes"></div>
      <div class="scene-center">
        <span class="c-name">${data.identity}</span>
        <span class="c-tag">${data.tagline}</span>
      </div>
      <div class="detail-panel"></div>
    </div>
  `;

  const scene      = app.querySelector<HTMLDivElement>('.scene')!;
  const svg        = app.querySelector<SVGSVGElement>('.scene-svg')!;
  const nodesCont  = app.querySelector<HTMLDivElement>('.scene-nodes')!;
  const panel      = app.querySelector<HTMLDivElement>('.detail-panel')!;

  const rect = scene.getBoundingClientRect();
  initPhys(data.nodes, rect.width, rect.height);

  data.nodes.forEach(node => {
    const el = document.createElement('div');
    el.className = `node-orb s-${node.status}`;
    el.dataset.id = node.id;
    const c = col(node.ai), g = glow(node.ai);
    el.style.setProperty('--ac', c);
    el.style.setProperty('--ag', g);
    el.innerHTML = `
      <div class="orb-aura"></div>
      <div class="orb-ring"></div>
      <div class="orb-core"></div>
      <div class="orb-label">${node.title}</div>
      <div class="orb-ai">${node.ai}</div>
    `;
    nodesCont.appendChild(el);

    el.addEventListener('mouseenter', () => { hovered = node.id; el.classList.add('hot'); });
    el.addEventListener('mouseleave', () => { hovered = null; el.classList.remove('hot'); });

    const interact = (tx: number, ty: number) => {
      const p = physMap.get(node.id)!;
      pushNode(node.id, tx, ty);
      burstSignals(node.id);
      spawnParticles(scene, p.x, p.y, col(node.ai));
      showDetail(panel, node);
    };

    el.addEventListener('click', e => {
      const r = scene.getBoundingClientRect();
      interact(e.clientX - r.left, e.clientY - r.top);
    });
    el.addEventListener('touchstart', e => {
      e.preventDefault();
      const r = scene.getBoundingClientRect();
      interact(e.touches[0].clientX - r.left, e.touches[0].clientY - r.top);
    }, { passive: false });
  });

  panel.addEventListener('click', e => {
    if (e.target === panel) panel.classList.remove('active');
  });

  window.addEventListener('resize', () => {
    const { width, height } = scene.getBoundingClientRect();
    initPhys(data.nodes, width, height);
  });

  let prev = 0;
  (function loop(ts: number) {
    frame(svg, nodesCont, ts, ts - prev);
    prev = ts;
    requestAnimationFrame(loop);
  })(0);
}

main();
