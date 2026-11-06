import { config } from '../config.js';
import { discordApp } from '../settings.js';

export class DiscordError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function discordRest<T>(path: string, init: RequestInit = {}, token = discordApp().botToken): Promise<T> {
  const res = await fetch(`${config.discord.apiBase}${path}`, {
    ...init,
    headers: { authorization: `Bot ${token}`, 'user-agent': 'DiscordBot (https://github.com/iitssjstn/stream-dashboard, 1.0)', ...init.headers },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401) throw new DiscordError(401, 'Discord weigert het bot-token');
  if (res.status === 403) throw new DiscordError(403, 'De bot heeft geen toegang (rechten in dit kanaal?)');
  if (res.status === 404) throw new DiscordError(404, 'Niet gevonden op Discord');
  if (!res.ok) throw new DiscordError(res.status, `Discord gaf een fout (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export type DiscordUser = { id: string; username: string; global_name?: string | null; avatar: string | null; bot?: boolean };
export type DiscordChannel = { id: string; name: string; type: number; position: number };

export const getBotUser = (token?: string) => discordRest<DiscordUser>('/users/@me', {}, token);

export async function gatewayUrl() {
  if (config.discord.gatewayUrl) return config.discord.gatewayUrl;
  const r = await discordRest<{ url: string }>('/gateway/bot');
  return r.url;
}

/** Text and announcement channels, in Discord's order. */
export async function textChannels(guildId: string) {
  const all = await discordRest<DiscordChannel[]>(`/guilds/${guildId}/channels`);
  return all.filter((c) => c.type === 0 || c.type === 5).sort((a, b) => a.position - b.position).map((c) => ({ id: c.id, name: c.name }));
}

export async function sendWelcome(channelId: string, content: string, png: Buffer, mentionId: string | null) {
  const form = new FormData();
  form.append(
    'payload_json',
    JSON.stringify({ content, attachments: [{ id: 0, filename: 'welkom.png' }], allowed_mentions: { users: mentionId ? [mentionId] : [] } }),
  );
  form.append('files[0]', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'welkom.png');
  await discordRest(`/channels/${channelId}/messages`, { method: 'POST', body: form });
}

/** Exchanges the OAuth code from the "add bot" flow; Discord returns the guild the bot was added to. */
export async function exchangeBotCode(code: string) {
  const app = discordApp();
  const res = await fetch(`${config.discord.apiBase}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, grant_type: 'authorization_code', code, redirect_uri: config.discord.redirectUri }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new DiscordError(400, `Discord-koppeling mislukt (${res.status})`);
  const json = (await res.json()) as { guild?: { id: string; name: string; icon: string | null } };
  if (!json.guild?.id) throw new DiscordError(400, 'Discord gaf geen server terug');
  return json.guild;
}

export const leaveGuild = (guildId: string) => discordRest(`/users/@me/guilds/${guildId}`, { method: 'DELETE' });

export function avatarUrl(u: Pick<DiscordUser, 'id' | 'avatar'>) {
  if (u.avatar) return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=256`;
  const idx = Number((BigInt(u.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}
