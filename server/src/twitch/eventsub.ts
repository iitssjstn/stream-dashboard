import WebSocket from 'ws';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { getAccessToken } from './tokens.js';
import { createEventSubSubscription } from './api.js';
import type { AlertEvent } from '../commands/engine.js';

/** EventSub subscriptions used for alerts, with the scope each one needs. */
const SUBSCRIPTIONS: { type: string; version: string; scope: string | null; condition: (id: string) => Record<string, string> }[] = [
  { type: 'channel.follow', version: '2', scope: 'moderator:read:followers', condition: (id) => ({ broadcaster_user_id: id, moderator_user_id: id }) },
  { type: 'channel.subscribe', version: '1', scope: 'channel:read:subscriptions', condition: (id) => ({ broadcaster_user_id: id }) },
  { type: 'channel.subscription.message', version: '1', scope: 'channel:read:subscriptions', condition: (id) => ({ broadcaster_user_id: id }) },
  { type: 'channel.subscription.gift', version: '1', scope: 'channel:read:subscriptions', condition: (id) => ({ broadcaster_user_id: id }) },
  { type: 'channel.cheer', version: '1', scope: 'bits:read', condition: (id) => ({ broadcaster_user_id: id }) },
  { type: 'channel.raid', version: '1', scope: null, condition: (id) => ({ to_broadcaster_user_id: id }) },
];

export const ALERT_SCOPES = ['moderator:read:followers', 'channel:read:subscriptions', 'bits:read'];

const tier = (t: unknown) => (t === '2000' ? '2' : t === '3000' ? '3' : '1');

/** Maps an EventSub notification to an alert, or null when it should not alert by itself. */
export function toAlert(type: string, e: any, messageId: string): AlertEvent | null {
  switch (type) {
    case 'channel.follow':
      return { type: 'follow', id: messageId, user: e.user_name };
    case 'channel.subscribe':
      // Gifted subs are announced once via channel.subscription.gift instead of once per recipient.
      return e.is_gift ? null : { type: 'subscriber', id: messageId, user: e.user_name, tier: tier(e.tier), amount: 1, months: 1 };
    case 'channel.subscription.message':
      return { type: 'resub', id: messageId, user: e.user_name, tier: tier(e.tier), months: e.cumulative_months ?? 1, amount: e.cumulative_months ?? 1, message: e.message?.text ?? '' };
    case 'channel.subscription.gift':
      return { type: 'gift', id: messageId, user: e.is_anonymous ? 'Anoniem' : e.user_name, amount: e.total ?? 1, tier: tier(e.tier) };
    case 'channel.cheer':
      return { type: 'cheer', id: messageId, user: e.is_anonymous ? 'Anoniem' : e.user_name, amount: e.bits ?? 0, message: e.message ?? '' };
    case 'channel.raid':
      return { type: 'raid', id: messageId, user: e.from_broadcaster_user_name, amount: e.viewers ?? 0 };
    default:
      return null;
  }
}

export type EventSubStatus = { status: 'off' | 'connecting' | 'connected' | 'error'; subscribed: string[]; missingScopes: string[]; lastError: string | null };

/** One EventSub WebSocket per streamer, with keepalive watchdog, reconnect URLs and backoff. */
class EventSubConnection {
  status: EventSubStatus = { status: 'off', subscribed: [], missingScopes: [], lastError: null };
  private ws: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private watchdog: NodeJS.Timeout | null = null;
  private retry: NodeJS.Timeout | null = null;
  private lastMessage = 0;
  private keepaliveSec = 10;

  constructor(
    private userId: number,
    private onAlert: (userId: number, ev: AlertEvent) => void,
    private log: FastifyBaseLogger,
  ) {}

  start() {
    this.stopped = false;
    this.connect(config.twitch.eventSubUrl, true);
  }

