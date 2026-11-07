import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { db, schema } from '../db/index.js';
import { discordApp } from '../settings.js';
import { avatarUrl, gatewayUrl, getBotUser, memberAvatarCandidates, sendWelcome, type DiscordUser } from './api.js';
import { renderCard } from './card.js';

export type BotStatus = { status: 'off' | 'connecting' | 'connected' | 'error'; botName: string | null; error: string | null; guilds: number; messageContent: boolean; warning: string | null; avatarError: string | null };

const GUILDS = 1;
const GUILD_MEMBERS = 2; // privileged: "Server Members Intent"
const GUILD_MODERATION = 4;
const GUILD_MESSAGES = 512;
const GUILD_MESSAGE_REACTIONS = 1024;
const MESSAGE_CONTENT = 32768; // privileged: "Message Content Intent" (AutoMod, levels)
const FULL_INTENTS = GUILDS | GUILD_MEMBERS | GUILD_MODERATION | GUILD_MESSAGES | GUILD_MESSAGE_REACTIONS | MESSAGE_CONTENT;

export function welcomeMessage(template: string, v: { mention: string; name: string; server: string; count: number }) {
  return template
    .replace(/\{user\}/gi, v.mention)
    .replace(/\{name\}/gi, v.name)
    .replace(/\{server\}/gi, v.server)
    .replace(/\{count\}/gi, String(v.count))
    .slice(0, 1900);
}

/**
 * One Discord Gateway connection for the instance's shared bot. Handles heartbeats, RESUME,
 * RECONNECT / INVALID_SESSION and fatal close codes, and posts welcome images on GUILD_MEMBER_ADD.
 */
export class DiscordBot {
  status: BotStatus = { status: 'off', botName: null, error: null, guilds: 0, messageContent: false, warning: null, avatarError: null };
  /** Gateway events for the feature modules (moderation, roles, levels, ...). */
  readonly events = new EventEmitter();
  private intents = FULL_INTENTS;
  private ws: WebSocket | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private retry: NodeJS.Timeout | null = null;
  private seq: number | null = null;
  private sessionId: string | null = null;
  private resumeUrl: string | null = null;
  private acked = true;
  private stopped = true;
  private attempt = 0;
  private memberCounts = new Map<string, number>();
  private recent = new Map<string, number>();
  /** The bot's global avatar (default look on servers without their own profile). */
  avatarUrl: string | null = null;

  constructor(private log: FastifyBaseLogger) {}

  async start() {
    this.stop();
    if (discordApp().source === 'none') return;
    this.stopped = false;
    this.intents = FULL_INTENTS;
    this.status = { status: 'connecting', botName: null, error: null, guilds: 0, messageContent: false, warning: null, avatarError: null };
    try {
      const url = await gatewayUrl();
      this.connect(url);
    } catch (e) {
      this.fail((e as Error).message);
    }
  }

