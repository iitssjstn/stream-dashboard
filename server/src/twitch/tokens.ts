import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { decrypt, encrypt } from '../crypto.js';
import { refreshAccessToken, TwitchAuthError, type TokenResponse } from './api.js';

const inflight = new Map<number, Promise<string>>();

export function storeTokens(userId: number, t: TokenResponse) {
  db.update(schema.users)
    .set({
      accessToken: encrypt(t.access_token),
      refreshToken: encrypt(t.refresh_token),
      tokenExpiresAt: Date.now() + t.expires_in * 1000,
      scopes: (t.scope ?? []).join(' '),
      authError: null,
      updatedAt: Date.now(),
    })
    .where(eq(schema.users.id, userId))
    .run();
}

/** Returns a valid access token, refreshing it first when it is (nearly) expired or `force` is set. */
export async function getAccessToken(userId: number, force = false): Promise<string> {
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user) throw new Error(`Unknown user ${userId}`);
  if (!force && user.tokenExpiresAt - Date.now() > 5 * 60_000) return decrypt(user.accessToken);

  // Deduplicate concurrent refreshes: Twitch refresh tokens may be single use.
  const existing = inflight.get(userId);
  if (existing) return existing;
  const p = (async () => {
    try {
      const t = await refreshAccessToken(decrypt(user.refreshToken));
      storeTokens(userId, t);
      return t.access_token;
    } catch (err) {
      if (err instanceof TwitchAuthError) {
        db.update(schema.users)
          .set({ authError: 'Twitch connection expired. Log in again to restore it.' })
          .where(eq(schema.users.id, userId))
          .run();
      }
      throw err;
    } finally {
      inflight.delete(userId);
    }
  })();
  inflight.set(userId, p);
  return p;
}
