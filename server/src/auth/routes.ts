import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { config } from '../config.js';
import { decrypt, encrypt, randomToken } from '../crypto.js';
import { authorizeUrl, exchangeCode, getUser, revokeToken } from '../twitch/api.js';
import { createSession, currentUser, destroySession } from './session.js';
import { DEFAULT_COMMANDS } from '../commands/defaults.js';
import type { ChatManager } from '../twitch/manager.js';
import type { EventSubManager } from '../twitch/eventsub.js';
import { seedDefaultAlerts } from '../commands/seed.js';
import { claimOwnerIfUnset, twitchConfigured } from '../settings.js';

const STATE_COOKIE = 'lumio_oauth_state';

export { twitchConfigured };

export async function authRoutes(app: FastifyInstance, opts: { chat: ChatManager; eventsub: EventSubManager }) {
  app.get('/auth/twitch/login', async (req, reply) => {
    if (!twitchConfigured()) {
      return reply
        .code(500)
        .type('text/plain; charset=utf-8')
        .send('Twitch is nog niet ingesteld. Open de startpagina en doorloop de setup.');
    }
    const state = randomToken(16);
    reply.setCookie(STATE_COOKIE, state, {
      path: '/auth',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookies,
      signed: true,
      maxAge: 600,
    });
    return reply.redirect(authorizeUrl(state));
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>(
    '/auth/twitch/callback',
    async (req, reply) => {
      const { code, state, error, error_description } = req.query;
      const cookie = req.cookies[STATE_COOKIE];
      reply.clearCookie(STATE_COOKIE, { path: '/auth' });
      if (error) return reply.redirect(`${config.appUrl}/?error=${encodeURIComponent(error_description || error)}`);
      const expected = cookie ? req.unsignCookie(cookie) : null;
      if (!code || !state || !expected?.valid || expected.value !== state) {
        return reply.redirect(`${config.appUrl}/?error=${encodeURIComponent('Ongeldige OAuth-state, probeer opnieuw.')}`);
      }

      const tokens = await exchangeCode(code);
      const tw = await getUser(tokens.access_token);
      const now = Date.now();
      const values = {
        login: tw.login,
        displayName: tw.display_name,
        profileImageUrl: tw.profile_image_url,
        accessToken: encrypt(tokens.access_token),
        refreshToken: encrypt(tokens.refresh_token),
        tokenExpiresAt: now + tokens.expires_in * 1000,
        scopes: (tokens.scope ?? []).join(' '),
        authError: null,
        updatedAt: now,
      };
      const existing = db.select().from(schema.users).where(eq(schema.users.twitchId, tw.id)).get();
      let userId: number;
      if (existing) {
        db.update(schema.users).set(values).where(eq(schema.users.id, existing.id)).run();
        userId = existing.id;
      } else {
        const row = db
          .insert(schema.users)
          .values({ ...values, twitchId: tw.id, overlayToken: randomToken(24), createdAt: now })
          .returning()
          .get();
        userId = row.id;
        for (const c of DEFAULT_COMMANDS) {
          db.insert(schema.commands)
            .values({ ...c, userId, createdAt: now, updatedAt: now })
            .run();
        }
      }
      claimOwnerIfUnset(userId);
      createSession(reply, userId);
      seedDefaultAlerts(userId);
      opts.chat.restart(userId);
      opts.eventsub.restart(userId);
      return reply.redirect(`${config.appUrl}/dashboard`);
    },
  );

  app.get('/auth/status', async (req) => ({
    twitchConfigured: twitchConfigured(),
    setupRequired: !twitchConfigured(),
    redirectUri: config.twitch.redirectUri,
    loggedIn: Boolean(currentUser(req)),
  }));

  app.post('/auth/logout', async (req, reply) => {
    destroySession(req, reply);
    return { ok: true };
  });

  /** Fully disconnects Twitch: revokes the token and stops listening to chat. */
  app.post('/auth/disconnect', async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.code(401).send({ error: 'Niet ingelogd' });
    opts.chat.stop(user.id);
    opts.eventsub.stop(user.id);
    await revokeToken(decrypt(user.accessToken));
    db.update(schema.users).set({ chatEnabled: false, authError: 'Twitch ontkoppeld' }).where(eq(schema.users.id, user.id)).run();
    destroySession(req, reply);
    return { ok: true };
  });
}