  stop() {
    this.stopped = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.retry) clearTimeout(this.retry);
    this.heartbeat = this.retry = null;
    this.ws?.removeAllListeners();
    this.ws?.terminate();
    this.ws = null;
    this.seq = this.sessionId = this.resumeUrl = null;
    this.status = { status: 'off', botName: null, error: null, guilds: 0, messageContent: false, warning: null, avatarError: null };
  }

  memberCount(guildId: string) {
    return this.memberCounts.get(guildId) ?? 0;
  }

  private fail(error: string) {
    this.status = { ...this.status, status: 'error', error };
    this.log.warn(`discord bot: ${error}`);
  }

  private connect(base: string) {
    if (this.stopped) return;
    const ws = new WebSocket(`${base.replace(/\/$/, '')}/?v=10&encoding=json`);
    this.ws = ws;
    ws.on('message', (raw) => {
      let p: { op: number; d: any; s: number | null; t: string | null };
      try {
        p = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (p.s != null) this.seq = p.s;
      switch (p.op) {
        case 10: {
          // HELLO: start heartbeating (first beat jittered), then IDENTIFY or RESUME
          const every = p.d.heartbeat_interval as number;
          if (this.heartbeat) clearInterval(this.heartbeat);
          this.acked = true;
          setTimeout(() => this.beat(), Math.random() * every);
          this.heartbeat = setInterval(() => this.beat(), every);
          const token = discordApp().botToken;
          if (this.sessionId) this.send({ op: 6, d: { token, session_id: this.sessionId, seq: this.seq } });
          else this.send({ op: 2, d: { token, intents: this.intents, properties: { os: 'linux', browser: 'waviloop', device: 'waviloop' } } });
          break;
        }
        case 11:
          this.acked = true;
          break;
        case 1:
          this.beat(true);
          break;
        case 7: // RECONNECT
          ws.close(4900, 'reconnect requested');
          break;
        case 9: // INVALID_SESSION
          if (!p.d) this.sessionId = this.seq = null;
          setTimeout(() => ws.close(4900, 'invalid session'), 1000 + Math.random() * 4000);
          break;
        case 0:
          this.dispatch(p.t ?? '', p.d);
          break;
      }
    });
    ws.on('close', (code) => {
      if (this.ws !== ws || this.stopped) return;
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.ws = null;
      if (code === 4004) return this.fail('Discord rejected the bot token. Enter it again under Settings.');
      if (code === 4014) {
        if (this.intents & MESSAGE_CONTENT) {
          // Keep the bot working without message content; AutoMod and levels need it though.
          this.intents &= ~MESSAGE_CONTENT;
          this.sessionId = this.seq = null;
          this.status.warning = 'The "Message Content Intent" is off in the Discord Developer Portal. Welcome messages and roles work, but AutoMod and levels only once you turn it on (Bot → Privileged Gateway Intents).';
          this.retry = setTimeout(async () => this.connect(await gatewayUrl().catch(() => base)), 500);
          return;
        }
        return this.fail('Turn on the "Server Members Intent" under Bot in the Discord Developer Portal and save the token again.');
      }
      if (code === 4010 || code === 4011 || code === 4012 || code === 4013) return this.fail(`Discord closed the connection (code ${code})`);
      this.status.status = 'connecting';
      const delay = Math.min(60_000, 1000 * 2 ** this.attempt++) + Math.random() * 1000;
      this.retry = setTimeout(async () => {
        try {
          this.connect(this.resumeUrl && this.sessionId ? this.resumeUrl : await gatewayUrl());
        } catch (e) {
          this.fail((e as Error).message);
        }
      }, delay);
    });
    ws.on('error', (err) => this.log.warn(`discord gateway error: ${err.message}`));
  }

  private send(payload: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  private beat(force = false) {
    if (!force && !this.acked) {
      // Zombie connection: no ACK for the previous heartbeat.
      this.ws?.close(4901, 'heartbeat timeout');
      return;
    }
    this.acked = false;
    this.send({ op: 1, d: this.seq });
  }

  private dispatch(type: string, d: any) {
    this.events.emit(type, d);
    switch (type) {
      case 'READY':
        this.sessionId = d.session_id;
        this.resumeUrl = d.resume_gateway_url;
        this.attempt = 0;
        this.status = { ...this.status, status: 'connected', botName: d.user?.global_name ?? d.user?.username ?? null, error: null, guilds: d.guilds?.length ?? 0, messageContent: Boolean(this.intents & MESSAGE_CONTENT) };
        if (this.status.messageContent) this.status.warning = null;
        this.avatarUrl = d.user?.id ? avatarUrl({ id: d.user.id, avatar: d.user.avatar ?? null }) : null;
        break;
      case 'RESUMED':
        this.attempt = 0;
        this.status.status = 'connected';
        break;
      case 'GUILD_CREATE':
        this.memberCounts.set(d.id, d.member_count ?? 0);
        db.update(schema.discordGuilds).set({ guildName: d.name, guildIcon: d.icon ?? null, removedAt: null }).where(eq(schema.discordGuilds.guildId, d.id)).run();
        break;
      case 'GUILD_DELETE':
        if (!d.unavailable) {
          // The bot was kicked or left via Discord itself: keep the settings, show it in the dashboard.
          this.memberCounts.delete(d.id);
          db.update(schema.discordGuilds).set({ removedAt: Date.now() }).where(eq(schema.discordGuilds.guildId, d.id)).run();
        }
        break;
      case 'GUILD_MEMBER_ADD':
        this.memberCounts.set(d.guild_id, this.memberCount(d.guild_id) + 1);
        void this.welcome(d.guild_id, d.user as DiscordUser, { memberAvatar: d.avatar ?? null }).catch((e) => this.log.warn(`discord welcome failed: ${(e as Error).message}`));
        break;
    }
  }

  /** Posts the welcome image for a new member (or a test for the streamer). */
  async welcome(guildId: string, user: DiscordUser, opts: { test?: boolean; memberAvatar?: string | null; avatars?: string[] } = {}) {
    const g = db.select().from(schema.discordGuilds).where(eq(schema.discordGuilds.guildId, guildId)).get();
    if (!g || !g.channelId || (!g.enabled && !opts.test) || user.bot) return false;
    const key = `${guildId}:${user.id}`;
    if (!opts.test && Date.now() - (this.recent.get(key) ?? 0) < 60_000) return false;
    this.recent.set(key, Date.now());
    if (this.recent.size > 5000) this.recent.clear();
    const name = user.global_name || user.username;
    const count = this.memberCount(guildId);
    const errors: string[] = [];
    let loaded: string | null = null;
    const png = await renderCard(
      g.card,
      { name, server: g.guildName, count, avatar: opts.avatars ?? memberAvatarCandidates(guildId, user, opts.memberAvatar) },
      (reason) => {
        errors.push(reason);
        this.log.warn({ guildId }, `welcome image: profile picture not loaded (${reason})`);
      },
      (src) => (loaded = src),
    );
    // Shown in the dashboard so the streamer can see why a photo is missing without digging in logs.
    this.status.avatarError = loaded ? null : `Profile picture of ${name} could not be loaded: ${errors.join(' | ') || 'no photo found'}`;
    // A test has no real Discord member to mention.
    const content = welcomeMessage(g.message, { mention: opts.test ? `**${name}**` : `<@${user.id}>`, name, server: g.guildName, count });
    await sendWelcome(g.channelId, content, png, opts.test ? null : user.id);
    db.insert(schema.activity)
      .values({ userId: g.userId, commandName: 'discord:welkom', viewer: name, status: opts.test ? 'test' : 'triggered', detail: g.guildName, createdAt: Date.now() })
      .run();
    return true;
  }

  /** Validates a bot token and returns the bot's user (application id = bot user id). */
  static verify(token: string) {
    return getBotUser(token);
  }
}
