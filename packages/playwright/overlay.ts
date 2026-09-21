/**
 * Injected visual feedback overlay for Playwright controlled pages.
 * Runs in-browser: exposes window.__kevinOverlay = { highlight, toast, candidates, clearCandidates }.
 * Controlled scope boundary: isolates DOM manipulation inside the browser page.
 */

export function installOverlay(): void {
  const win = window as any;
  if (win.__kevinOverlay) return;

  const Z = 2147483000;
  const css = `
    .__kevin-toast {
      position: fixed;
      left: 50%;
      bottom: 28px;
      transform: translateX(-50%);
      background: #0f172a;
      color: #f8fafc;
      font: 600 14px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 10px 18px;
      border-radius: 9999px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
      z-index: ${Z};
      opacity: 0;
      transition: opacity 0.18s cubic-bezier(0.16, 1, 0.3, 1), transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
      pointer-events: none;
      max-width: 75vw;
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
    }
    .__kevin-toast.__kevin-show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    .__kevin-hl {
      position: absolute;
      border: 3px solid #f59e0b;
      border-radius: 6px;
      box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.25), 0 0 24px rgba(245, 158, 11, 0.6);
      z-index: ${Z};
      pointer-events: none;
      transition: opacity 0.3s ease-out;
    }
    .__kevin-badge {
      position: absolute;
      background: #2563eb;
      color: #ffffff;
      font: 700 13px/1 -apple-system, BlinkMacSystemFont, sans-serif;
      padding: 5px 8px;
      border-radius: 999px;
      z-index: ${Z};
      pointer-events: none;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
      border: 2px solid #ffffff;
    }
    .__kevin-cand {
      position: absolute;
      border: 2px dashed #2563eb;
      border-radius: 6px;
      z-index: ${Z};
      pointer-events: none;
      background: rgba(37, 99, 235, 0.08);
    }
  `;

  const ensureStyle = () => {
    if (document.getElementById('__kevin-overlay-style')) return;
    const s = document.createElement('style');
    s.id = '__kevin-overlay-style';
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  };

  const byId = (id: string): HTMLElement | null => {
    return (
      document.querySelector(`[data-kevin-id="${id}"]`) ||
      document.querySelector(`[data-chromodevin-id="${id}"]`) ||
      document.querySelector(`[data-vb-id="${id}"]`) ||
      document.getElementById(id)
    );
  };

  const box = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return {
      top: r.top + window.scrollY,
      left: r.left + window.scrollX,
      width: r.width,
      height: r.height
    };
  };

  let toastEl: HTMLElement | null = null;
  let toastTimer: any = null;
  let candTimer: any = null;

  win.__kevinOverlay = {
    toast(msg: string, ms = 1800) {
      ensureStyle();
      if (!toastEl || !toastEl.isConnected) {
        toastEl = document.createElement('div');
        toastEl.className = '__kevin-toast';
        document.documentElement.appendChild(toastEl);
      }
      toastEl.textContent = msg;
      requestAnimationFrame(() => toastEl?.classList.add('__kevin-show'));
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl && toastEl.classList.remove('__kevin-show'), ms);
    },

    highlight(id: string, ms = 600): boolean {
      ensureStyle();
      const el = byId(id);
      if (!el) return false;
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const b = box(el);
      const h = document.createElement('div');
      h.className = '__kevin-hl';
      Object.assign(h.style, {
        top: `${b.top - 4}px`,
        left: `${b.left - 4}px`,
        width: `${b.width + 8}px`,
        height: `${b.height + 8}px`
      });
      document.documentElement.appendChild(h);
      setTimeout(() => (h.style.opacity = '0'), ms);
      setTimeout(() => h.remove(), ms + 350);
      return true;
    },

    candidates(list: Array<{ id: string; n: number; label?: string }>, ms = 8000) {
      ensureStyle();
      win.__kevinOverlay.clearCandidates();
      let first = true;
      for (const c of list) {
        const el = byId(c.id);
        if (!el) continue;
        if (first) {
          el.scrollIntoView({ block: 'center' });
          first = false;
        }
        const b = box(el);
        const frame = document.createElement('div');
        frame.className = '__kevin-cand __kevin-c';
        Object.assign(frame.style, {
          top: `${b.top - 3}px`,
          left: `${b.left - 3}px`,
          width: `${b.width + 6}px`,
          height: `${b.height + 6}px`
        });

        const badge = document.createElement('div');
        badge.className = '__kevin-badge __kevin-c';
        badge.textContent = String(c.n);
        Object.assign(badge.style, {
          top: `${Math.max(0, b.top - 14)}px`,
          left: `${Math.max(0, b.left - 14)}px`
        });

        document.documentElement.appendChild(frame);
        document.documentElement.appendChild(badge);
      }
      candTimer = setTimeout(win.__kevinOverlay.clearCandidates, ms);
    },

    clearCandidates() {
      clearTimeout(candTimer);
      document.querySelectorAll('.__kevin-c').forEach((n) => n.remove());
    }
  };
}
