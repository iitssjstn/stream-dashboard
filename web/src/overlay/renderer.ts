import { figure, HEART_PATH, STAR_PATH, SPARKLE_PATH, shape, type CharacterStyle } from './characters';
import type { OverlayEvent } from './types';
import './overlay.css';

const ENTER_MS = 650;
const EXIT_MS = 550;
const loadedFonts = new Set<string>();
const SYSTEM_FONTS = new Set(['Arial', 'Verdana', 'Georgia', 'Impact', 'Trebuchet MS', 'system-ui']);

/** Loads a Google Font on demand; overlays only download fonts that are actually used. */
export function ensureFont(family: string) {
  if (!family || SYSTEM_FONTS.has(family) || loadedFonts.has(family)) return;
  loadedFonts.add(family);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;600;700&display=swap`;
  document.head.appendChild(link);
}

function el(tag: string, cls: string, html = '') {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html; // only ever static SVG markup, never user input
  return e;
}

function scene(animation: string, accent: string, style: CharacterStyle = 'anime'): HTMLElement {
  const s = el('div', `lm-scene lm-scene-${animation} lm-style-${style}`);
  const A = figure(style, 0);
  const B = figure(style, 1);
  const heart = shape(HEART_PATH, accent, 'lm-big-heart');
  switch (animation) {
    case 'hug': {
      const a = el('div', 'lm-actor lm-actor-a', `<div class="lm-bob">${A}</div>`);
      const b = el('div', 'lm-actor lm-actor-b', `<div class="lm-bob"><div class="lm-mirror">${B}</div></div>`);
      s.append(a, b, el('div', 'lm-pop-icon', heart));
      break;
    }
    case 'highfive': {
      const a = el('div', 'lm-actor lm-actor-a', `<div class="lm-bob">${B}</div>`);
      const b = el('div', 'lm-actor lm-actor-b', `<div class="lm-bob"><div class="lm-mirror">${A}</div></div>`);
      s.append(a, b, el('div', 'lm-clap', shape(STAR_PATH, '#fde047') + shape(SPARKLE_PATH, '#fff', 'lm-clap-spark')));
      break;
    }
    case 'love':
      s.append(el('div', 'lm-actor lm-actor-solo', `<div class="lm-bob">${A}</div>`), el('div', 'lm-held-heart', heart));
      break;
    case 'dance':
      s.append(
        el('div', 'lm-actor lm-actor-a', `<div class="lm-bob">${A}</div>`),
        el('div', 'lm-actor lm-actor-b', `<div class="lm-bob"><div class="lm-mirror">${B}</div></div>`),
      );
      break;
    case 'wave':
    default:
      s.append(el('div', 'lm-actor lm-actor-solo', `<div class="lm-bob">${B}</div>`));
  }
  return s;
}

function particles(kind: string, accent: string): HTMLElement | null {
  if (kind === 'none') return null;
  const wrap = el('div', 'lm-particles');
  const count = kind === 'confetti' ? 28 : 14;
  const palette = ['#a855f7', '#3b82f6', '#ec4899', '#facc15', '#22d3ee', accent];
  for (let i = 0; i < count; i++) {
    const color = kind === 'confetti' ? palette[i % palette.length] : kind === 'sparkles' ? (i % 2 ? '#fff' : accent) : accent;
    const p =
      kind === 'confetti'
        ? el('i', 'lm-p lm-p-confetti')
        : el('i', 'lm-p', shape(kind === 'hearts' ? HEART_PATH : kind === 'stars' ? STAR_PATH : SPARKLE_PATH, i % 3 === 0 ? '#fff' : color));
    if (kind === 'confetti') p.style.background = color;
    p.style.setProperty('--x', `${Math.round(Math.random() * 100)}%`);
    p.style.setProperty('--dx', `${Math.round(Math.random() * 120 - 60)}px`);
    p.style.setProperty('--s', (0.6 + Math.random() * 0.9).toFixed(2));
    p.style.setProperty('--r', `${Math.round(Math.random() * 720 - 360)}deg`);
    p.style.setProperty('--d', `${Math.round(Math.random() * 1600)}ms`);
    p.style.setProperty('--t', `${Math.round(1800 + Math.random() * 1600)}ms`);
    wrap.appendChild(p);
  }
  return wrap;
}

/** Text with the viewer's name highlighted. Uses text nodes only – chat input is never parsed as HTML. */
function textBlock(ev: OverlayEvent) {
  const st = ev.style;
  const t = el('div', `lm-text${st.textShadow ? ' lm-text-shadow' : ''}`);
  t.style.fontFamily = `'${st.fontFamily}', 'Fredoka', system-ui, sans-serif`;
  t.style.fontSize = `${st.fontSize}px`;
  t.style.color = st.textColor;
  const names = [ev.viewer, ev.target].filter((n): n is string => Boolean(n));
  let rest = ev.text;
  while (rest) {
    let best = -1;
    let name = '';
    for (const n of names) {
      const i = rest.toLowerCase().indexOf(n.toLowerCase());
      if (i !== -1 && (best === -1 || i < best)) [best, name] = [i, n];
    }
    if (best === -1) {
      t.append(rest);
      break;
    }
    t.append(rest.slice(0, best));
    const span = el('span', 'lm-name');
    span.style.color = st.accentColor;
    span.textContent = rest.slice(best, best + name.length);
    t.append(span);
    rest = rest.slice(best + name.length);
  }
  return t;
}

export type PlayOptions = { muted?: boolean; resolvedUrl?: (u: string) => string };

/**
 * Renders a single event onto the stage and resolves once it has fully left the screen.
 */
export function playEvent(stage: HTMLElement, ev: OverlayEvent, opts: PlayOptions = {}): Promise<void> {
  const st = ev.style;
  ensureFont(st.fontFamily);
  const duration = Math.max(1500, ev.durationMs);
  const item = el('div', 'lm-item');
  item.style.left = `${st.x}%`;
  item.style.top = `${st.y}%`;
  item.style.setProperty('--scale', String(st.scale));
  item.style.setProperty('--accent', st.accentColor);
  item.style.setProperty('--hold', `${duration - EXIT_MS}ms`);

  const fx = el('div', `lm-fx lm-in-${st.effect}`);
  fx.style.setProperty('--enter', `${ENTER_MS}ms`);
  fx.style.setProperty('--exit', `${EXIT_MS}ms`);
  fx.style.setProperty('--exit-at', `${duration - EXIT_MS}ms`);

  const url = (u: string) => (opts.resolvedUrl ? opts.resolvedUrl(u) : u);
  if (ev.animation === 'image' && ev.imageUrl) {
    const img = document.createElement('img');
    img.className = 'lm-image';
    img.src = url(ev.imageUrl);
    img.alt = '';
    fx.appendChild(img);
  } else {
    fx.appendChild(scene(ev.animation, st.accentColor, ev.characterStyle));
    if (ev.imageUrl) {
      const img = document.createElement('img');
      img.className = 'lm-image lm-image-small';
      img.src = url(ev.imageUrl);
      fx.appendChild(img);
    }
  }
  const p = particles(st.particles, st.accentColor);
  if (p) fx.appendChild(p);
  if (ev.text) fx.appendChild(textBlock(ev));
  item.appendChild(fx);
  stage.appendChild(item);

  let audio: HTMLAudioElement | null = null;
  if (ev.soundUrl && !opts.muted) {
    audio = new Audio(url(ev.soundUrl));
    audio.volume = Math.min(1, Math.max(0, ev.soundVolume / 100));
    audio.play().catch(() => undefined);
  }

  return new Promise((resolve) => {
    setTimeout(() => {
      item.remove();
      if (audio) {
        audio.pause();
        audio.src = '';
      }
      resolve();
    }, duration);
  });
}

/** Plays events strictly one after another and drops duplicates (same eventId). */
export class EventQueue {
  private queue: OverlayEvent[] = [];
  private playing = false;
  private seen: string[] = [];

  constructor(
    private stage: HTMLElement,
    private opts: PlayOptions & { gapMs?: number; maxQueue?: number } = {},
  ) {}

  push(ev: OverlayEvent) {
    if (this.seen.includes(ev.eventId)) return;
    this.seen.push(ev.eventId);
    if (this.seen.length > 200) this.seen.shift();
    if (this.queue.length >= (this.opts.maxQueue ?? 50)) this.queue.shift();
    this.queue.push(ev);
    void this.run();
  }

  get size() {
    return this.queue.length + (this.playing ? 1 : 0);
  }

  private async run() {
    if (this.playing) return;
    this.playing = true;
    while (this.queue.length) {
      const ev = this.queue.shift()!;
      try {
        await playEvent(this.stage, ev, this.opts);
      } catch {
        /* never let one broken event block the queue */
      }
      await new Promise((r) => setTimeout(r, this.opts.gapMs ?? 250));
    }
    this.playing = false;
  }
}
