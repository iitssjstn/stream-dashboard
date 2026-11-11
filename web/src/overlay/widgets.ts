import { ensureFont, isVideo } from './renderer';

export type WidgetType = 'text' | 'image' | 'latest' | 'rotator' | 'goal' | 'countdown';
export type WidgetView = { id: number; type: WidgetType; x: number; y: number; scale: number; z: number; config: Record<string, any> };
export type WidgetData = { latest: Record<string, { user: string; amount: number } | null>; goals: Record<number, number> };

const node = (tag: string, cls: string) => {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
};

/** Fills {user} and {amount}; values are inserted as text nodes, never as HTML. */
function fill(target: HTMLElement, template: string, vars: Record<string, string>, accent: string) {
  target.replaceChildren();
  for (const part of template.split(/(\{user\}|\{amount\})/gi)) {
    const key = part.toLowerCase().slice(1, -1);
    if (part.startsWith('{') && key in vars) {
      const span = node('span', 'lm-w-value');
      span.style.color = accent;
      span.textContent = vars[key];
      target.append(span);
    } else if (part) target.append(part);
  }
}

function styled(el: HTMLElement, c: Record<string, any>) {
  ensureFont(c.fontFamily);
  el.style.fontFamily = `'${c.fontFamily}', 'Fredoka', system-ui, sans-serif`;
  el.style.fontSize = `${c.fontSize}px`;
  el.style.color = c.color;
  el.style.setProperty('--accent', c.accentColor);
  el.classList.toggle('lm-w-shadow', Boolean(c.shadow));
  el.classList.add(`lm-w-bg-${c.background ?? 'none'}`);
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(s % 60).padStart(2, '0')}`;
};

type Entry = { el: HTMLElement; sig: string; tick?: () => void };

/**
 * Draws the always-visible widgets underneath the alerts. Used by the OBS overlay and by the
 * editor, so both look exactly the same. Only widgets whose content changed are rebuilt.
 */
export class WidgetLayer {
  readonly root: HTMLElement;
  private entries = new Map<number, Entry>();
  private timer: number;

  constructor(stage: HTMLElement) {
    this.root = node('div', 'lm-widgets');
    stage.prepend(this.root);
    this.timer = window.setInterval(() => this.entries.forEach((e) => e.tick?.()), 500);
  }

  update(widgets: WidgetView[], data: WidgetData) {
    const seen = new Set<number>();
    for (const w of widgets) {
      seen.add(w.id);
      const sig = JSON.stringify([w.type, w.config, w.type === 'goal' ? data.goals[w.id] : w.type === 'latest' || w.type === 'rotator' ? data.latest : null]);
      let entry = this.entries.get(w.id);
      if (!entry || entry.sig !== sig) {
        const built = this.build(w, data);
        built.el.dataset.wid = String(w.id);
        if (entry) entry.el.replaceWith(built.el);
        else this.root.append(built.el);
        entry = { ...built, sig };
        this.entries.set(w.id, entry);
      }
      entry.el.style.left = `${w.x}%`;
      entry.el.style.top = `${w.y}%`;
      entry.el.style.zIndex = String(w.z);
      entry.el.style.setProperty('--scale', String(w.scale));
    }
    for (const [id, entry] of this.entries) {
      if (seen.has(id)) continue;
      entry.el.remove();
      this.entries.delete(id);
    }
  }

  destroy() {
    clearInterval(this.timer);
    this.root.remove();
    this.entries.clear();
  }

  private build(w: WidgetView, data: WidgetData): { el: HTMLElement; tick?: () => void } {
    const c = w.config;
    const el = node('div', `lm-widget lm-w-${w.type}`);
    const vars = (event: string) => {
      const last = data.latest[event];
      return { user: last?.user ?? '—', amount: String(last?.amount ?? 0) };
    };
    switch (w.type) {
      case 'image': {
        const src = String(c.url ?? '');
        if (!src) {
          // Only seen in the editor, before an image was chosen.
          el.classList.add('lm-w-empty');
          el.textContent = '🖼';
          return { el };
        }
        const m = isVideo(src) ? Object.assign(document.createElement('video'), { src, autoplay: true, loop: true, muted: true, playsInline: true }) : Object.assign(document.createElement('img'), { src, alt: '' });
        m.style.width = `${c.width}px`;
        el.append(m);
        return { el };
      }
      case 'text':
        styled(el, c);
        el.textContent = c.text;
        return { el };
      case 'latest':
        styled(el, c);
        if (!data.latest[c.event] && c.empty) el.textContent = c.empty;
        else fill(el, c.template, vars(c.event), c.accentColor);
        return { el };
      case 'rotator': {
        styled(el, c);
        const events: string[] = c.events ?? [];
        let shown = -1;
        const tick = () => {
          const i = Math.floor(Date.now() / (c.intervalSec * 1000)) % Math.max(1, events.length);
          if (i === shown) return;
          shown = i;
          const line = node('div', 'lm-w-line');
          fill(line, c.templates?.[events[i]] ?? '', vars(events[i]), c.accentColor);
          el.replaceChildren(line);
        };
        tick();
        return { el, tick };
      }
      case 'goal': {
        styled(el, c);
        el.style.width = `${c.width}px`;
        const value = data.goals[w.id] ?? c.start ?? 0;
        const head = node('div', 'lm-w-goal-head');
        const title = node('span', 'lm-w-goal-title');
        title.textContent = c.title;
        const count = node('span', 'lm-w-goal-count');
        count.textContent = `${value} / ${c.target}`;
        head.append(title, count);
        const bar = node('div', 'lm-w-goal-bar');
        const fillEl = node('i', '');
        fillEl.style.width = `${Math.min(100, Math.max(0, (value / c.target) * 100))}%`;
        fillEl.style.background = `linear-gradient(90deg, ${c.barColor}, color-mix(in srgb, ${c.barColor} 60%, #fff))`;
        bar.append(fillEl);
        el.append(head, bar);
        return { el };
      }
      case 'countdown': {
        styled(el, c);
        const label = node('div', 'lm-w-count-label');
        label.textContent = c.label;
        const time = node('div', 'lm-w-count-time');
        if (c.label) el.append(label);
        el.append(time);
        const tick = () => {
          const left = c.endsAt ? c.endsAt - Date.now() : c.seconds * 1000;
          const text = left <= 0 && c.endText ? c.endText : clock(left);
          if (time.textContent !== text) time.textContent = text;
        };
        tick();
        return { el, tick };
      }
    }
  }
}
