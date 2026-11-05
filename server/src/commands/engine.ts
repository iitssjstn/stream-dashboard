import { and, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { db, schema } from '../db/index.js';
import type { Command } from '../db/schema.js';
import type { ChatMessage, ChatRole } from '../twitch/irc.js';
import type { OverlayHub } from '../overlay/hub.js';

const RANK: Record<string, number> = { everyone: 0, subscriber: 1, vip: 2, moderator: 3, broadcaster: 4 };

function roleRank(roles: Set<ChatRole>): number {
  let r = 0;
  for (const role of roles) r = Math.max(r, RANK[role] ?? 0);
  return r;
}

export function renderText(template: string, vars: { user: string; target: string; channel: string }) {
  return template
    .replace(/\{user\}/gi, vars.user)
    .replace(/\{target\}/gi, vars.target)
    .replace(/\{channel\}/gi, vars.channel)
    .slice(0, 300);
}

export function parseTarget(args: string): string | null {
  const first = args.trim().split(/\s+/)[0] ?? '';
  const clean = first.replace(/^@/, '');
  return /^[a-zA-Z0-9_]{2,25}$/.test(clean) ? clean : null;
}

/**
 * Turns chat messages into overlay events. Stateless apart from in-memory cooldowns
 * and a de-duplication window keyed on Twitch's unique message id.
 */
export class CommandEngine {
  private seen = new Map<string, number>();
  private globalCooldown = new Map<string, number>();
  private userCooldown = new Map<string, number>();
  private cache = new Map<number, Map<string, Command>>();
  private gc: NodeJS.Timeout;

  constructor(
    private hub: OverlayHub,
    private log: FastifyBaseLogger,
  ) {
    this.gc = setInterval(() => this.collect(), 60_000);
  }

  invalidate(userId: number) {
    this.cache.delete(userId);
  }

  private commandsFor(userId: number) {
    let m = this.cache.get(userId);
    if (!m) {
      m = new Map();
      for (const c of db.select().from(schema.commands).where(eq(schema.commands.userId, userId)).all()) m.set(c.name, c);
      this.cache.set(userId, m);
    }
    return m;
  }

  handleChat(userId: number, msg: ChatMessage) {
    if (!msg.text.startsWith('!')) return;
    // Prevent double execution (Twitch can redeliver after reconnects; multiple instances may overlap).
    const dedupeKey = msg.id ? `${userId}:${msg.id}` : null;
    if (dedupeKey) {
      if (this.seen.has(dedupeKey)) return;
      this.seen.set(dedupeKey, Date.now());
    }

    const [rawName, ...rest] = msg.text.slice(1).split(/\s+/);
    const name = (rawName ?? '').toLowerCase();
    if (!name) return;
    const cmd = this.commandsFor(userId).get(name);
    if (!cmd || !cmd.enabled) return;

    const rank = roleRank(msg.roles);
    if (rank < (RANK[cmd.permission] ?? 0)) {
      this.record(userId, cmd.name, msg.displayName, 'denied', `vereist ${cmd.permission}`);
      return;
    }

    const target = cmd.targetMode === 'none' ? null : parseTarget(rest.join(' '));
    if (cmd.targetMode === 'required' && !target) {
      // Checked before cooldowns, so a forgotten name doesn't cost the viewer their cooldown.
      this.record(userId, cmd.name, msg.displayName, 'denied', `geen naam opgegeven (!${cmd.name} @naam)`);
      return;
    }

    const now = Date.now();
    const isBroadcaster = msg.roles.has('broadcaster');
    const gKey = `${userId}:${cmd.id}`;
    const uKey = `${userId}:${cmd.id}:${msg.userId || msg.login}`;
    if (!isBroadcaster) {
      const gUntil = this.globalCooldown.get(gKey) ?? 0;
      const uUntil = this.userCooldown.get(uKey) ?? 0;
      if (now < gUntil || now < uUntil) {
        const left = Math.ceil((Math.max(gUntil, uUntil) - now) / 1000);
        this.record(userId, cmd.name, msg.displayName, 'cooldown', `nog ${left}s`);
        return;
      }
    }
    this.globalCooldown.set(gKey, now + cmd.globalCooldownSec * 1000);
    this.userCooldown.set(uKey, now + cmd.userCooldownSec * 1000);

    this.fire(userId, cmd, msg.displayName, target, msg.channel, 'triggered');
  }

  /** Sends a command to the overlay. Used by chat and by the dashboard's "test" button. */
  fire(userId: number, cmd: Command, viewer: string, target: string | null, channel: string, status: 'triggered' | 'test') {
    const shownUser = cmd.showUsername ? viewer : 'Iemand';
    const text = !cmd.showText ? '' : renderText(cmd.text, { user: shownUser, target: target ?? cmd.targetFallback, channel });
    const res = this.hub.emit(userId, {
      command: cmd.name,
      animation: cmd.animation,
      characterStyle: cmd.characterStyle,
      walkIn: cmd.walkIn,
      imageUrl: cmd.imageUrl,
      soundUrl: cmd.soundUrl,
      soundVolume: cmd.soundVolume,
      text,
      viewer: cmd.showUsername ? viewer : null,
      target,
      durationMs: cmd.durationMs,
      style: cmd.style,
    });
    this.record(userId, cmd.name, viewer, status, res.delivered ? null : 'geen overlay verbonden (in wachtrij)');
    this.log.info({ userId, command: cmd.name, viewer, delivered: res.delivered }, 'command fired');
    return res;
  }

  getCommand(userId: number, id: number) {
    return db
      .select()
      .from(schema.commands)
      .where(and(eq(schema.commands.userId, userId), eq(schema.commands.id, id)))
      .get();
  }

  private record(userId: number, commandName: string, viewer: string, status: string, detail: string | null) {
    db.insert(schema.activity).values({ userId, commandName, viewer, status, detail, createdAt: Date.now() }).run();
  }

  private collect() {
    const now = Date.now();
    for (const [k, t] of this.seen) if (now - t > 10 * 60_000) this.seen.delete(k);
    for (const [k, t] of this.globalCooldown) if (t < now) this.globalCooldown.delete(k);
    for (const [k, t] of this.userCooldown) if (t < now) this.userCooldown.delete(k);
  }

  close() {
    clearInterval(this.gc);
  }
}
