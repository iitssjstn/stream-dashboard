import { eq } from 'drizzle-orm';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { db, schema } from './db/index.js';
import { decrypt, encrypt } from './crypto.js';
import { readSecret } from './config.js';

export type TwitchCredentials = { clientId: string; clientSecret: string; source: 'secret' | 'setup' | 'none' };

function get(key: string): string | null {
  return db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get()?.value ?? null;
}

function set(key: string, value: string) {
  db.insert(schema.appSettings)
    .values({ key, value, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: Date.now() } })
    .run();
}

let cache: TwitchCredentials | null = null;

/**
 * Twitch app credentials. Docker secrets / *_FILE (if present) take precedence; otherwise the
 * values entered in the setup wizard, stored AES-256-GCM encrypted in the database.
 */
export function twitchCredentials(): TwitchCredentials {
  if (cache) return cache;
  const id = readSecret('TWITCH_CLIENT_ID');
  const secret = readSecret('TWITCH_CLIENT_SECRET');
  if (id && secret) return (cache = { clientId: id, clientSecret: secret, source: 'secret' });
  const dbId = get('twitch_client_id');
  const dbSecret = get('twitch_client_secret');
  if (dbId && dbSecret) return (cache = { clientId: dbId, clientSecret: decrypt(dbSecret), source: 'setup' });
  return { clientId: '', clientSecret: '', source: 'none' };
}

export const twitchConfigured = () => twitchCredentials().source !== 'none';

export function saveTwitchCredentials(clientId: string, clientSecret: string) {
  set('twitch_client_id', clientId);
  set('twitch_client_secret', encrypt(clientSecret));
  cache = null;
  setupCode = null;
}

// ---- GIPHY: API key entered by the owner in Settings (or a Docker secret), stored encrypted ----
export function giphyKey(): { key: string; source: 'secret' | 'setup' | 'none' } {
  const fromSecret = readSecret('GIPHY_API_KEY');
  if (fromSecret) return { key: fromSecret, source: 'secret' };
  const stored = get('giphy_api_key');
  return stored ? { key: decrypt(stored), source: 'setup' } : { key: '', source: 'none' };
}
export function saveGiphyKey(key: string | null) {
  if (key) set('giphy_api_key', encrypt(key));
  else db.delete(schema.appSettings).where(eq(schema.appSettings.key, 'giphy_api_key')).run();
}

// ---- Discord bot: one shared bot per Lumio instance, set up once by the owner ----
export type DiscordApp = { clientId: string; clientSecret: string; botToken: string; source: 'secret' | 'setup' | 'none' };
let discordCache: DiscordApp | null = null;
export function discordApp(): DiscordApp {
  if (discordCache) return discordCache;
  const id = readSecret('DISCORD_CLIENT_ID');
  const secret = readSecret('DISCORD_CLIENT_SECRET');
  const token = readSecret('DISCORD_BOT_TOKEN');
  if (id && secret && token) return (discordCache = { clientId: id, clientSecret: secret, botToken: token, source: 'secret' });
  const sId = get('discord_client_id');
  const sSecret = get('discord_client_secret');
  const sToken = get('discord_bot_token');
  if (sId && sSecret && sToken) return (discordCache = { clientId: sId, clientSecret: decrypt(sSecret), botToken: decrypt(sToken), source: 'setup' });
  return { clientId: '', clientSecret: '', botToken: '', source: 'none' };
}
export function saveDiscordApp(app: { clientId: string; clientSecret: string; botToken: string } | null) {
  if (app) {
    set('discord_client_id', app.clientId);
    set('discord_client_secret', encrypt(app.clientSecret));
    set('discord_bot_token', encrypt(app.botToken));
  } else {
    for (const k of ['discord_client_id', 'discord_client_secret', 'discord_bot_token']) db.delete(schema.appSettings).where(eq(schema.appSettings.key, k)).run();
  }
  discordCache = null;
}

// ---- owner: the first streamer who logs in after setup may change instance settings ----
export const ownerUserId = () => Number(get('owner_user_id')) || null;
export function claimOwnerIfUnset(userId: number) {
  if (!ownerUserId()) set('owner_user_id', String(userId));
}

// ---- one-time setup code, only shown in the server logs ----
let setupCode: string | null = null;

export function ensureSetupCode(): string | null {
  if (twitchConfigured()) return (setupCode = null);
  if (!setupCode) {
    const raw = randomBytes(6).toString('hex').toUpperCase();
    setupCode = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
  }
  return setupCode;
}

export function checkSetupCode(input: string): boolean {
  if (!setupCode) return false;
  const a = Buffer.from(input.trim().toUpperCase());
  const b = Buffer.from(setupCode);
  return a.length === b.length && timingSafeEqual(a, b);
}
