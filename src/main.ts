import './style.css';

interface Status {
  identity: string;
  focus: string;
  experiment: string;
  updatedAt: string;
}

async function loadStatus(): Promise<Status> {
  const res = await fetch('/data/status.json');
  return res.json();
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function spawnParticles(card: HTMLElement): void {
  const rect = card.getBoundingClientRect();
  const count = 10 + Math.floor(Math.random() * 5); // 10–15 particles

  for (let i = 0; i < count; i++) {
    const particle = document.createElement('span');
    particle.className = 'particle';

    // Pick a random point along the card perimeter
    const side = Math.floor(Math.random() * 4);
    let x: number, y: number;
    switch (side) {
      case 0: x = Math.random() * rect.width; y = 0; break;            // top
      case 1: x = Math.random() * rect.width; y = rect.height; break;  // bottom
      case 2: x = 0; y = Math.random() * rect.height; break;           // left
      default: x = rect.width; y = Math.random() * rect.height; break; // right
    }

    // Random outward direction
    const angle = Math.atan2(y - rect.height / 2, x - rect.width / 2) + (Math.random() - 0.5) * 0.8;
    const distance = 40 + Math.random() * 60;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance;
    const size = 2 + Math.random() * 2.5;
    const duration = 0.5 + Math.random() * 0.4;
    const delay = Math.random() * 0.1;

    particle.style.cssText = `
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      --dx: ${dx}px;
      --dy: ${dy}px;
      animation-duration: ${duration}s;
      animation-delay: ${delay}s;
    `;

    card.appendChild(particle);
    particle.addEventListener('animationend', () => particle.remove());
  }
}

function render(status: Status): void {
  const app = document.querySelector<HTMLDivElement>('#app')!;

  app.innerHTML = `
    <div class="card">
      <p class="statement">I build systems.\nNow I build with AI.</p>
      <div class="status-line">
        <span class="status-dot"></span>
        <span>status: experimenting</span>
      </div>
      <div class="detail">
        <div class="detail-inner">
          <div class="detail-divider"></div>
          <div class="detail-row">
            <span class="detail-label">origin</span>
            <span class="detail-value">${status.identity}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">focus</span>
            <span class="detail-value">${status.focus}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">experiment</span>
            <span class="detail-value">${status.experiment}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">updated</span>
            <span class="detail-value">${formatDate(status.updatedAt)}</span>
          </div>
        </div>
      </div>
    </div>
  `;

  const card = app.querySelector<HTMLDivElement>('.card')!;
  const isTouchDevice = window.matchMedia('(hover: none)').matches;

  if (isTouchDevice) {
    card.addEventListener('click', () => {
      const willExpand = !card.classList.contains('expanded');
      card.classList.toggle('expanded');
      if (willExpand) {
        spawnParticles(card);
      }
    });
  } else {
    card.addEventListener('mouseenter', () => spawnParticles(card));
  }
}

loadStatus().then(render);
