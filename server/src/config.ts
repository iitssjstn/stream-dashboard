import { randomBytes } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable ${name}`);
  }
  return v;
}

/**
 * Reads a secret without requiring it to be in the environment. Lookup order:
 *  1. file named by <NAME>_FILE
 *  2. Docker / compose secret at /run/secrets/<name> (lowercase)
 *  3. plain environment variable (only meant for local development)
 */
export function readSecret(name: string): string {
  const candidates = [process.env[`${name}_FILE`], path.join(process.env.SECRETS_DIR ?? '/run/secrets', name.toLowerCase())];
  for (const file of candidates) {
    if (!file || !fs.existsSync(file)) continue;
    try {
      return fs.readFileSync(file, 'utf8').trim();
    } catch (err) {
      throw new Error(`Cannot read secret ${name} from ${file} (${(err as NodeJS.ErrnoException).code}). The container runs as uid 1000: chown 1000:1000 the file.`);
    }
  }
  return process.env[name]?.trim() ?? '';
}

const dataDir = path.resolve(env('DATA_DIR', './data'));
fs.mkdirSync(dataDir, { recursive: true });

/**
 * Secret used to encrypt Twitch tokens at rest. When not provided we generate one once
 * and persist it inside the data dir so tokens survive restarts.
 */
function loadSecret(): Buffer {
  const fromEnv = readSecret('TOKEN_ENCRYPTION_KEY');
  if (fromEnv) {
    const buf = Buffer.from(fromEnv, 'base64');
    if (buf.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded');
    return buf;
  }
  const file = path.join(dataDir, '.secret');
  if (fs.existsSync(file)) return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
  const key = randomBytes(32);
  fs.writeFileSync(file, key.toString('base64'), { mode: 0o600 });
  return key;
}

const publicUrl = env('PUBLIC_URL', 'http://localhost:3000').replace(/\/$/, '');

export const config = {
  port: Number(env('PORT', '3000')),
  host: env('HOST', '0.0.0.0'),
  publicUrl,
  /** Where the dashboard lives (differs from publicUrl only during `vite` dev). */
  appUrl: env('APP_URL', publicUrl).replace(/\/$/, ''),
  secureCookies: publicUrl.startsWith('https://'),
  dataDir,
  uploadDir: path.join(dataDir, 'uploads'),
  dbFile: path.join(dataDir, 'lumio.sqlite'),
  encryptionKey: loadSecret(),
  twitch: {
    redirectUri: env('TWITCH_REDIRECT_URI', `${publicUrl}/auth/twitch/callback`),
    /** Overridable so the full chain can be exercised against a local Twitch-compatible test server. */
    idBase: env('TWITCH_ID_BASE', 'https://id.twitch.tv'),
    apiBase: env('TWITCH_API_BASE', 'https://api.twitch.tv'),
    ircUrl: env('TWITCH_IRC_URL', 'wss://irc-ws.chat.twitch.tv:443'),
    eventSubUrl: env('TWITCH_EVENTSUB_URL', 'wss://eventsub.wss.twitch.tv/ws'),
    scopes: ['chat:read', 'chat:edit', 'user:read:email', 'moderator:read:followers', 'channel:read:subscriptions', 'bits:read'],
  },
  giphy: {
    /** Overridable for tests. */
    apiBase: env('GIPHY_API_BASE', 'https://api.giphy.com'),
  },
  /** StreamElements API (overridable for tests). */
  streamElementsApi: env('SE_API_BASE', 'https://api.streamelements.com/kappa/v2'),
  /** Length of one timer "minute" in ms. Only shortened by the end-to-end test. */
  timerMinuteMs: Number(env('TIMER_MINUTE_MS', '60000')),
  webDist: path.resolve(env('WEB_DIST', '../web/dist')),
};

fs.mkdirSync(config.uploadDir, { recursive: true });
