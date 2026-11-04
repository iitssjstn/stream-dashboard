import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { db, schema } from '../db/index.js';
import { TwitchChatConnection } from './chat.js';
import { getAccessToken } from './tokens.js';
import type { ChatMessage } from './irc.js';

type Handler = (userId: number, msg: ChatMessage) => void;

/**
 * Owns exactly one chat connection per streamer. Runs server-side and independently
 * of any dashboard session, so commands keep working while the dashboard is closed.
 */
export class ChatManager {
  private conns = new Map<number, TwitchChatConnection>();

  constructor(
    private log: FastifyBaseLogger,
    private onMessage: Handler,
  ) {}

  startAll() {
    const all = db.select().from(schema.users).where(eq(schema.users.chatEnabled, true)).all();
    for (const u of all) this.ensure(u.id);
  }

  ensure(userId: number) {
    const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    if (!user || !user.chatEnabled) return this.stop(userId);
    const existing = this.conns.get(userId);
    if (existing) return existing;
    const conn = new TwitchChatConnection({
      channel: user.login,
      login: user.login,
      getToken: (force) => getAccessToken(userId, force),
      log: (level, msg) => this.log[level]({ userId }, msg),
    });
    conn.on('message', (m) => {
      // Only accept messages for this streamer's own channel.
      if (m.channel === user.login) this.onMessage(userId, m);
    });
    this.conns.set(userId, conn);
    conn.start();
    return conn;
  }

  restart(userId: number) {
    this.stop(userId);
    this.ensure(userId);
  }

  stop(userId: number) {
    this.conns.get(userId)?.stop();
    this.conns.delete(userId);
  }

  status(userId: number) {
    const c = this.conns.get(userId);
    if (!c) return { status: 'disconnected' as const, lastError: null, connectedAt: null };
    return { status: c.status, lastError: c.lastError, connectedAt: c.connectedAt };
  }

  stopAll() {
    for (const id of [...this.conns.keys()]) this.stop(id);
  }
}
