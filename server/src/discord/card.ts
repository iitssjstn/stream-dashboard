import { createCanvas, GlobalFonts, loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import type { WelcomeCard } from '../db/schema.js';

const require = createRequire(import.meta.url);
for (const w of ['500', '700']) {
  for (const sub of ['latin', 'latin-ext']) {
    GlobalFonts.registerFromPath(require.resolve(`@fontsource/fredoka/files/fredoka-${sub}-${w}-normal.woff2`), 'Fredoka');
  }
}

export const W = 1100;
export const H = 420;
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Remote images are only fetched from known media hosts (no arbitrary URLs: the server must not
 * become a proxy into the private network). Uploads are read from disk.
 */
const ALLOWED_HOST = /^(?:media\d*\.giphy\.com|i\.giphy\.com|cdn\.streamelements\.com|cdn\.discordapp\.com|media\.discordapp\.net)$/;

/** Reads an upload from disk or downloads from an allowed media host. */
/** Why the last remote image could not be loaded (shown in the server log). */
export let lastMediaError: string | null = null;

export async function loadMediaBytes(src: string | null): Promise<Buffer | null> {
  if (!src) return null;
  try {
    if (src.startsWith('/uploads/')) {
      const buf = await fs.promises.readFile(path.join(config.uploadDir, path.basename(src)));
      return buf.length <= MAX_BYTES ? buf : null;
    }
    // Follow at most 3 redirects ourselves, re-checking every hop against the allowed hosts.
    let url = new URL(src);
    for (let hop = 0; hop < 4; hop++) {
      const isCdn = url.origin === new URL(config.discord.cdnBase).origin;
      if (!isCdn && (url.protocol !== 'https:' || !ALLOWED_HOST.test(url.hostname))) {
        lastMediaError = `host niet toegestaan: ${url.hostname}`;
        return null;
      }
      const res = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        redirect: 'manual',
        headers: { 'user-agent': 'LumioBot/1.0 (+https://github.com/iitssjstn/stream-dashboard)', accept: 'image/png,image/*;q=0.8' },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location')!, url);
        continue;
      }
      if (!res.ok) {
        lastMediaError = `HTTP ${res.status} van ${url.hostname}`;
        return null;
      }
      if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) {
        lastMediaError = 'bestand te groot';
        return null;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length <= MAX_BYTES ? buf : null;
    }
    lastMediaError = 'te veel omleidingen';
    return null;
  } catch (e) {
    lastMediaError = (e as Error).message;
    return null;
  }
}

async function fetchImage(src: string | null): Promise<Image | null> {
  const buf = await loadMediaBytes(src);
  if (!buf) return null;
  try {
    return await loadImage(buf);
  } catch {
    return null;
  }
}

const isGif = (b: Buffer) => b.subarray(0, 4).toString('latin1') === 'GIF8';

/**
 * Prepares a profile picture for Discord as a data URI: animated GIFs stay as they are,
 * everything else is centre-cropped to a 512×512 PNG.
 */
export async function avatarDataUri(src: string): Promise<string | null> {
  const buf = await loadMediaBytes(src);
  if (!buf) return null;
  if (isGif(buf)) return `data:image/gif;base64,${buf.toString('base64')}`;
  let img: Image;
  try {
    img = await loadImage(buf);
  } catch {
    return null;
  }
  const size = 512;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const s = Math.max(size / img.width, size / img.height);
  ctx.drawImage(img, (size - img.width * s) / 2, (size - img.height * s) / 2, img.width * s, img.height * s);
  return `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`;
}

export function fill(template: string, v: { name: string; server: string; count: number }) {
  return template.replace(/\{name\}/gi, v.name).replace(/\{server\}/gi, v.server).replace(/\{count\}/gi, String(v.count));
}

function fitText(ctx: SKRSContext2D, text: string, weight: number, maxSize: number, maxWidth: number) {
  let size = maxSize;
  do {
    ctx.font = `${weight} ${size}px Fredoka`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  } while (size > 18);
  return size;
}

/** Renders the welcome image as PNG. */
export async function renderCard(
  card: WelcomeCard,
  v: { name: string; server: string; count: number; avatar: string | string[] | null },
  onAvatarError?: (reason: string) => void,
) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background: cover-fit image, or a gradient in the accent colour.
  const bg = await fetchImage(card.background);
  if (bg) {
    const scale = Math.max(W / bg.width, H / bg.height);
    ctx.drawImage(bg, (W - bg.width * scale) / 2, (H - bg.height * scale) / 2, bg.width * scale, bg.height * scale);
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, card.accentColor);
    g.addColorStop(1, '#0b0a14');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.fillStyle = `rgba(0,0,0,${Math.max(0, Math.min(90, card.dim)) / 100})`;
  ctx.fillRect(0, 0, W, H);

  // Avatar with a ring in the accent colour (falls back to the first letter).
  const cx = W / 2;
  const cy = 140;
  const r = 92;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.5)';
  ctx.shadowBlur = 24;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
  ctx.fillStyle = card.accentColor;
  ctx.fill();
  ctx.restore();
  // Try each candidate (server profile photo, account photo, Discord default) until one loads.
  let avatar: Image | null = null;
  for (const candidate of Array.isArray(v.avatar) ? v.avatar : v.avatar ? [v.avatar] : []) {
    avatar = await fetchImage(candidate);
    if (avatar) break;
    onAvatarError?.(`${candidate.replace(/\?.*$/, '')}: ${lastMediaError ?? 'onbekende fout'}`);
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  if (avatar) ctx.drawImage(avatar, cx - r, cy - r, r * 2, r * 2);
  else {
    ctx.fillStyle = '#2a2645';
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = '#fff';
    ctx.font = '700 90px Fredoka';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((v.name.trim()[0] ?? '?').toUpperCase(), cx, cy + 4);
  }
  ctx.restore();

  // Texts, shrunk to fit long names.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,.65)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 3;
  const title = fill(card.title, v);
  fitText(ctx, title, 700, 56, W - 120);
  ctx.fillStyle = card.textColor;
  ctx.fillText(title, cx, 312);
  const sub = fill(card.subtitle, v);
  if (sub) {
    fitText(ctx, sub, 500, 30, W - 160);
    ctx.globalAlpha = 0.85;
    ctx.fillText(sub, cx, 360);
    ctx.globalAlpha = 1;
  }
  return canvas.toBuffer('image/png');
}
