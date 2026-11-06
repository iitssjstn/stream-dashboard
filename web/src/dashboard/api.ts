import type { CommandStyle } from '../overlay/types';

export type Trigger = 'chat' | 'follow' | 'subscriber' | 'resub' | 'gift' | 'cheer' | 'raid';

export type Command = {
  id: number;
  name: string;
  trigger: Trigger;
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
  user: { id: number; login: string; displayName: string; profileImageUrl: string | null; scopes: string[]; authError: string | null };
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
  if (!res.ok) throw new ApiError(res.status, (data as any)?.error ?? `Fout ${res.status}`);
  return data as T;
}

export const LABELS = {
  animation: {
    hug: 'Knuffel',
    highfive: 'High five',
    love: 'Liefde',
    dance: 'Dansen',
    wave: 'Zwaaien',
    image: 'Eigen afbeelding / GIF',
    none: 'Geen (alleen chat-antwoord)',
  } as Record<string, string>,
  permission: {
    everyone: 'Iedereen',
    subscriber: 'Subscribers+',
    vip: "VIP's+",
    moderator: 'Moderators+',
    broadcaster: 'Alleen streamer',
  } as Record<string, string>,
  effect: {
    pop: 'Pop',
    'slide-up': 'Omhoog schuiven',
    'slide-left': 'Van rechts schuiven',
    fade: 'Vervagen',
    bounce: 'Stuiteren',
    zoom: 'Inzoomen',
    spin: 'Draaien',
  } as Record<string, string>,
  style: { anime: 'Anime', people: 'Mensen' } as Record<string, string>,
  particles: { none: 'Geen', hearts: 'Hartjes', stars: 'Sterren', confetti: 'Confetti', sparkles: 'Glinsters' } as Record<string, string>,
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
export const ALERT_TYPES: { trigger: Exclude<Trigger, 'chat'>; label: string; amount: string | null; vars: string }[] = [
  { trigger: 'follow', label: 'Follow', amount: null, vars: '{user}' },
  { trigger: 'subscriber', label: 'Nieuwe sub', amount: null, vars: '{user} {tier}' },
  { trigger: 'resub', label: 'Resub', amount: 'maanden', vars: '{user} {months} {tier} {message}' },
  { trigger: 'gift', label: 'Gifted subs', amount: 'subs', vars: '{user} {amount} {tier}' },
  { trigger: 'cheer', label: 'Bits', amount: 'bits', vars: '{user} {amount} {message}' },
  { trigger: 'raid', label: 'Raid', amount: 'kijkers', vars: '{user} {amount}' },
];

export const FONTS = ['Fredoka', 'Poppins', 'Nunito', 'Baloo 2', 'Bangers', 'Luckiest Guy', 'Permanent Marker', 'Press Start 2P', 'Montserrat', 'Arial', 'Impact'];
