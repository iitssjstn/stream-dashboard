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
  if (res.status === 401) throw new DiscordError(401, 'Discord rejected the bot token');
  if (res.status === 403) throw new DiscordError(403, 'The bot has no access (permissions in this channel?)');
  if (res.status === 404) throw new DiscordError(404, 'Not found on Discord');
  if (!res.ok) throw new DiscordError(res.status, `Discord returned an error (${res.status}): ${(await res.text()).slice(0, 200)}`);
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
  if (!res.ok) throw new DiscordError(400, `Discord connection failed (${res.status})`);
  const json = (await res.json()) as { guild?: { id: string; name: string; icon: string | null } };
  if (!json.guild?.id) throw new DiscordError(400, 'Discord did not return a server');
  return json.guild;
}

/** The bot's own profile on one server only: nickname, avatar (data URI) and bio. null resets a field. */
export const modifyCurrentMember = (guildId: string, body: { nick: string | null; avatar: string | null; bio: string | null }) =>
  discordRest(`/guilds/${guildId}/members/@me`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const leaveGuild = (guildId: string) => discordRest(`/users/@me/guilds/${guildId}`, { method: 'DELETE' });

export function defaultAvatarUrl(id: string) {
  const idx = Number((BigInt(/^\d+$/.test(id) ? id : '0') >> 22n) % 6n);
  return `${config.discord.cdnBase}/embed/avatars/${idx}.png`;
}

export function avatarUrl(u: Pick<DiscordUser, 'id' | 'avatar'>) {
  if (u.avatar) return `${config.discord.cdnBase}/avatars/${u.id}/${u.avatar}.png?size=256`;
  return defaultAvatarUrl(u.id);
}

/**
 * Avatar candidates for a member who just joined, best first: their profile photo for this
 * server, their account photo, Discord's default avatar.
 */
export function memberAvatarCandidates(guildId: string, user: Pick<DiscordUser, 'id' | 'avatar'>, memberAvatar?: string | null) {
  const list: string[] = [];
  if (memberAvatar) list.push(`${config.discord.cdnBase}/guilds/${guildId}/users/${user.id}/avatars/${memberAvatar}.png?size=256`);
  if (user.avatar) list.push(`${config.discord.cdnBase}/avatars/${user.id}/${user.avatar}.png?size=256`);
  list.push(defaultAvatarUrl(user.id));
  return list;
}
