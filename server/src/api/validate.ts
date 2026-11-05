import { ANIMATIONS, CHARACTER_STYLES, EFFECTS, PARTICLES, PERMISSIONS, TARGET_MODES } from '../commands/defaults.js';
import type { CommandStyle } from '../db/schema.js';

export class ValidationError extends Error {}

const int = (v: unknown, name: string, min: number, max: number): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new ValidationError(`${name} moet tussen ${min} en ${max} liggen`);
  return Math.round(n);
};
const oneOf = <T extends readonly string[]>(v: unknown, list: T, name: string): T[number] => {
  if (typeof v !== 'string' || !list.includes(v)) throw new ValidationError(`Ongeldige ${name}`);
  return v as T[number];
};
const str = (v: unknown, name: string, max: number, optional = false): string | null => {
  if ((v === null || v === undefined || v === '') && optional) return null;
  if (typeof v !== 'string' || !v.trim()) throw new ValidationError(`${name} is verplicht`);
  if (v.length > max) throw new ValidationError(`${name} is te lang (max ${max})`);
  return v.trim();
};
const color = (v: unknown, name: string) => {
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw new ValidationError(`${name} moet een hex-kleur zijn`);
  return v;
};
const mediaUrl = (v: unknown, name: string) => {
  const s = str(v, name, 500, true);
  if (s && !/^\/uploads\/[\w.-]+$/.test(s) && !/^https:\/\/[^\s]+$/.test(s)) {
    throw new ValidationError(`${name} moet een upload of https-URL zijn`);
  }
  return s;
};

export function validateCommand(body: any) {
  const name = str(body?.name, 'Commandnaam', 30)!.replace(/^!/, '').toLowerCase();
  if (!/^[a-z0-9_\-àáâäèéêëìíîïòóôöùúûü]{1,30}$/.test(name)) throw new ValidationError('Commandnaam mag alleen letters, cijfers, _ en - bevatten');
  const animation = oneOf(body.animation, ANIMATIONS, 'animatie');
  const imageUrl = mediaUrl(body.imageUrl, 'Afbeelding');
  if (animation === 'image' && !imageUrl) throw new ValidationError('Kies een afbeelding of GIF voor dit command');
  const s = body.style ?? {};
  const style: CommandStyle = {
    fontFamily: str(s.fontFamily, 'Lettertype', 40)!,
    fontSize: int(s.fontSize, 'Lettergrootte', 12, 140),
    textColor: color(s.textColor, 'Tekstkleur'),
    accentColor: color(s.accentColor, 'Accentkleur'),
    x: int(s.x, 'Positie X', 0, 100),
    y: int(s.y, 'Positie Y', 0, 100),
    scale: Math.min(3, Math.max(0.2, Number(s.scale) || 1)),
    effect: oneOf(s.effect, EFFECTS, 'effect'),
    particles: oneOf(s.particles, PARTICLES, 'deeltjes'),
    textShadow: Boolean(s.textShadow),
  };
  return {
    name,
    enabled: body.enabled !== false,
    animation,
    characterStyle: oneOf(body.characterStyle ?? 'anime', CHARACTER_STYLES, 'stijl'),
    walkIn: body.walkIn === true,
    imageUrl,
    soundUrl: mediaUrl(body.soundUrl, 'Geluid'),
    soundVolume: int(body.soundVolume ?? 70, 'Volume', 0, 100),
    text: body.showText === false ? (str(body.text, 'Tekst', 200, true) ?? '') : str(body.text, 'Tekst', 200)!,
    showText: body.showText !== false,
    durationMs: int(body.durationMs, 'Duur', 1000, 60_000),
    userCooldownSec: int(body.userCooldownSec, 'Cooldown per gebruiker', 0, 86_400),
    globalCooldownSec: int(body.globalCooldownSec, 'Globale cooldown', 0, 86_400),
    permission: oneOf(body.permission, PERMISSIONS, 'permissie'),
    showUsername: body.showUsername !== false,
    targetMode: oneOf(body.targetMode ?? 'optional', TARGET_MODES, 'ontvanger-instelling'),
    targetFallback: str(body.targetFallback ?? 'de streamer', 'Tekst zonder naam', 40)!,
    style,
  };
}
