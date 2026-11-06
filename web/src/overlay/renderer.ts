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

export const WALKABLE = new Set(['hug', 'highfive', 'dance']);

function scene(animation: string, accent: string, style: CharacterStyle = 'anime', walk = false): HTMLElement {
  const s = el('div', `lm-scene lm-scene-${animation} lm-style-${style}${walk && WALKABLE.has(animation) ? ' lm-walk' : ''}`);
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
/** MP4 / WebM (incl. transparent WebM) are played as video; everything else as image/GIF. */
export const isVideo = (u: string | null | undefined) => Boolean(u && /\.(mp4|webm|m4v|mov)(?:[?#]|$)/i.test(u));

function mediaElement(src: string, cls: string, ev: OverlayEvent, opts: PlayOptions): HTMLImageElement | HTMLVideoElement {
  if (!isVideo(src)) {
    const img = document.createElement('img');
    img.className = cls;
    img.src = src;
    img.alt = '';
    return img;
  }
  const v = document.createElement('video');
  v.className = cls;
  v.src = src;
  v.autoplay = true;
  v.playsInline = true;
  v.preload = 'auto';
  // Loop short clips for the whole duration, unless the duration follows the video itself.
  v.loop = !ev.useVideoLength;
  // The video's own sound plays, unless a separate sound was chosen (or we're in a muted preview).
  v.muted = Boolean(opts.muted || ev.soundUrl);
  v.volume = Math.min(1, Math.max(0, ev.soundVolume / 100));
  v.play().catch(() => {
    // Autoplay with sound refused (normal browsers; OBS allows it): play muted instead.
    v.muted = true;
    v.play().catch(() => undefined);
  });
  return v;
}

/** Resolves with the video's length in ms (or null when it can't be read within 4 s). */
function videoLength(v: HTMLVideoElement): Promise<number | null> {
  if (Number.isFinite(v.duration) && v.duration > 0) return Promise.resolve(v.duration * 1000);
  return new Promise((resolve) => {
    const done = (val: number | null) => {
      clearTimeout(t);
      v.removeEventListener('loadedmetadata', onMeta);
      resolve(val);
    };
    const onMeta = () => done(Number.isFinite(v.duration) && v.duration > 0 ? v.duration * 1000 : null);
    const t = setTimeout(() => done(null), 4000);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('error', () => done(null), { once: true });
  });
}

/**
 * Renders a single event onto the stage and resolves once it has fully left the screen.
 */
export async function playEvent(stage: HTMLElement, ev: OverlayEvent, opts: PlayOptions = {}): Promise<void> {
  const st = ev.style;
  ensureFont(st.fontFamily);
  const url = (u: string) => (opts.resolvedUrl ? opts.resolvedUrl(u) : u);

  const fx = el('div', `lm-fx lm-in-${st.effect}`);
  let media: HTMLImageElement | HTMLVideoElement | null = null;
  if (ev.animation === 'image' && ev.imageUrl) {
    media = mediaElement(url(ev.imageUrl), 'lm-image', ev, opts);
    fx.appendChild(media);
  } else {
    fx.appendChild(scene(ev.animation, st.accentColor, ev.characterStyle, ev.walkIn));
    if (ev.imageUrl) {
      media = mediaElement(url(ev.imageUrl), 'lm-image lm-image-small', ev, opts);
      fx.appendChild(media);
    }
  }

  let duration = Math.max(1500, ev.durationMs);
  if (ev.useVideoLength && media instanceof HTMLVideoElement) {
    const len = await videoLength(media);
    if (len) duration = Math.min(60_000, Math.max(1500, Math.round(len)));
  }

  const item = el('div', 'lm-item');
  item.style.left = `${st.x}%`;
  item.style.top = `${st.y}%`;
  item.style.setProperty('--scale', String(st.scale));
  item.style.setProperty('--accent', st.accentColor);
  item.style.setProperty('--hold', `${duration - EXIT_MS}ms`);
  fx.style.setProperty('--enter', `${ENTER_MS}ms`);
  fx.style.setProperty('--exit', `${EXIT_MS}ms`);
  fx.style.setProperty('--exit-at', `${duration - EXIT_MS}ms`);

  const p = particles(st.particles, st.accentColor);
  if (p) fx.appendChild(p);
  if (ev.text) fx.appendChild(textBlock(ev));
  item.appendChild(fx);
  stage.appendChild(item);
  if (media instanceof HTMLVideoElement) {
    // Start from the beginning at the moment it appears (metadata may have been loaded earlier).
    media.currentTime = 0;
    media.play().catch(() => undefined);
  }

  let audio: HTMLAudioElement | null = null;
  if (ev.soundUrl && !opts.muted) {
    audio = new Audio(url(ev.soundUrl));
    audio.volume = Math.min(1, Math.max(0, ev.soundVolume / 100));
    audio.play().catch(() => undefined);
  }

  return new Promise((resolve) => {
    setTimeout(() => {
      item.remove();
      if (media instanceof HTMLVideoElement) {
        media.pause();
        media.removeAttribute('src');
        media.load();
      }
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
