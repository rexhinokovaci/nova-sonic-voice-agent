// Small dependency-free product tour: spotlight + popover, keyboard friendly.
// Auto-opens once per browser (localStorage is best-effort; private windows
// just see it every time).

export interface TourStep {
  target: string;
  title: string;
  body: string;
  /** Optional hook, e.g. switch to the tab the step talks about. */
  before?: () => void;
}

const STYLE = `
.tour-veil{position:fixed;inset:0;z-index:90;pointer-events:auto}
.tour-hole{position:fixed;z-index:91;border-radius:14px;box-shadow:0 0 0 9999px rgb(11 13 18 / .55);transition:all .25s ease;pointer-events:none}
.tour-card{position:fixed;z-index:92;width:min(340px,calc(100vw - 32px));background:#fff;color:#0b0d12;border-radius:16px;padding:18px 18px 14px;box-shadow:0 24px 60px -20px rgb(11 13 18 / .45);font:14.5px/1.5 Geist,Inter,system-ui,sans-serif;transition:top .25s ease,left .25s ease}
.tour-card .t-step{font:500 12px/1 'Geist Mono',ui-monospace,monospace;color:#0a7a55;margin-bottom:8px}
.tour-card h3{margin:0 0 6px;font-size:17px;letter-spacing:-.015em}
.tour-card p{margin:0 0 14px;color:#3d465a}
.tour-card .t-row{display:flex;align-items:center;gap:8px}
.tour-card .t-dots{display:flex;gap:4px;margin-right:auto}
.tour-card .t-dots i{width:6px;height:6px;border-radius:50%;background:#e6e6e1}
.tour-card .t-dots i.on{background:#0a7a55}
.tour-card button{font:600 13.5px/1 inherit;font-family:inherit;padding:9px 14px;border-radius:10px;border:0;cursor:pointer}
.tour-card .t-next{background:#0b0d12;color:#fff}
.tour-card .t-back{background:#f1f1ee;color:#3d465a}
.tour-card .t-skip{background:none;color:#6b7489;padding:9px 6px}
.tour-card button:focus-visible{outline:2px solid #0a7a55;outline-offset:2px}
@media (prefers-reduced-motion:reduce){.tour-hole,.tour-card{transition:none}}
`;

export function createTour(id: string, steps: TourStep[]) {
  const storageKey = `tour:${id}:done`;
  let index = 0;
  let root: HTMLDivElement | undefined;

  const seen = () => {
    try {
      return localStorage.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  };
  const markSeen = () => {
    try {
      localStorage.setItem(storageKey, '1');
    } catch {
      /* storage unavailable */
    }
  };

  function ensureStyle() {
    if (document.getElementById('tour-style')) return;
    const s = document.createElement('style');
    s.id = 'tour-style';
    s.textContent = STYLE;
    document.head.append(s);
  }

  function position() {
    if (!root) return;
    const step = steps[index]!;
    const el = document.querySelector<HTMLElement>(step.target);
    const hole = root.querySelector<HTMLDivElement>('.tour-hole')!;
    const card = root.querySelector<HTMLDivElement>('.tour-card')!;
    const pad = 8;
    const r = el?.getBoundingClientRect() ?? new DOMRect(innerWidth / 2, innerHeight / 2, 0, 0);
    Object.assign(hole.style, {
      top: `${r.top - pad}px`,
      left: `${r.left - pad}px`,
      width: `${r.width + pad * 2}px`,
      height: `${r.height + pad * 2}px`,
    });
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    if (r.height > innerHeight * 0.55) {
      // Tall target: dock the card so it doesn't sit on top of what it describes.
      Object.assign(card.style, {
        top: `${innerHeight - ch - 16}px`,
        left: `${innerWidth - cw - 16}px`,
      });
      return;
    }
    const below = r.bottom + 16 + ch < innerHeight;
    const top = below ? r.bottom + 16 : Math.max(16, r.top - ch - 16);
    const left = Math.min(Math.max(16, r.left), innerWidth - cw - 16);
    Object.assign(card.style, { top: `${top}px`, left: `${left}px` });
  }

  function render() {
    if (!root) return;
    const step = steps[index]!;
    step.before?.();
    const el = document.querySelector<HTMLElement>(step.target);
    const tall = (el?.getBoundingClientRect().height ?? 0) > innerHeight * 0.55;
    el?.scrollIntoView({ block: tall ? 'start' : 'center', behavior: 'instant' as ScrollBehavior });
    const card = root.querySelector<HTMLDivElement>('.tour-card')!;
    const last = index === steps.length - 1;
    card.innerHTML = `
      <div class="t-step">Step ${index + 1} of ${steps.length}</div>
      <h3 id="tour-title">${step.title}</h3>
      <p>${step.body}</p>
      <div class="t-row">
        <span class="t-dots">${steps.map((_, i) => `<i class="${i === index ? 'on' : ''}"></i>`).join('')}</span>
        ${last ? '' : '<button class="t-skip" type="button">Skip</button>'}
        ${index > 0 ? '<button class="t-back" type="button">Back</button>' : ''}
        <button class="t-next" type="button">${last ? 'Done' : 'Next'}</button>
      </div>`;
    card.querySelector<HTMLButtonElement>('.t-next')!.onclick = next;
    card.querySelector<HTMLButtonElement>('.t-back')?.addEventListener('click', back);
    card.querySelector<HTMLButtonElement>('.t-skip')?.addEventListener('click', close);
    requestAnimationFrame(position);
    card.querySelector<HTMLButtonElement>('.t-next')!.focus({ preventScroll: true });
  }

  function next() {
    if (index >= steps.length - 1) return close();
    index++;
    render();
  }
  function back() {
    if (index === 0) return;
    index--;
    render();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') back();
  }

  function open() {
    if (root) return;
    ensureStyle();
    index = 0;
    root = document.createElement('div');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'tour-title');
    root.innerHTML =
      '<div class="tour-veil"></div><div class="tour-hole"></div><div class="tour-card"></div>';
    root.querySelector('.tour-veil')!.addEventListener('click', close);
    document.body.append(root);
    addEventListener('keydown', onKey);
    addEventListener('resize', position);
    addEventListener('scroll', position, true);
    render();
  }

  function close() {
    markSeen();
    root?.remove();
    root = undefined;
    removeEventListener('keydown', onKey);
    removeEventListener('resize', position);
    removeEventListener('scroll', position, true);
  }

  return {
    open,
    close,
    /** Opens on the first visit only. */
    autoStart(delayMs = 600) {
      if (!seen()) setTimeout(open, delayMs);
    },
  };
}
