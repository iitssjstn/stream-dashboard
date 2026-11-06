import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { config } from '../config.js';
import { randomToken } from '../crypto.js';
import { currentUser, requireUser } from '../auth/session.js';
import { discordApp, ownerUserId, saveDiscordApp } from '../settings.js';
import type { WelcomeCard } from '../db/schema.js';
import { DiscordError, exchangeBotCode, leaveGuild, modifyCurrentMember, textChannels } from './api.js';
import { avatarDataUri, renderCard } from './card.js';
import { DiscordBot } from './bot.js';

const STATE_COOKIE = 'lumio_discord_state';
/** View Channels + Send Messages + Embed Links + Attach Files + Change Nickname */
const BOT_PERMISSIONS = String(1024 + 2048 + 16384 + 32768 + 67108864);

export const defaultCard = (): WelcomeCard => ({
  background: null,
  title: 'Welkom {name}!',
  subtitle: 'Je bent lid #{count} van {server}',
  accentColor: '#a855f7',
  textColor: '#ffffff',
  dim: 35,
});

const hex = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
const text = (v: unknown, max: number) => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, max);

function validateCard(b: any): WelcomeCard {
  const bg = b?.background;
  if (bg != null && bg !== '' && !(typeof bg === 'string' && (/^\/uploads\/[\w.-]+$/.test(bg) || /^https:\/\/\S{1,490}$/.test(bg)))) {
    throw new DiscordError(400, 'Achtergrond moet een upload of https-URL zijn');
  }
  return {
    background: bg || null,
    title: text(b?.title, 80) || 'Welkom {name}!',
    subtitle: text(b?.subtitle, 120),
    accentColor: hex(b?.accentColor, '#a855f7'),
    textColor: hex(b?.textColor, '#ffffff'),
    dim: Math.max(0, Math.min(90, Math.round(Number(b?.dim) || 0))),
  };
}

