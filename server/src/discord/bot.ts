import WebSocket from 'ws';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { db, schema } from '../db/index.js';
import { discordApp } from '../settings.js';
import { avatarUrl, gatewayUrl, getBotUser, sendWelcome, type DiscordUser } from './api.js';
import { renderCard } from './card.js';

export type BotStatus = { status: 'off' | 'connecting' | 'connected' | 'error'; botName: string | null; error: string | null; guilds: number };

const INTENTS = 1 /* GUILDS */ | 2; /* GUILD_MEMBERS (privileged: "Server Members Intent") */

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
  status: BotStatus = { status: 'off', botName: null, error: null, guilds: 0 };
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

  constructor(private log: FastifyBaseLogger) {}

  async start() {
    this.stop();
    if (discordApp().source === 'none') return;
    this.stopped = false;
    this.status = { status: 'connecting', botName: null, error: null, guilds: 0 };
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
    this.status = { status: 'off', botName: null, error: null, guilds: 0 };
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
          else this.send({ op: 2, d: { token, intents: INTENTS, properties: { os: 'linux', browser: 'lumio', device: 'lumio' } } });
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
      if (code === 4004) return this.fail('Discord weigert het bot-token. Vul het opnieuw in onder Instellingen.');
      if (code === 4014) return this.fail('Zet in het Discord Developer Portal bij Bot de "Server Members Intent" aan en sla het token opnieuw op.');
      if (code === 4010 || code === 4011 || code === 4012 || code === 4013) return this.fail(`Discord sloot de verbinding (code ${code})`);
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
    switch (type) {
      case 'READY':
        this.sessionId = d.session_id;
        this.resumeUrl = d.resume_gateway_url;
        this.attempt = 0;
        this.status = { status: 'connected', botName: d.user?.global_name ?? d.user?.username ?? null, error: null, guilds: d.guilds?.length ?? 0 };
        break;
      case 'RESUMED':
        this.attempt = 0;
        this.status.status = 'connected';
        break;
      case 'GUILD_CREATE':
        this.memberCounts.set(d.id, d.member_count ?? 0);
        db.update(schema.discordGuilds).set({ guildName: d.name, guildIcon: d.icon ?? null }).where(eq(schema.discordGuilds.guildId, d.id)).run();
        break;
      case 'GUILD_DELETE':
        if (!d.unavailable) this.memberCounts.delete(d.id);
        break;
      case 'GUILD_MEMBER_ADD':
        this.memberCounts.set(d.guild_id, this.memberCount(d.guild_id) + 1);
        void this.welcome(d.guild_id, d.user as DiscordUser);
        break;
    }
  }

  /** Posts the welcome image for a new member (or a test for the streamer). */
  async welcome(guildId: string, user: DiscordUser, opts: { test?: boolean } = {}) {
    const g = db.select().from(schema.discordGuilds).where(eq(schema.discordGuilds.guildId, guildId)).get();
    if (!g || !g.channelId || (!g.enabled && !opts.test) || user.bot) return false;
    const key = `${guildId}:${user.id}`;
    if (!opts.test && Date.now() - (this.recent.get(key) ?? 0) < 60_000) return false;
    this.recent.set(key, Date.now());
    if (this.recent.size > 5000) this.recent.clear();
    const name = user.global_name || user.username;
    const count = this.memberCount(guildId);
    const png = await renderCard(g.card, { name, server: g.guildName, count, avatar: avatarUrl(user) });
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
