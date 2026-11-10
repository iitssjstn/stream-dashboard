import { and, eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { db, schema } from '../db/index.js';
import type { Command } from '../db/schema.js';
import type { ChatMessage, ChatRole } from '../twitch/irc.js';
import type { OverlayHub } from '../overlay/hub.js';
import type { Trigger } from './defaults.js';

const RANK: Record<string, number> = { everyone: 0, subscriber: 1, vip: 2, moderator: 3, broadcaster: 4 };

function roleRank(roles: Set<ChatRole>): number {
  let r = 0;
  for (const role of roles) r = Math.max(r, RANK[role] ?? 0);
  return r;
}

export type TemplateVars = {
  user: string;
  target: string;
  channel: string;
  count?: number;
  args?: string;
  amount?: number;
  message?: string;
  tier?: string;
  months?: number;
};

/** Fills {user} {target} {channel} {count} {args} {random:1-100} {amount} {message} {tier} {months}. */
export function renderText(template: string, v: TemplateVars, max = 300) {
  return template
    .replace(/\{target\}/gi, v.target)
    .replace(/\{user\}/gi, v.user)
    .replace(/\{channel\}/gi, v.channel)
    .replace(/\{count\}/gi, String(v.count ?? 0))
    .replace(/\{args\}/gi, v.args ?? '')
    .replace(/\{amount\}/gi, String(v.amount ?? 0))
    .replace(/\{message\}/gi, v.message ?? '')
    .replace(/\{tier\}/gi, v.tier ?? '1')
    .replace(/\{months\}/gi, String(v.months ?? 1))
    .replace(/\{random:(-?\d{1,9})-(-?\d{1,9})\}/gi, (_, a: string, b: string) => {
      const [lo, hi] = [Math.min(+a, +b), Math.max(+a, +b)];
      return String(lo + Math.floor(Math.random() * (hi - lo + 1)));
    })
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Chat replies must never start a Twitch chat command (except /me); viewers control {args}. */
export function safeReply(text: string) {
  const t = text.trim();
  if (/^\/me\s/i.test(t)) return t;
  return t.replace(/^[\/.\s]+/, '');
}

export function parseTarget(args: string): string | null {
  const first = args.trim().split(/\s+/)[0] ?? '';
  const clean = first.replace(/^@/, '');
  return /^[a-zA-Z0-9_]{2,25}$/.test(clean) ? clean : null;
}

export type AlertEvent = {
  type: Exclude<Trigger, 'chat'>;
  /** Unique id from Twitch (EventSub message id) for de-duplication */
  id: string;
  user: string;
  amount?: number;
  message?: string;
  tier?: string;
  months?: number;
};

type ChatSender = (userId: number, text: string) => void;

/**
 * Turns chat messages and Twitch events into overlay events and chat replies. Stateless apart
 * from in-memory cooldowns and a de-duplication window keyed on Twitch's unique message ids.
 */
export class CommandEngine {
  private seen = new Map<string, number>();
  private globalCooldown = new Map<string, number>();
  private userCooldown = new Map<string, number>();
  private cache = new Map<number, { chat: Map<string, Command>; alerts: Command[] }>();
  private gc: NodeJS.Timeout;
  private sender: ChatSender = () => undefined;

  constructor(
    private hub: OverlayHub,
    private log: FastifyBaseLogger,
  ) {
    this.gc = setInterval(() => this.collect(), 60_000);
  }

  setChatSender(fn: ChatSender) {
    this.sender = fn;
  }

  invalidate(userId: number) {
    this.cache.delete(userId);
  }

  private commandsFor(userId: number) {
    let m = this.cache.get(userId);
    if (!m) {
      m = { chat: new Map(), alerts: [] };
      for (const c of db.select().from(schema.commands).where(eq(schema.commands.userId, userId)).all()) {
        if (c.trigger === 'chat') {
          m.chat.set(c.name, c);
          for (const a of c.aliases ?? []) if (!m.chat.has(a)) m.chat.set(a, c);
        } else m.alerts.push(c);
      }
      this.cache.set(userId, m);
    }
    return m;
  }

  private firstSeen(key: string) {
    if (this.seen.has(key)) return false;
    this.seen.set(key, Date.now());
    return true;
  }

  handleChat(userId: number, msg: ChatMessage) {
    if (!msg.text.startsWith('!')) return;
    // Prevent double execution (Twitch can redeliver after reconnects; multiple instances may overlap).
    if (msg.id && !this.firstSeen(`${userId}:${msg.id}`)) return;

    const [rawName, ...rest] = msg.text.slice(1).split(/\s+/);
    const name = (rawName ?? '').toLowerCase();
    if (!name) return;
    const cmd = this.commandsFor(userId).chat.get(name);
    if (!cmd || !cmd.enabled) return;

    const rank = roleRank(msg.roles);
    if (rank < (RANK[cmd.permission] ?? 0)) {
      this.record(userId, cmd.name, msg.displayName, 'denied', `requires ${cmd.permission}`);
      return;
    }

    const target = cmd.targetMode === 'none' ? null : parseTarget(rest.join(' '));
    if (cmd.targetMode === 'required' && !target) {
      // Checked before cooldowns, so a forgotten name doesn't cost the viewer their cooldown.
      this.record(userId, cmd.name, msg.displayName, 'denied', `no name given (!${cmd.name} @name)`);
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
        this.record(userId, cmd.name, msg.displayName, 'cooldown', `${left}s left`);
        return;
      }
    }
    this.globalCooldown.set(gKey, now + cmd.globalCooldownSec * 1000);
    this.userCooldown.set(uKey, now + cmd.userCooldownSec * 1000);

    const args = rest.join(' ').replace(/[^\p{L}\p{N}\p{P}\p{Zs}]/gu, '').slice(0, 200);
    this.fire(userId, cmd, msg.displayName, target, msg.channel, 'triggered', { args });
  }

  /** Twitch alert: picks the best matching variation independently for each overlay. */
  handleAlert(userId: number, channel: string, ev: AlertEvent) {
    if (!this.firstSeen(`${userId}:alert:${ev.id}`)) return null;
    const amount = ev.amount ?? 0;
    const matches = this.commandsFor(userId).alerts.filter((c) => c.enabled && c.trigger === ev.type && amount >= c.minAmount);
    if (!matches.length) {
      this.record(userId, `alert:${ev.type}`, ev.user, 'denied', 'no active alert for this type');
      return null;
    }
    const bestByOverlay = new Map<number, Command>();
    for (const cmd of matches) {
      const current = bestByOverlay.get(cmd.overlayId);
      if (!current || cmd.minAmount > current.minAmount) bestByOverlay.set(cmd.overlayId, cmd);
    }
    return [...bestByOverlay.values()].map((cmd, index) =>
      this.fire(userId, index === 0 ? cmd : { ...cmd, reply: null }, ev.user, null, channel, 'triggered', {
        amount,
        message: ev.message,
        tier: ev.tier,
        months: ev.months,
      }),
    );
  }

  /** Plays a command/alert in the overlay and/or sends its chat reply. Also used by the dashboard's "test" button. */
  fire(
    userId: number,
    cmd: Command,
    viewer: string,
    target: string | null,
    channel: string,
    status: 'triggered' | 'test',
    extra: { args?: string; amount?: number; message?: string; tier?: string; months?: number } = {},
  ) {
    const count = cmd.useCount + 1;
    db.update(schema.commands).set({ useCount: sql`${schema.commands.useCount} + 1` }).where(eq(schema.commands.id, cmd.id)).run();
    cmd.useCount = count; // keep the cached copy in sync
    const locale = db.select({ locale: schema.users.locale }).from(schema.users).where(eq(schema.users.id, userId)).get()?.locale;
    const shownUser = cmd.showUsername ? viewer : locale === 'nl' ? 'Iemand' : 'Someone';
    const vars: TemplateVars = { user: shownUser, target: target ?? cmd.targetFallback, channel, count, ...extra };

    let delivered = 0;
    let eventId: string | null = null;
    if (cmd.animation !== 'none') {
      const res = this.hub.emit(cmd.overlayId, {
        command: cmd.name,
        animation: cmd.animation,
        characterStyle: cmd.characterStyle,
        walkIn: cmd.walkIn,
      useVideoLength: cmd.useVideoLength,
        imageUrl: cmd.imageUrl,
        soundUrl: cmd.soundUrl,
        soundVolume: cmd.soundVolume,
        text: cmd.showText ? renderText(cmd.text, vars) : '',
        viewer: cmd.showUsername ? viewer : null,
        target,
        durationMs: cmd.durationMs,
        style: cmd.style,
      });
      delivered = res.delivered;
      eventId = res.eventId;
    }
    if (cmd.reply) {
      // Viewer-supplied text only reaches chat through {args}; replies never start a chat command.
      this.sender(userId, safeReply(renderText(cmd.reply, { ...vars, user: viewer }, 480)));
    }
    const name = cmd.trigger === 'chat' ? cmd.name : `alert:${cmd.trigger}`;
    const detail = cmd.animation !== 'none' && !delivered ? 'no overlay connected (queued)' : cmd.animation === 'none' ? 'chat reply' : null;
    this.record(userId, name, viewer, status, detail);
    this.log.info({ userId, command: cmd.name, viewer, delivered }, 'command fired');
    return { delivered, eventId, replied: Boolean(cmd.reply) };
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