export async function discordRoutes(app: FastifyInstance, { bot }: { bot: DiscordBot }) {
  // ---- "Verbind je Discord-server": OAuth2 bot-invite flow ----
  app.get('/auth/discord/connect', async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect(`${config.appUrl}/`);
    const d = discordApp();
    if (d.source === 'none') return reply.redirect(`${config.appUrl}/discord?error=${encodeURIComponent('De Discord-bot is nog niet ingesteld.')}`);
    const state = randomToken(16);
    reply.setCookie(STATE_COOKIE, state, { path: '/auth', httpOnly: true, sameSite: 'lax', secure: config.secureCookies, signed: true, maxAge: 600 });
    const u = new URL(config.discord.authorizeUrl);
    u.searchParams.set('client_id', d.clientId);
    u.searchParams.set('scope', 'bot');
    u.searchParams.set('permissions', BOT_PERMISSIONS);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('redirect_uri', config.discord.redirectUri);
    u.searchParams.set('integration_type', '0');
    u.searchParams.set('state', state);
    return reply.redirect(u.toString());
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>('/auth/discord/callback', async (req, reply) => {
    const back = (msg?: string) => reply.redirect(`${config.appUrl}/discord${msg ? `?error=${encodeURIComponent(msg)}` : '?connected=1'}`);
    const user = currentUser(req);
    const cookie = req.cookies[STATE_COOKIE];
    reply.clearCookie(STATE_COOKIE, { path: '/auth' });
    if (!user) return reply.redirect(`${config.appUrl}/`);
    if (req.query.error) return back(req.query.error_description || 'Discord-koppeling geannuleerd');
    const expected = cookie ? req.unsignCookie(cookie) : null;
    if (!req.query.code || !expected?.valid || expected.value !== req.query.state) return back('Ongeldige Discord-state, probeer opnieuw.');
    try {
      const guild = await exchangeBotCode(req.query.code);
      const existing = db.select().from(schema.discordGuilds).where(eq(schema.discordGuilds.guildId, guild.id)).get();
      if (existing && existing.userId !== user.id) return back('Deze Discord-server is al gekoppeld aan een andere streamer.');
      const now = Date.now();
      if (existing) db.update(schema.discordGuilds).set({ guildName: guild.name, guildIcon: guild.icon, updatedAt: now }).where(eq(schema.discordGuilds.id, existing.id)).run();
      else db.insert(schema.discordGuilds).values({ userId: user.id, guildId: guild.id, guildName: guild.name, guildIcon: guild.icon, card: defaultCard(), createdAt: now, updatedAt: now }).run();
      return back();
    } catch (e) {
      return back((e as Error).message);
    }
  });

  // ---- streamer API ----
  app.register(async (api) => {
    api.addHook('preHandler', requireUser);
    api.setErrorHandler((err, _req, reply) => {
      if (err instanceof DiscordError) return reply.code(err.status >= 500 ? 502 : err.status === 401 ? 502 : 400).send({ error: err.message });
      const e = err as Error & { statusCode?: number };
      if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message });
      app.log.error(err);
      return reply.code(500).send({ error: 'Interne fout' });
    });

    const own = (userId: number, id: number) => db.select().from(schema.discordGuilds).where(and(eq(schema.discordGuilds.id, id), eq(schema.discordGuilds.userId, userId))).get();

    api.get('/api/discord', async (req) => ({
      configured: discordApp().source !== 'none',
      bot: { ...bot.status, avatar: bot.avatarUrl },
      guilds: db
        .select()
        .from(schema.discordGuilds)
        .where(eq(schema.discordGuilds.userId, req.user.id))
        .all()
        .map((g) => ({ ...g, memberCount: bot.memberCount(g.guildId) })),
    }));

    api.get<{ Params: { id: string } }>('/api/discord/guilds/:id/channels', async (req, reply) => {
      const g = own(req.user.id, Number(req.params.id));
      if (!g) return reply.code(404).send({ error: 'Niet gevonden' });
      return textChannels(g.guildId);
    });

    api.put<{ Params: { id: string }; Body: { enabled?: boolean; channelId?: string | null; message?: string; card?: unknown } }>('/api/discord/guilds/:id', async (req, reply) => {
      const g = own(req.user.id, Number(req.params.id));
      if (!g) return reply.code(404).send({ error: 'Niet gevonden' });
      const b = req.body ?? {};
      const channelId = b.channelId ? String(b.channelId) : null;
      if (channelId && !(await textChannels(g.guildId)).some((c) => c.id === channelId)) return reply.code(400).send({ error: 'Kies een tekstkanaal van deze server' });
      const row = db
        .update(schema.discordGuilds)
        .set({ enabled: b.enabled !== false, channelId, message: text(b.message, 500), card: validateCard(b.card), updatedAt: Date.now() })
        .where(eq(schema.discordGuilds.id, g.id))
        .returning()
        .get();
      return row;
    });

    /** The bot's look on this server only: other servers keep their own (or the default) profile. */
    api.put<{ Params: { id: string }; Body: { nick?: string | null; avatar?: string | null; bio?: string | null } }>(
      '/api/discord/guilds/:id/profile',
      { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const g = own(req.user.id, Number(req.params.id));
        if (!g) return reply.code(404).send({ error: 'Niet gevonden' });
        const nick = String(req.body?.nick ?? '').trim().slice(0, 32) || null;
        const bio = String(req.body?.bio ?? '').trim().slice(0, 190) || null;
        const avatarSrc = req.body?.avatar ? String(req.body.avatar) : null;
        if (avatarSrc && !/^\/uploads\/[\w.-]+$/.test(avatarSrc) && !/^https:\/\/\S{1,490}$/.test(avatarSrc)) return reply.code(400).send({ error: 'Kies een geüploade afbeelding' });
        let avatar: string | null = null;
        if (avatarSrc) {
          avatar = await avatarDataUri(avatarSrc);
          if (!avatar) return reply.code(400).send({ error: 'Deze afbeelding kan niet als profielfoto worden gebruikt (PNG, JPG, GIF of WEBP, max 8 MB)' });
        }
        try {
          await modifyCurrentMember(g.guildId, { nick, avatar, bio });
        } catch (e) {
          if (e instanceof DiscordError && e.status === 403) {
            return reply.code(400).send({ error: 'De bot mag zijn profiel op deze server niet aanpassen. Klik op "Verbind je Discord-server" en kies dezelfde server opnieuw om de extra toestemming te geven.' });
          }
          throw e;
        }
        const botProfile = { nick, avatar: avatarSrc, bio };
        db.update(schema.discordGuilds).set({ botProfile, updatedAt: Date.now() }).where(eq(schema.discordGuilds.id, g.id)).run();
        return { ok: true, botProfile };
      },
    );

    api.post<{ Params: { id: string } }>('/api/discord/guilds/:id/test', async (req, reply) => {
      const g = own(req.user.id, Number(req.params.id));
      if (!g) return reply.code(404).send({ error: 'Niet gevonden' });
      if (!g.channelId) return reply.code(400).send({ error: 'Kies eerst een kanaal' });
      await bot.welcome(g.guildId, { id: '0', username: req.user.displayName, global_name: req.user.displayName, avatar: null }, { test: true });
      return { ok: true };
    });

    api.delete<{ Params: { id: string } }>('/api/discord/guilds/:id', async (req, reply) => {
      const g = own(req.user.id, Number(req.params.id));
      if (!g) return reply.code(404).send({ error: 'Niet gevonden' });
      await leaveGuild(g.guildId).catch(() => undefined);
      db.delete(schema.discordGuilds).where(eq(schema.discordGuilds.id, g.id)).run();
      return { ok: true };
    });

    /** Live preview of the welcome image while editing. */
    api.post<{ Body: { card?: unknown; server?: string } }>(
      '/api/discord/preview',
      { config: { rateLimit: { max: 90, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const png = await renderCard(validateCard(req.body?.card), { name: req.user.displayName, server: text(req.body?.server, 80) || 'jouw server', count: 1234, avatar: null });
        return reply.header('cache-control', 'no-store').type('image/png').send(png);
      },
    );

    // ---- owner: one-time bot setup ----
    const ownerOnly = async (req: { user: { id: number } }, reply: any) => {
      if (req.user.id !== ownerUserId()) return reply.code(403).send({ error: 'Alleen de eigenaar mag dit wijzigen.' });
    };
    api.get('/api/admin/discord', { preHandler: ownerOnly }, async () => {
      const d = discordApp();
      return { source: d.source, clientId: d.clientId, redirectUri: config.discord.redirectUri, bot: bot.status };
    });
    api.put<{ Body: { clientId?: string; clientSecret?: string; botToken?: string } }>(
      '/api/admin/discord',
      { preHandler: ownerOnly, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
      async (req, reply) => {
        if (discordApp().source === 'secret') return reply.code(409).send({ error: 'De Discord-gegevens worden beheerd via Docker secrets.' });
        const clientId = String(req.body?.clientId ?? '').trim();
        const clientSecret = String(req.body?.clientSecret ?? '').trim();
        const botToken = String(req.body?.botToken ?? '').trim();
        if (!/^\d{15,25}$/.test(clientId)) return reply.code(400).send({ error: 'Application ID moet een getal zijn (Developer Portal → General Information)' });
        if (!/^[\w-]{16,128}$/.test(clientSecret)) return reply.code(400).send({ error: 'Ongeldig Client Secret' });
        if (!/^[\w.-]{40,120}$/.test(botToken)) return reply.code(400).send({ error: 'Ongeldig bot-token' });
        let me;
        try {
          me = await DiscordBot.verify(botToken);
        } catch (e) {
          return reply.code(400).send({ error: e instanceof DiscordError ? e.message : 'Discord is niet bereikbaar' });
        }
        if (me.id !== clientId) return reply.code(400).send({ error: 'Bot-token hoort niet bij dit Application ID' });
        saveDiscordApp({ clientId, clientSecret, botToken });
        void bot.start();
        req.log.info({ userId: req.user.id }, 'discord bot configured');
        return { ok: true, botName: me.global_name ?? me.username };
      },
    );
    api.delete('/api/admin/discord', { preHandler: ownerOnly }, async () => {
      saveDiscordApp(null);
      bot.stop();
      return { ok: true };
    });
  });
}
