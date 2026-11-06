import { and, eq, ne } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { DEFAULT_ALERTS } from './defaults.js';

/** Adds the default alerts for a streamer that has none yet (new accounts and accounts from before alerts existed). */
export function seedDefaultAlerts(userId: number) {
  const has = db
    .select({ id: schema.commands.id })
    .from(schema.commands)
    .where(and(eq(schema.commands.userId, userId), ne(schema.commands.trigger, 'chat')))
    .get();
  if (has) return;
  const now = Date.now();
  for (const a of DEFAULT_ALERTS) {
    db.insert(schema.commands)
      .values({ ...a, userId, targetMode: 'none', permission: 'everyone', userCooldownSec: 0, globalCooldownSec: 0, createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .run();
  }
}
