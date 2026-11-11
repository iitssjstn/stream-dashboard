import { ANIMATIONS, CHARACTER_STYLES, EFFECTS, PARTICLES, PERMISSIONS, TARGET_MODES, TRIGGERS } from '../commands/defaults.js';
import type { CommandStyle } from '../db/schema.js';

export class ValidationError extends Error {}

const int = (v: unknown, name: string, min: number, max: number): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new ValidationError(`${name} must be between ${min} and ${max}`);
  return Math.round(n);
};
/** Like int, but keeps two decimals (positions dragged in the overlay editor). */
const dec = (v: unknown, name: string, min: number, max: number): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new ValidationError(`${name} must be between ${min} and ${max}`);
  return Math.round(n * 100) / 100;
};
const oneOf = <T extends readonly string[]>(v: unknown, list: T, name: string): T[number] => {
  if (typeof v !== 'string' || !list.includes(v)) throw new ValidationError(`Invalid ${name}`);
  return v as T[number];
};
const str = (v: unknown, name: string, max: number, optional = false): string | null => {
  if ((v === null || v === undefined || v === '') && optional) return null;
  if (typeof v !== 'string' || !v.trim()) throw new ValidationError(`${name} is required`);
  if (v.length > max) throw new ValidationError(`${name} is too long (max ${max})`);
  return v.trim();
};
const color = (v: unknown, name: string) => {
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw new ValidationError(`${name} must be a hex colour`);
  return v;
};
const mediaUrl = (v: unknown, name: string) => {
  const s = str(v, name, 500, true);
  if (s && !/^\/uploads\/[\w.-]+$/.test(s) && !/^https:\/\/[^\s]+$/.test(s)) {
    throw new ValidationError(`${name} must be an upload or https URL`);
  }
  return s;
};

export const NAME_RE = /^[a-z0-9_\-àáâäèéêëìíîïòóôöùúûü]{1,30}$/;

export function validateCommand(body: any) {
  const name = str(body?.name, 'Command name', 30)!.replace(/^!/, '').toLowerCase();
  if (!NAME_RE.test(name)) throw new ValidationError('Command name may only contain letters, digits, _ and -');
  const animation = oneOf(body.animation, ANIMATIONS, 'animation');
  const imageUrl = mediaUrl(body.imageUrl, 'Image');
  if (animation === 'image' && !imageUrl) throw new ValidationError('Choose an image or GIF for this command');
  const s = body.style ?? {};
  const style: CommandStyle = {
    fontFamily: str(s.fontFamily, 'Font', 40)!,
    fontSize: int(s.fontSize, 'Font size', 12, 140),
    textColor: color(s.textColor, 'Text colour'),
    accentColor: color(s.accentColor, 'Accent colour'),
    x: dec(s.x, 'Position X', 0, 100),
    y: dec(s.y, 'Position Y', 0, 100),
    scale: Math.min(3, Math.max(0.2, Number(s.scale) || 1)),
    effect: oneOf(s.effect, EFFECTS, 'effect'),
    particles: oneOf(s.particles, PARTICLES, 'particles'),
    textShadow: Boolean(s.textShadow),
  };
  const trigger = oneOf(body.trigger ?? 'chat', TRIGGERS, 'trigger');
  const reply = str(body.reply, 'Chat reply', 480, true);
  if (animation === 'none' && !reply) throw new ValidationError('Choose an animation or enter a chat reply');
  if (trigger !== 'chat' && animation === 'none' && !reply) throw new ValidationError('An alert needs an animation or a chat reply');
  const aliases = Array.isArray(body.aliases)
    ? [...new Set(body.aliases.map((a: unknown) => String(a).trim().replace(/^!/, '').toLowerCase()).filter(Boolean))]
    : [];
  if (aliases.length > 10) throw new ValidationError('At most 10 aliases');
  for (const a of aliases as string[]) {
    if (!NAME_RE.test(a)) throw new ValidationError(`Invalid alias: ${a}`);
  }
  return {
    name,
    trigger,
    reply,
    label: str(body.label, 'Name', 80, true),
    aliases: (aliases as string[]).filter((a) => a !== name),
    minAmount: int(body.minAmount ?? 0, 'Minimum', 0, 1_000_000),
    enabled: body.enabled !== false,
    animation,
    characterStyle: oneOf(body.characterStyle ?? 'anime', CHARACTER_STYLES, 'style'),
    walkIn: body.walkIn === true,
    useVideoLength: body.useVideoLength === true,
    imageUrl,
    soundUrl: mediaUrl(body.soundUrl, 'Sound'),
    soundVolume: int(body.soundVolume ?? 70, 'Volume', 0, 100),
    text: body.showText === false || animation === 'none' ? (str(body.text, 'Text', 200, true) ?? '') : str(body.text, 'Text', 200)!,
    showText: body.showText !== false,
    durationMs: int(body.durationMs, 'Duration', 1000, 60_000),
    userCooldownSec: int(body.userCooldownSec, 'Cooldown per user', 0, 86_400),
    globalCooldownSec: int(body.globalCooldownSec, 'Global cooldown', 0, 86_400),
    permission: oneOf(body.permission, PERMISSIONS, 'permission'),
    showUsername: body.showUsername !== false,
    targetMode: oneOf(body.targetMode ?? 'optional', TARGET_MODES, 'recipient setting'),
    targetFallback: str(body.targetFallback ?? 'the streamer', 'Text without name', 40)!,
    style,
  };
}

export function validateTimer(body: any) {
  const name = str(body?.name, 'Name', 60)!;
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .map((m: unknown) => String(m ?? '').replace(/[\r\n]+/g, ' ').trim())
    .filter(Boolean);
  if (!messages.length) throw new ValidationError('Add at least one message');
  if (messages.length > 20) throw new ValidationError('At most 20 messages per timer');
  for (const m of messages) if (m.length > 480) throw new ValidationError('A message can be at most 480 characters');
  return {
    name,
    enabled: body.enabled !== false,
    messages: messages as string[],
    intervalMin: int(body.intervalMin, 'Interval (live)', 1, 1440),
    offlineIntervalMin: int(body.offlineIntervalMin ?? 0, 'Interval (offline)', 0, 1440),
    minChatLines: int(body.minChatLines ?? 0, 'Minimum number of chat messages', 0, 1000),
  };
}