  stop() {
    this.stopped = true;
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.retry) clearTimeout(this.retry);
    this.ws?.removeAllListeners();
    this.ws?.terminate();
    this.ws = null;
    this.status.status = 'off';
  }

  private connect(url: string, subscribe: boolean) {
    if (this.stopped) return;
    this.status.status = 'connecting';
    const ws = new WebSocket(url);
    const previous = this.ws;
    this.ws = ws;
    ws.on('message', (raw) => {
      this.lastMessage = Date.now();
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const kind = msg?.metadata?.message_type;
      if (kind === 'session_welcome') {
        this.keepaliveSec = msg.payload.session.keepalive_timeout_seconds ?? 10;
        this.attempt = 0;
        this.status.status = 'connected';
        this.status.lastError = null;
        // After a session_reconnect the existing subscriptions move along; only subscribe on a fresh session.
        if (previous && previous !== ws) {
          previous.removeAllListeners();
          previous.close();
        }
        if (subscribe) void this.subscribe(msg.payload.session.id);
        this.armWatchdog();
      } else if (kind === 'notification') {
        const ev = toAlert(msg.metadata.subscription_type, msg.payload.event, msg.metadata.message_id);
        if (ev) this.onAlert(this.userId, ev);
      } else if (kind === 'session_reconnect') {
        this.connect(msg.payload.session.reconnect_url, false);
      } else if (kind === 'revocation') {
        this.status.lastError = `Twitch heeft ${msg.metadata.subscription_type} ingetrokken (${msg.payload?.subscription?.status})`;
      }
    });
    ws.on('close', () => {
      if (this.ws !== ws || this.stopped) return;
      this.ws = null;
      this.status.status = 'connecting';
      this.scheduleRetry();
    });
    ws.on('error', (err) => {
      this.status.lastError = err.message;
      this.log.warn({ userId: this.userId }, `eventsub socket error: ${err.message}`);
    });
  }

  private armWatchdog() {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = setInterval(() => {
      if (Date.now() - this.lastMessage > (this.keepaliveSec + 10) * 1000) this.ws?.terminate();
    }, 5000);
  }

  private scheduleRetry() {
    if (this.stopped) return;
    const delay = Math.min(60_000, 1000 * 2 ** this.attempt++) + Math.random() * 500;
    this.retry = setTimeout(() => this.connect(config.twitch.eventSubUrl, true), delay);
  }

  private async subscribe(sessionId: string) {
    const user = db.select().from(schema.users).where(eq(schema.users.id, this.userId)).get();
    if (!user) return;
    const scopes = new Set(user.scopes.split(' '));
    this.status.missingScopes = ALERT_SCOPES.filter((s) => !scopes.has(s));
    this.status.subscribed = [];
    try {
      const token = await getAccessToken(this.userId);
      for (const s of SUBSCRIPTIONS) {
        if (s.scope && !scopes.has(s.scope)) continue;
        try {
          await createEventSubSubscription(token, { type: s.type, version: s.version, condition: s.condition(user.twitchId), transport: { method: 'websocket', session_id: sessionId } });
          this.status.subscribed.push(s.type);
        } catch (e) {
          this.status.lastError = (e as Error).message;
          this.log.warn({ userId: this.userId, type: s.type }, (e as Error).message);
        }
      }
    } catch (e) {
      this.status.status = 'error';
      this.status.lastError = (e as Error).message;
    }
  }
}

export class EventSubManager {
  private conns = new Map<number, EventSubConnection>();

  constructor(
    private log: FastifyBaseLogger,
    private onAlert: (userId: number, ev: AlertEvent) => void,
  ) {}

  startAll() {
    for (const u of db.select().from(schema.users).where(eq(schema.users.chatEnabled, true)).all()) this.ensure(u.id);
  }

  ensure(userId: number) {
    if (this.conns.has(userId)) return;
    const c = new EventSubConnection(userId, this.onAlert, this.log);
    this.conns.set(userId, c);
    c.start();
  }

  restart(userId: number) {
    this.stop(userId);
    this.ensure(userId);
  }

  stop(userId: number) {
    this.conns.get(userId)?.stop();
    this.conns.delete(userId);
  }

  status(userId: number): EventSubStatus {
    return this.conns.get(userId)?.status ?? { status: 'off', subscribed: [], missingScopes: [], lastError: null };
  }

  stopAll() {
    for (const id of [...this.conns.keys()]) this.stop(id);
  }
}
