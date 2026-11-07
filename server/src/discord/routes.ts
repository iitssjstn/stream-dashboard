import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { config } from '../config.js';
import { randomToken } from '../crypto.js';
import { currentUser, requireUser } from '../auth/session.js';
import { discordApp, ownerUserId, saveDiscordApp } from '../settings.js';
import type { WelcomeCard } from '../db/schema.js';
import { defaultAvatarUrl, DiscordError, exchangeBotCode, leaveGuild, modifyCurrentMember, textChannels } from './api.js';
import { avatarDataUri, renderCard } from './card.js';
import { DiscordBot } from './bot.js';

const STATE_COOKIE = 'lumio_discord_state';
/**
 * Everything the bot's features need, asked once when a server is added:
 * welcome, profile, moderation (kick/ban/timeout/delete), roles, tickets (channels) and logs.
 */
const P = {
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  MANAGE_CHANNELS: 1n << 4n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  CHANGE_NICKNAME: 1n << 26n,
  MANAGE_ROLES: 1n << 28n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  MODERATE_MEMBERS: 1n << 40n,
};
const BOT_PERMISSIONS = String(Object.values(P).reduce((a, b) => a | b, 0n));

export const defaultCard = (locale = 'en'): WelcomeCard => ({
  background: null,
  title: locale === 'nl' ? 'Welkom {name}!' : 'Welcome {name}!',
  subtitle: locale === 'nl' ? 'Je bent lid #{count} van {server}' : 'You are member #{count} of {server}',
  accentColor: '#a855f7',
  textColor: '#ffffff',
  dim: 35,
});

const hex = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
const text = (v: unknown, max: number) => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, max);
/** Discord messages may span several lines; keep at most two empty lines in a row. */
const multiline = (v: unknown, max: number) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, max);

