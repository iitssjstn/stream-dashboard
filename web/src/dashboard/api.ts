import type { CommandStyle } from '../overlay/types';
import { t } from './i18n';

export type Trigger = 'chat' | 'follow' | 'subscriber' | 'resub' | 'gift' | 'cheer' | 'raid';

export type Command = {
  id: number;
  name: string;
  trigger: Trigger;
  /** Own description, e.g. the StreamElements overlay/alert it was imported from */
  label: string | null;
  reply: string | null;
  aliases: string[];
  minAmount: number;
  useCount?: number;
  enabled: boolean;
  animation: string;
  characterStyle: 'anime' | 'people';
  walkIn: boolean;
  useVideoLength: boolean;
  imageUrl: string | null;
  soundUrl: string | null;
  soundVolume: number;
  text: string;
  durationMs: number;
  userCooldownSec: number;
  globalCooldownSec: number;
  permission: 'everyone' | 'subscriber' | 'vip' | 'moderator' | 'broadcaster';
  showUsername: boolean;
  showText: boolean;
  targetMode: 'optional' | 'required' | 'none';
  targetFallback: string;
  style: CommandStyle;
};

export type Me = {
  user: { id: number; login: string; displayName: string; profileImageUrl: string | null; scopes: string[]; authError: string | null; locale: string };
  overlay: { url: string; width: number; height: number; connectedClients: number };
  chat: { enabled: boolean; status: 'disconnected' | 'connecting' | 'connected' | 'auth_failed'; lastError: string | null; connectedAt: number | null };
  alerts: { status: 'off' | 'connecting' | 'connected' | 'error'; subscribed: string[]; missingScopes: string[]; lastError: string | null };
  stats: { commands: number; triggers24h: number; playsByHour: number[]; playsFirstHour: number };
  twitchConfigured: boolean;
  isOwner: boolean;
  giphyEnabled: boolean;
};

export type Activity = { id: number; commandName: string; viewer: string; status: string; detail: string | null; createdAt: number };
export type Upload = { id: string; url: string; mime: string; size: number; originalName: string; createdAt: number };

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...rest,
    headers: json !== undefined ? { 'content-type': 'application/json', ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  // Server messages are English; t() shows them in the chosen language.
  if (!res.ok) throw new ApiError(res.status, t((data as any)?.error ?? `Error ${res.status}`));
  return data as T;
}

/** Label maps whose values are translated when read (works with Object.entries too). */
const translated = <T extends Record<string, string>>(o: T): T =>
  new Proxy(o, { get: (target, k) => (typeof k === 'string' && k in target ? t(target[k as keyof T] as string) : Reflect.get(target, k)) });

export const LABELS = {
  animation: translated({
    hug: 'Hug',
    highfive: 'High five',
    love: 'Love',
    dance: 'Dance',
    wave: 'Wave',
    image: 'Own image / GIF / video',
    none: 'None (chat reply only)',
  } as Record<string, string>),
  permission: translated({
    everyone: 'Everyone',
    subscriber: 'Subscribers+',
    vip: "VIP's+",
    moderator: 'Moderators+',
    broadcaster: 'Streamer only',
  } as Record<string, string>),
  effect: translated({
    pop: 'Pop',
    'slide-up': 'Slide up',
    'slide-left': 'Slide in from right',
    fade: 'Fade',
    bounce: 'Bounce',
    zoom: 'Zoom in',
    spin: 'Spin',
  } as Record<string, string>),
  style: translated({ anime: 'Anime', people: 'People' } as Record<string, string>),
  particles: translated({ none: 'None', hearts: 'Hearts', stars: 'Stars', confetti: 'Confetti', sparkles: 'Sparkles' } as Record<string, string>),
};

export type Timer = {
  id: number;
  name: string;
  enabled: boolean;
  messages: string[];
  intervalMin: number;
  offlineIntervalMin: number;
  minChatLines: number;
};

/** Alert types with their labels and what "minimum amount" means for each. */
const alertType = (trigger: Exclude<Trigger, 'chat'>, label: string, amount: string | null, vars: string) => ({
  trigger,
  vars,
  get label() {
    return t(label);
  },
  get amount() {
    return amount && t(amount);
  },
});

export const ALERT_TYPES: { trigger: Exclude<Trigger, 'chat'>; label: string; amount: string | null; vars: string }[] = [
  alertType('follow', 'Follow', null, '{user}'),
  alertType('subscriber', 'New sub', null, '{user} {tier}'),
  alertType('resub', 'Resub', 'months', '{user} {months} {tier} {message}'),
  alertType('gift', 'Gifted subs', 'subs', '{user} {amount} {tier}'),
  alertType('cheer', 'Bits', 'bits', '{user} {amount} {message}'),
  alertType('raid', 'Raid', 'viewers', '{user} {amount}'),
];

export const FONTS = ['Fredoka', 'Poppins', 'Nunito', 'Baloo 2', 'Bangers', 'Luckiest Guy', 'Permanent Marker', 'Press Start 2P', 'Montserrat', 'Arial', 'Impact'];
