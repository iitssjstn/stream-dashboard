import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { db, schema } from '../db/index.js';
import { config } from '../config.js';
import { renderText, safeReply } from '../commands/engine.js';
import { getAccessToken } from '../twitch/tokens.js';
import { isLive } from '../twitch/api.js';

type State = { lastSent: number; linesAtLast: number; index: number };

/**
 * Sends timer messages in each streamer's chat. A timer fires when its interval (live or
 * offline) has passed AND at least `minChatLines` chat messages arrived since its last message,
 * just like StreamElements timers.
 */
export class TimerScheduler {
  private lines = new Map<number, number>();
  private state = new Map<number, State>();
  private live = new Map<number, { value: boolean; at: number }>();
  private tickTimer: NodeJS.Timeout;
  private busy = false;

  constructor(
    private say: (userId: number, text: string) => void,
    private log: FastifyBaseLogger,
  ) {
    this.tickTimer = setInterval(() => void this.tick(), Math.min(15_000, Math.max(200, config.timerMinuteMs / 4)));
  }

  onChat(userId: number) {
    this.lines.set(userId, (this.lines.get(userId) ?? 0) + 1);
  }

  /** Forget runtime state of a timer (after it was edited) so it restarts its interval. */
  reset(timerId: number) {
    this.state.delete(timerId);
  }

  private async liveStatus(userId: number, twitchId: string) {
    const cached = this.live.get(userId);
    if (cached && Date.now() - cached.at < 2 * 60_000) return cached.value;
    let value = true; // if Twitch can't be asked, assume live: that's when timers matter most
    try {
      value = await isLive(await getAccessToken(userId), twitchId);
    } catch (e) {
      this.log.warn({ userId, err: (e as Error).message }, 'live status unavailable');
    }
    this.live.set(userId, { value, at: Date.now() });
    return value;
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const rows = db
        .select({ timer: schema.timers, user: schema.users })
        .from(schema.timers)
        .innerJoin(schema.users, eq(schema.users.id, schema.timers.userId))
        .where(eq(schema.timers.enabled, true))
        .all();
      const now = Date.now();
      for (const { timer, user } of rows) {
        if (!user.chatEnabled || !timer.messages.length) continue;
        const total = this.lines.get(user.id) ?? 0;
        let st = this.state.get(timer.id);
        if (!st) {
          // Start counting from now: never flood chat right after a restart.
          this.state.set(timer.id, (st = { lastSent: now, linesAtLast: total, index: 0 }));
          continue;
        }
        const live = await this.liveStatus(user.id, user.twitchId);
        const minutes = live ? timer.intervalMin : timer.offlineIntervalMin;
        if (!minutes) continue;
        if (now - st.lastSent < minutes * config.timerMinuteMs) continue;
        if (total - st.linesAtLast < timer.minChatLines) continue;
        const msg = timer.messages[st.index % timer.messages.length];
        this.say(user.id, safeReply(renderText(msg, { user: user.displayName, target: user.displayName, channel: user.login }, 480)));
        st.lastSent = now;
        st.linesAtLast = total;
        st.index++;
        db.insert(schema.activity).values({ userId: user.id, commandName: `timer:${timer.name}`, viewer: 'timer', status: 'triggered', detail: 'chatbericht', createdAt: now }).run();
      }
    } catch (e) {
      this.log.error(e, 'timer tick failed');
    } finally {
      this.busy = false;
    }
  }

  close() {
    clearInterval(this.tickTimer);
  }
}