function validateCard(b: any): WelcomeCard {
  const bg = b?.background;
  if (bg != null && bg !== '' && !(typeof bg === 'string' && (/^\/uploads\/[\w.-]+$/.test(bg) || /^https:\/\/\S{1,490}$/.test(bg)))) {
    throw new DiscordError(400, 'Background must be an upload or https URL');
  }
  return {
    background: bg || null,
    title: text(b?.title, 80) || 'Welcome {name}!',
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
    if (d.source === 'none') return reply.redirect(`${config.appUrl}/discord?error=${encodeURIComponent('The Discord bot has not been set up yet.')}`);
    const state = randomToken(16);
    reply.setCookie(STATE_COOKIE, state, { path: '/auth', httpOnly: true, sameSite: 'lax', secure: config.secureCookies, signed: true, maxAge: 600 });
    const u = new URL(config.discord.authorizeUrl);
    u.searchParams.set('client_id', d.clientId);
    u.searchParams.set('scope', 'bot applications.commands');
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
    if (req.query.error) return back(req.query.error_description || 'Discord connection cancelled');
    const expected = cookie ? req.unsignCookie(cookie) : null;
    if (!req.query.code || !expected?.valid || expected.value !== req.query.state) return back('Invalid Discord state, please try again.');
    try {
      const guild = await exchangeBotCode(req.query.code);
      const existing = db.select().from(schema.discordGuilds).where(eq(schema.discordGuilds.guildId, guild.id)).get();
      if (existing && existing.userId !== user.id) return back('This Discord server is already connected to another streamer.');
      const now = Date.now();
      if (existing) db.update(schema.discordGuilds).set({ guildName: guild.name, guildIcon: guild.icon, removedAt: null, updatedAt: now }).where(eq(schema.discordGuilds.id, existing.id)).run();
      else db.insert(schema.discordGuilds).values({ userId: user.id, guildId: guild.id, guildName: guild.name, guildIcon: guild.icon, card: defaultCard(user.locale), message: user.locale === 'nl' ? 'Welkom {user} in {server}! 🎉' : 'Welcome {user} to {server}! 🎉', createdAt: now, updatedAt: now }).run();
      return reply.redirect(`${config.appUrl}/discord?connected=1&server=${encodeURIComponent(guild.id)}`);
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
      return reply.code(500).send({ error: 'Internal error' });
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
      if (!g) return reply.code(404).send({ error: 'Not found' });
      return textChannels(g.guildId);
    });

    api.put<{ Params: { id: string }; Body: { enabled?: boolean; channelId?: string | null; message?: string; card?: unknown } }>('/api/discord/guilds/:id', async (req, reply) => {
      const g = own(req.user.id, Number(req.params.id));
      if (!g) return reply.code(404).send({ error: 'Not found' });
      const b = req.body ?? {};
      const channelId = b.channelId ? String(b.channelId) : null;
      if (channelId && !(await textChannels(g.guildId)).some((c) => c.id === channelId)) return reply.code(400).send({ error: 'Choose a text channel of this server' });
      const row = db
        .update(schema.discordGuilds)
        .set({ enabled: b.enabled !== false, channelId, message: multiline(b.message, 1500), card: validateCard(b.card), updatedAt: Date.now() })
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
        if (!g) return reply.code(404).send({ error: 'Not found' });
        const nick = String(req.body?.nick ?? '').trim().slice(0, 32) || null;
        const bio = String(req.body?.bio ?? '').trim().slice(0, 190) || null;
        const avatarSrc = req.body?.avatar ? String(req.body.avatar) : null;
        if (avatarSrc && !/^\/uploads\/[\w.-]+$/.test(avatarSrc) && !/^https:\/\/\S{1,490}$/.test(avatarSrc)) return reply.code(400).send({ error: 'Choose an uploaded image' });
        let avatar: string | null = null;
        if (avatarSrc) {
          avatar = await avatarDataUri(avatarSrc);
          if (!avatar) return reply.code(400).send({ error: 'This image cannot be used as a profile picture (PNG, JPG, GIF or WEBP, max 8 MB)' });
        }
        try {
          await modifyCurrentMember(g.guildId, { nick, avatar, bio });
        } catch (e) {
          if (e instanceof DiscordError && e.status === 403) {
            return reply.code(400).send({ error: 'The bot may not change its profile on this server. Click "Add server" and choose the same server again to grant the extra permission.' });
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
      if (!g) return reply.code(404).send({ error: 'Not found' });
      if (!g.channelId) return reply.code(400).send({ error: 'Choose a channel first' });
      // The test uses the streamer's own (Twitch) profile photo, so the image looks like the real thing.
      const ownPhoto = req.user.profileImageUrl && /^https:\/\/static-cdn\.jtvnw\.net\//.test(req.user.profileImageUrl) ? [req.user.profileImageUrl] : [];
      await bot.welcome(g.guildId, { id: '0', username: req.user.displayName, global_name: req.user.displayName, avatar: null }, { test: true, avatars: [...ownPhoto, defaultAvatarUrl('0')] });
      return { ok: true };
    });

    api.delete<{ Params: { id: string } }>('/api/discord/guilds/:id', async (req, reply) => {
      const g = own(req.user.id, Number(req.params.id));
      if (!g) return reply.code(404).send({ error: 'Not found' });
      await leaveGuild(g.guildId).catch(() => undefined);
      db.delete(schema.discordGuilds).where(eq(schema.discordGuilds.id, g.id)).run();
      return { ok: true };
    });

    /** Live preview of the welcome image while editing. */
    api.post<{ Body: { card?: unknown; server?: string } }>(
      '/api/discord/preview',
      { config: { rateLimit: { max: 90, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const png = await renderCard(validateCard(req.body?.card), { name: req.user.displayName, server: text(req.body?.server, 80) || (req.user.locale === 'nl' ? 'jouw server' : 'your server'), count: 1234, avatar: null });
        return reply.header('cache-control', 'no-store').type('image/png').send(png);
      },
    );

    // ---- owner: one-time bot setup ----
    const ownerOnly = async (req: { user: { id: number } }, reply: any) => {
      if (req.user.id !== ownerUserId()) return reply.code(403).send({ error: 'Only the owner can change this.' });
    };
    api.get('/api/admin/discord', { preHandler: ownerOnly }, async () => {
      const d = discordApp();
      return { source: d.source, clientId: d.clientId, redirectUri: config.discord.redirectUri, bot: bot.status };
    });
    api.put<{ Body: { clientId?: string; clientSecret?: string; botToken?: string } }>(
      '/api/admin/discord',
      { preHandler: ownerOnly, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
      async (req, reply) => {
        if (discordApp().source === 'secret') return reply.code(409).send({ error: 'The Discord credentials are managed via Docker secrets.' });
        const clientId = String(req.body?.clientId ?? '').trim();
        const clientSecret = String(req.body?.clientSecret ?? '').trim();
        const botToken = String(req.body?.botToken ?? '').trim();
        if (!/^\d{15,25}$/.test(clientId)) return reply.code(400).send({ error: 'Application ID must be a number (Developer Portal → General Information)' });
        if (!/^[\w-]{16,128}$/.test(clientSecret)) return reply.code(400).send({ error: 'Invalid Client Secret' });
        if (!/^[\w.-]{40,120}$/.test(botToken)) return reply.code(400).send({ error: 'Invalid bot token' });
        let me;
        try {
          me = await DiscordBot.verify(botToken);
        } catch (e) {
          return reply.code(400).send({ error: e instanceof DiscordError ? e.message : 'Discord is unreachable' });
        }
        if (me.id !== clientId) return reply.code(400).send({ error: 'Bot token does not belong to this Application ID' });
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
