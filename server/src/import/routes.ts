import type { FastifyInstance } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { DEFAULT_ALERTS } from '../commands/defaults.js';
import { db, schema } from '../db/index.js';
import { requireUser } from '../auth/session.js';
import { validateCommand, validateTimer, ValidationError } from '../api/validate.js';
import type { CommandEngine } from '../commands/engine.js';
import { alertBody, commandBody, fetchPreview, SeError, type ImportAlert, type ImportCommand, type ImportTimer } from './streamelements.js';

type ApplyBody = { commands?: ImportCommand[]; timers?: ImportTimer[]; alerts?: ImportAlert[]; overwrite?: boolean };

export async function importRoutes(app: FastifyInstance, { engine }: { engine: CommandEngine }) {
  app.addHook('preHandler', requireUser);

  /**
   * Reads everything from StreamElements with the streamer's JWT. The token is used for this
   * request only: it is never stored or logged.
   */
  app.post<{ Body: { jwt?: string } }>(
    '/streamelements/preview',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const jwt = (req.body?.jwt ?? '').trim();
      if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(jwt) || jwt.length > 4096) return reply.code(400).send({ error: 'Dit lijkt geen geldig JWT-token' });
      try {
        const preview = await fetchPreview(jwt);
        const existing = new Set(
          db.select({ name: schema.commands.name }).from(schema.commands).where(eq(schema.commands.userId, req.user.id)).all().map((r) => r.name),
        );
        return { ...preview, existingCommands: preview.commands.filter((c) => existing.has(c.name)).map((c) => c.name) };
      } catch (e) {
        if (e instanceof SeError) return reply.code(e.status).send({ error: e.message });
        req.log.error({ err: (e as Error).message }, 'streamelements preview failed');
        return reply.code(502).send({ error: 'Ophalen bij StreamElements mislukt' });
      }
    },
  );

  app.post<{ Body: ApplyBody }>('/streamelements/apply', async (req, reply) => {
    const userId = req.user.id;
    const b = req.body ?? {};
    const overwrite = b.overwrite === true;
    const result = { created: 0, updated: 0, skipped: 0, timers: 0, alerts: 0, errors: [] as string[] };
    const now = Date.now();

    const all = () => db.select().from(schema.commands).where(eq(schema.commands.userId, userId)).all();

    try {
      db.transaction(() => {
        // ---- chat commands ----
        for (const c of (b.commands ?? []).slice(0, 500)) {
          try {
            const data = validateCommand(commandBody(c));
            const current = all();
            const existing = current.find((x) => x.name === data.name);
            const taken = new Set(current.filter((x) => x.id !== existing?.id).flatMap((x) => [x.name, ...(x.aliases ?? [])]));
            data.aliases = data.aliases.filter((a) => !taken.has(a));
            if (existing) {
              if (!overwrite) {
                result.skipped++;
                continue;
              }
              // Keep the streamer's overlay animation if the command already had one.
              const keep = existing.animation !== 'none' ? { animation: existing.animation, text: existing.text, showText: existing.showText, style: existing.style, imageUrl: existing.imageUrl } : {};
              db.update(schema.commands).set({ ...data, ...keep, updatedAt: now }).where(eq(schema.commands.id, existing.id)).run();
              result.updated++;
            } else {
              db.insert(schema.commands).values({ ...data, userId, createdAt: now, updatedAt: now }).run();
              result.created++;
            }
          } catch (e) {
            result.errors.push(`!${c?.name}: ${(e as Error).message}`);
          }
        }

        // ---- timers ----
        for (const t of (b.timers ?? []).slice(0, 200)) {
          try {
            const data = validateTimer(t);
            const existing = db.select().from(schema.timers).where(and(eq(schema.timers.userId, userId), eq(schema.timers.name, data.name))).get();
            if (existing && overwrite) db.update(schema.timers).set({ ...data, updatedAt: now }).where(eq(schema.timers.id, existing.id)).run();
            else if (existing) {
              result.skipped++;
              continue;
            } else db.insert(schema.timers).values({ ...data, userId, createdAt: now, updatedAt: now }).run();
            result.timers++;
          } catch (e) {
            result.errors.push(`Timer ${t?.name}: ${(e as Error).message}`);
          }
        }

        // ---- alerts ----
        const alerts = (b.alerts ?? []).slice(0, 100);
        // Imported alerts replace Waviloop's built-in default alert of the same type, so viewers don't get two.
        // Alerts the streamer made themselves are left alone.
        for (const trig of new Set(alerts.filter((a) => a.enabled).map((a) => a.trigger))) {
          db.update(schema.commands)
            .set({ enabled: false, updatedAt: now })
            .where(and(eq(schema.commands.userId, userId), eq(schema.commands.trigger, trig), inArray(schema.commands.name, DEFAULT_ALERTS.map((a) => a.name))))
            .run();
        }
        for (const a of alerts) {
          try {
            const base = `se-${a.trigger}-${a.minAmount}`.slice(0, 26);
            const current = all();
            const existing = current.find((x) => x.name === base);
            let name = base;
            if (existing && !overwrite) for (let i = 2; current.some((x) => x.name === name); i++) name = `${base}-${i}`;
            const data = validateCommand(alertBody(a, name));
            if (existing && overwrite) db.update(schema.commands).set({ ...data, updatedAt: now }).where(eq(schema.commands.id, existing.id)).run();
            else db.insert(schema.commands).values({ ...data, userId, createdAt: now, updatedAt: now }).run();
            result.alerts++;
          } catch (e) {
            result.errors.push(`Alert ${a?.label}: ${(e as Error).message}`);
          }
        }
      });
    } catch (e) {
      if (e instanceof ValidationError) return reply.code(400).send({ error: e.message });
      throw e;
    }
    engine.invalidate(userId);
    req.log.info({ userId, ...result, errors: result.errors.length }, 'streamelements import');
    return result;
  });
}
