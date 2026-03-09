import './style.css';

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

interface NodePosition {
  x: number;
  y: number;
  baseX: number;
  baseY: number;
}

let mouseX = 0;
let mouseY = 0;
let nodePositions: Map<string, NodePosition> = new Map();
let activeNode: string | null = null;
let hoveredNode: string | null = null;

async function loadProjects(): Promise<ProjectData> {
  const res = await fetch('/data/projects.json');
  return res.json();
}

function calculateNodePositions(nodes: ProjectNode[], container: HTMLElement): void {
  const rect = container.getBoundingClientRect();
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  const radius = Math.min(rect.width, rect.height) * 0.28;

  nodes.forEach((node, i) => {
    const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
    const variance = 0.15;
    const r = radius * (1 + (Math.random() - 0.5) * variance);

    const x = centerX + Math.cos(angle) * r;
    const y = centerY + Math.sin(angle) * r;

    nodePositions.set(node.id, { x, y, baseX: x, baseY: y });
  });
}

function applyParallax(): void {
  const parallaxStrength = 0.02;

  nodePositions.forEach((pos) => {
    const dx = (mouseX - window.innerWidth / 2) * parallaxStrength;
    const dy = (mouseY - window.innerHeight / 2) * parallaxStrength;
    pos.x = pos.baseX + dx;
    pos.y = pos.baseY + dy;
  });
}

function getAIColor(ai: string): string {
  switch (ai.toLowerCase()) {
    case 'claude': return '#d4a574';
    case 'gpt-4o':
    case 'openai': return '#10a37f';
    default: return '#a78bfa';
  }
}

function render(data: ProjectData): void {
  const app = document.querySelector<HTMLDivElement>('#app')!;

  app.innerHTML = `
    <div class="constellation">
      <svg class="constellation-lines"></svg>
      <div class="constellation-nodes"></div>
      <div class="center-identity">
        <span class="identity-name">${data.identity}</span>
        <span class="identity-tagline">${data.tagline}</span>
      </div>
      <div class="project-detail"></div>
    </div>
  `;

  const container = app.querySelector<HTMLDivElement>('.constellation')!;
  const svg = container.querySelector<SVGElement>('.constellation-lines')!;
  const nodesContainer = container.querySelector<HTMLDivElement>('.constellation-nodes')!;
  const detailPanel = container.querySelector<HTMLDivElement>('.project-detail')!;

  // Calculate initial positions
  calculateNodePositions(data.nodes, container);

  // Create node elements
  data.nodes.forEach((node) => {
    const nodeEl = document.createElement('div');
    nodeEl.className = `node node-${node.status}`;
    nodeEl.dataset.id = node.id;
    nodeEl.innerHTML = `
      <div class="node-glow"></div>
      <div class="node-core">
        <span class="node-ai" style="--ai-color: ${getAIColor(node.ai)}">${node.ai}</span>
      </div>
      <div class="node-label">${node.title}</div>
    `;
    nodesContainer.appendChild(nodeEl);
  });

  function updatePositions(): void {
    applyParallax();

    // Update node positions
    data.nodes.forEach((node) => {
      const pos = nodePositions.get(node.id)!;
      const nodeEl = nodesContainer.querySelector(`[data-id="${node.id}"]`) as HTMLElement;
      if (nodeEl) {
        nodeEl.style.transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%)`;
      }
    });

    // Update connection lines
    const lines: string[] = [];
    data.nodes.forEach((node) => {
      if (node.connections) {
        const fromPos = nodePositions.get(node.id)!;
        node.connections.forEach((targetId) => {
          const toPos = nodePositions.get(targetId);
          if (toPos) {
            const isHighlighted = hoveredNode === node.id || hoveredNode === targetId;
            const opacity = hoveredNode ? (isHighlighted ? 0.6 : 0.1) : 0.25;
            lines.push(`
              <line
                x1="${fromPos.x}" y1="${fromPos.y}"
                x2="${toPos.x}" y2="${toPos.y}"
                class="connection-line ${isHighlighted ? 'highlighted' : ''}"
                style="opacity: ${opacity}"
              />
            `);
          }
        });
      }
    });
    svg.innerHTML = lines.join('');
  }

  function showDetail(node: ProjectNode): void {
    activeNode = node.id;
    detailPanel.innerHTML = `
      <div class="detail-card">
        <button class="detail-close">&times;</button>
        <div class="detail-header">
          <h2 class="detail-title">${node.title}</h2>
          <span class="detail-status status-${node.status}">${node.status}</span>
        </div>
        <p class="detail-desc">${node.description}</p>
        <div class="detail-meta">
          <div class="detail-row">
            <span class="detail-label">built with</span>
            <span class="detail-value ai-badge" style="--ai-color: ${getAIColor(node.ai)}">${node.ai}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">tech</span>
            <span class="detail-value">${node.tech.join(', ')}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">date</span>
            <span class="detail-value">${node.date}</span>
          </div>
          ${node.url ? `
          <div class="detail-row">
            <span class="detail-label">link</span>
            <a class="detail-link" href="${node.url}" target="_blank">${node.url.replace('https://', '')}</a>
          </div>
          ` : ''}
        </div>
      </div>
    `;
    detailPanel.classList.add('active');

    // Spawn particles from the clicked node
    const nodeEl = nodesContainer.querySelector(`[data-id="${node.id}"]`) as HTMLElement;
    if (nodeEl) {
      spawnParticles(nodeEl);
    }

    detailPanel.querySelector('.detail-close')?.addEventListener('click', hideDetail);
  }

  function hideDetail(): void {
    activeNode = null;
    detailPanel.classList.remove('active');
  }

  function spawnParticles(nodeEl: HTMLElement): void {
    const rect = nodeEl.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const count = 12;

    for (let i = 0; i < count; i++) {
      const particle = document.createElement('span');
      particle.className = 'particle';

      const angle = (i / count) * Math.PI * 2;
      const distance = 50 + Math.random() * 40;
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance;
      const size = 2 + Math.random() * 3;
      const duration = 0.6 + Math.random() * 0.3;

      particle.style.cssText = `
        left: ${rect.left - containerRect.left + rect.width / 2}px;
        top: ${rect.top - containerRect.top + rect.height / 2}px;
        width: ${size}px;
        height: ${size}px;
        --dx: ${dx}px;
        --dy: ${dy}px;
        animation-duration: ${duration}s;
      `;

      container.appendChild(particle);
      particle.addEventListener('animationend', () => particle.remove());
    }
  }

  // Event listeners
  nodesContainer.querySelectorAll('.node').forEach((nodeEl) => {
    const id = (nodeEl as HTMLElement).dataset.id!;
    const node = data.nodes.find(n => n.id === id)!;

    nodeEl.addEventListener('mouseenter', () => {
      hoveredNode = id;
      nodeEl.classList.add('hovered');
      updatePositions();
    });

    nodeEl.addEventListener('mouseleave', () => {
      hoveredNode = null;
      nodeEl.classList.remove('hovered');
      updatePositions();
    });

    nodeEl.addEventListener('click', () => {
      showDetail(node);
    });
  });

  // Click outside to close detail
  container.addEventListener('click', (e) => {
    if (activeNode && !(e.target as HTMLElement).closest('.node') && !(e.target as HTMLElement).closest('.detail-card')) {
      hideDetail();
    }
  });

  // Mouse move for parallax
  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    updatePositions();
  });

  // Handle resize
  window.addEventListener('resize', () => {
    calculateNodePositions(data.nodes, container);
    updatePositions();
  });

  // Initial render
  updatePositions();
}

loadProjects().then(render);
