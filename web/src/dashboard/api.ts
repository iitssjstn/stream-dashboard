import type { CommandStyle } from '../overlay/types';

export type Command = {
  id: number;
  name: string;
  enabled: boolean;
  animation: string;
  imageUrl: string | null;
  soundUrl: string | null;
  soundVolume: number;
  text: string;
  durationMs: number;
  userCooldownSec: number;
  globalCooldownSec: number;
  permission: 'everyone' | 'subscriber' | 'vip' | 'moderator' | 'broadcaster';
  showUsername: boolean;
  style: CommandStyle;
};

export type Me = {
  user: { id: number; login: string; displayName: string; profileImageUrl: string | null; scopes: string[]; authError: string | null };
  overlay: { url: string; width: number; height: number; connectedClients: number };
  chat: { enabled: boolean; status: 'disconnected' | 'connecting' | 'connected' | 'auth_failed'; lastError: string | null; connectedAt: number | null };
  stats: { commands: number; triggers24h: number };
  twitchConfigured: boolean;
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
    hug: 'Knuffel (anime)',
    highfive: 'High five (anime)',
    love: 'Liefde (anime)',
    dance: 'Dansen (anime)',
    wave: 'Zwaaien (anime)',
    image: 'Eigen afbeelding / GIF',
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
  particles: { none: 'Geen', hearts: 'Hartjes', stars: 'Sterren', confetti: 'Confetti', sparkles: 'Glinsters' } as Record<string, string>,
};

export const FONTS = ['Fredoka', 'Poppins', 'Nunito', 'Baloo 2', 'Bangers', 'Luckiest Guy', 'Permanent Marker', 'Press Start 2P', 'Montserrat', 'Arial', 'Impact'];
