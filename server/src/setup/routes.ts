import type { FastifyInstance } from 'fastify';
import { checkSetupCode, ownerUserId, saveTwitchCredentials, twitchConfigured, twitchCredentials } from '../settings.js';
import { verifyAppCredentials } from '../twitch/api.js';
import { requireUser } from '../auth/session.js';
import type { ChatManager } from '../twitch/manager.js';

type Body = { code?: string; clientId?: string; clientSecret?: string };

const ID_RE = /^[a-zA-Z0-9]{10,64}$/;
const SECRET_RE = /^[a-zA-Z0-9]{10,128}$/;

/** Returns an error to send, or null when the credentials were verified with Twitch and saved. */
async function validateAndSave(body: Body): Promise<{ status: number; error: string } | null> {
  const clientId = (body.clientId ?? '').trim();
  const clientSecret = (body.clientSecret ?? '').trim();
  if (!ID_RE.test(clientId)) return { status: 400, error: 'Ongeldige Client ID' };
  if (!SECRET_RE.test(clientSecret)) return { status: 400, error: 'Ongeldig Client Secret' };
  let ok: boolean;
  try {
    ok = await verifyAppCredentials(clientId, clientSecret);
  } catch (e) {
    return { status: 502, error: (e as Error).message };
  }
  if (!ok) return { status: 400, error: 'Twitch accepteert deze Client ID / Client Secret niet.' };
  saveTwitchCredentials(clientId, clientSecret);
  return null;
}

export async function setupRoutes(app: FastifyInstance, { chat }: { chat: ChatManager }) {
  /** First-run wizard. Guarded by the one-time code printed in the server logs. */
  app.post<{ Body: Body }>(
    '/setup/twitch',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (twitchConfigured()) return reply.code(409).send({ error: 'Twitch is al ingesteld.' });
      if (!checkSetupCode(req.body?.code ?? '')) {
        req.log.warn('setup attempted with wrong setup code');
        return reply.code(403).send({ error: 'Onjuiste setup-code. Je vindt hem in de serverlogs.' });
      }
      const res = await validateAndSave(req.body ?? {});
      if (res) return reply.code(res.status).send({ error: res.error });
      req.log.info('Twitch app credentials saved via setup wizard');
      return { ok: true };
    },
  );

  /** Owner-only: view (never the secret) and rotate the Twitch app credentials. */
  app.register(async (owner) => {
    owner.addHook('preHandler', requireUser);
    owner.addHook('preHandler', async (req, reply) => {
      if (req.user.id !== ownerUserId()) return reply.code(403).send({ error: 'Alleen de eigenaar mag dit wijzigen.' });
    });
    owner.get('/api/admin/twitch-app', async () => {
      const c = twitchCredentials();
      return { source: c.source, clientId: c.clientId, secretSet: Boolean(c.clientSecret) };
    });
    owner.put<{ Body: Body }>(
      '/api/admin/twitch-app',
      { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
      async (req, reply) => {
        if (twitchCredentials().source === 'secret') {
          return reply.code(409).send({ error: 'De gegevens worden beheerd via Docker secrets en kunnen hier niet worden gewijzigd.' });
        }
        const res = await validateAndSave(req.body ?? {});
        if (res) return reply.code(res.status).send({ error: res.error });
        req.log.info({ userId: req.user.id }, 'Twitch app credentials rotated');
        chat.stopAll();
        chat.startAll();
        return { ok: true };
      },
    );
  });
}
