import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { db, schema } from '../db/index.js';
import { config } from '../config.js';
import { randomToken } from '../crypto.js';
import { requireUser } from '../auth/session.js';
import { giphyKey, ownerUserId, twitchConfigured } from '../settings.js';
import { validateCommand, validateTimer, ValidationError } from './validate.js';
import { renderText, safeReply } from '../commands/engine.js';
import { ANIMATIONS, asLocale, EFFECTS, PARTICLES, PERMISSIONS } from '../commands/defaults.js';
import type { ChatManager } from '../twitch/manager.js';
import type { EventSubManager } from '../twitch/eventsub.js';
import type { TimerScheduler } from '../timers/scheduler.js';
import type { CommandEngine } from '../commands/engine.js';
import type { OverlayHub } from '../overlay/hub.js';
import type { User } from '../db/schema.js';

const UPLOAD_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/ogg': '.ogg',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
};

type Deps = { chat: ChatManager; engine: CommandEngine; hub: OverlayHub; eventsub: EventSubManager; timers: TimerScheduler };

export const overlayUrl = (overlay: { token: string }) => `${config.publicUrl}/overlay/${overlay.token}`;

export async function apiRoutes(app: FastifyInstance, { chat, engine, hub, eventsub, timers }: Deps) {
  app.addHook('preHandler', requireUser);

  app.setErrorHandler((error, _req, reply) => {
    const err = error as Error & { code?: string; statusCode?: number };
    if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return reply.code(409).send({ error: 'This command already exists' });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    app.log.error(err);
    return reply.code(500).send({ error: 'Internal error' });
  });

  app.get('/me', async (req) => {
    const u = req.user;
    const overlay = db.select().from(schema.overlays).where(eq(schema.overlays.userId, u.id)).orderBy(schema.overlays.id).get()!;
    const dayAgo = Date.now() - 24 * 3600_000;
    const stats = db
      .select({
        commands: sql<number>`(select count(*) from commands where user_id = ${u.id} and enabled = 1 and trigger = 'chat')`,
        alerts: sql<number>`(select count(*) from commands where user_id = ${u.id} and enabled = 1 and trigger <> 'chat')`,
        triggers24h: sql<number>`(select count(*) from activity where user_id = ${u.id} and status = 'triggered' and created_at >= ${dayAgo})`,
      })
      .from(sql`(select 1)`)
      .get();
    // Plays per hour over the last 24 hours (oldest first) for the dashboard sparkline.
    const hourStart = Math.floor(Date.now() / 3600_000) * 3600_000;
    const firstHour = hourStart - 23 * 3600_000;
    const playsByHour = new Array<number>(24).fill(0);
    const hourBucket = sql<number>`CAST((${schema.activity.createdAt} - ${firstHour}) / 3600000 AS INTEGER)`;
    const hourlyPlays = db
      .select({ hour: hourBucket, count: sql<number>`count(*)` })
      .from(schema.activity)
      .where(and(eq(schema.activity.userId, u.id), eq(schema.activity.status, 'triggered'), gte(schema.activity.createdAt, firstHour)))
      .groupBy(hourBucket)
      .all();
    for (const r of hourlyPlays) playsByHour[Math.min(23, r.hour)] = r.count;
    return {
      user: {
        id: u.id,
        login: u.login,
        displayName: u.displayName,
        profileImageUrl: u.profileImageUrl,
        scopes: u.scopes.split(' ').filter(Boolean),
        authError: u.authError,
        locale: u.locale,
      },
      overlay: {
        url: overlayUrl(overlay),
        width: overlay.width,
        height: overlay.height,
        connectedClients: hub.count(overlay.id),
      },
      chat: { enabled: u.chatEnabled, ...chat.status(u.id) },
      alerts: eventsub.status(u.id),
      stats: { ...stats, playsByHour, playsFirstHour: firstHour },
      twitchConfigured: twitchConfigured(),
      isOwner: ownerUserId() === u.id,
      giphyEnabled: giphyKey().source !== 'none',
    };
  });

  app.get('/overlays', async (req) =>
    db.select().from(schema.overlays).where(eq(schema.overlays.userId, req.user.id)).orderBy(schema.overlays.id).all().map((overlay) => ({
      ...overlay,
      url: overlayUrl(overlay),
      connectedClients: hub.count(overlay.id),
    })),
  );

  app.post('/overlays', async (req, reply) => {
    const body = (req.body ?? {}) as { name?: unknown; width?: unknown; height?: unknown };
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 40) return reply.code(400).send({ error: 'Overlay name must be between 1 and 40 characters' });
    const source = db.select().from(schema.overlays).where(eq(schema.overlays.userId, req.user.id)).orderBy(schema.overlays.id).get()!;
    const width = body.width === undefined ? source.width : Number(body.width);
    const height = body.height === undefined ? source.height : Number(body.height);
    if (!Number.isFinite(width) || width < 320 || width > 7680) return reply.code(400).send({ error: 'Width must be between 320 and 7680' });
    if (!Number.isFinite(height) || height < 240 || height > 4320) return reply.code(400).send({ error: 'Height must be between 240 and 4320' });
    const overlay = db
      .insert(schema.overlays)
      .values({ userId: req.user.id, name, token: randomToken(24), width: Math.round(width), height: Math.round(height), createdAt: Date.now() })
      .returning()
      .get();
    return reply.code(201).send({ ...overlay, url: overlayUrl(overlay), connectedClients: 0 });
  });

  app.patch<{ Params: { id: string } }>('/overlays/:id', async (req, reply) => {
    const overlay = db
      .select()
      .from(schema.overlays)
      .where(and(eq(schema.overlays.id, Number(req.params.id)), eq(schema.overlays.userId, req.user.id)))
      .get();
    if (!overlay) return reply.code(404).send({ error: 'Overlay not found' });
    const body = (req.body ?? {}) as { name?: unknown; width?: unknown; height?: unknown };
    const patch: Partial<typeof schema.overlays.$inferInsert> = {};
    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 40) return reply.code(400).send({ error: 'Overlay name must be between 1 and 40 characters' });
      patch.name = name;
    }
    if (body.width !== undefined) patch.width = Math.min(7680, Math.max(320, Math.round(Number(body.width))));
    if (body.height !== undefined) patch.height = Math.min(4320, Math.max(240, Math.round(Number(body.height))));
    const updated = db.update(schema.overlays).set(patch).where(eq(schema.overlays.id, overlay.id)).returning().get()!;
    if (body.width !== undefined || body.height !== undefined) {
      const user = db.select().from(schema.users).where(eq(schema.users.id, req.user.id)).get()!;
      hub.broadcast(overlay.id, { type: 'config', width: updated.width, height: updated.height, channel: user.login });
    }
    return { ...updated, url: overlayUrl(updated), connectedClients: hub.count(updated.id) };
  });

  app.delete<{ Params: { id: string } }>('/overlays/:id', async (req, reply) => {
    const overlay = db
      .select()
      .from(schema.overlays)
      .where(and(eq(schema.overlays.id, Number(req.params.id)), eq(schema.overlays.userId, req.user.id)))
      .get();
    if (!overlay) return reply.code(404).send({ error: 'Overlay not found' });
    const fallback = db
      .select()
      .from(schema.overlays)
      .where(eq(schema.overlays.userId, req.user.id))
      .orderBy(schema.overlays.id)
      .all()
      .find((candidate) => candidate.id !== overlay.id);
    if (!fallback) return reply.code(400).send({ error: 'At least one overlay is required' });
    db.transaction((tx) => {
      tx.update(schema.commands).set({ overlayId: fallback.id }).where(eq(schema.commands.overlayId, overlay.id)).run();
      tx.delete(schema.overlays).where(eq(schema.overlays.id, overlay.id)).run();
    });
    hub.disconnect(overlay.id);
    engine.invalidate(req.user.id);
    return { ok: true };
  });

  app.get('/meta', async () => ({ animations: ANIMATIONS, permissions: PERMISSIONS, effects: EFFECTS, particles: PARTICLES }));

  app.patch<{ Body: { overlayWidth?: number; overlayHeight?: number; chatEnabled?: boolean; locale?: string } }>('/settings', async (req) => {
    const b = req.body ?? {};
    const patch: Partial<User> = { updatedAt: Date.now() };
    if (b.overlayWidth !== undefined) patch.overlayWidth = Math.min(7680, Math.max(320, Math.round(Number(b.overlayWidth))));
    if (b.overlayHeight !== undefined) patch.overlayHeight = Math.min(4320, Math.max(240, Math.round(Number(b.overlayHeight))));
    if (b.chatEnabled !== undefined) patch.chatEnabled = Boolean(b.chatEnabled);
    if (b.locale !== undefined) patch.locale = asLocale(b.locale);
    db.update(schema.users).set(patch).where(eq(schema.users.id, req.user.id)).run();
    const u = db.select().from(schema.users).where(eq(schema.users.id, req.user.id)).get()!;
    const defaultOverlay = db.select().from(schema.overlays).where(eq(schema.overlays.userId, u.id)).orderBy(schema.overlays.id).get()!;
    if (b.overlayWidth !== undefined || b.overlayHeight !== undefined) {
      const updated = db.update(schema.overlays).set({ width: u.overlayWidth, height: u.overlayHeight }).where(eq(schema.overlays.id, defaultOverlay.id)).returning().get()!;
      hub.broadcast(updated.id, { type: 'config', width: updated.width, height: updated.height, channel: u.login });
    }
    if (b.chatEnabled !== undefined) {
      if (u.chatEnabled) {
        chat.ensure(u.id);
        eventsub.ensure(u.id);
      } else {
        chat.stop(u.id);
        eventsub.stop(u.id);
      }
    }
    return { ok: true };
  });

  app.post('/chat/reconnect', async (req) => {
    chat.restart(req.user.id);
    return { ok: true };
  });

  app.post('/overlay/regenerate', async (req) => {
    const token = randomToken(24);
    const overlay = db.select().from(schema.overlays).where(eq(schema.overlays.userId, req.user.id)).orderBy(schema.overlays.id).get()!;
    db.update(schema.overlays).set({ token }).where(eq(schema.overlays.id, overlay.id)).run();
    hub.disconnect(overlay.id);
    return { url: `${config.publicUrl}/overlay/${token}` };
  });

  app.post<{ Params: { id: string } }>('/overlays/:id/regenerate', async (req, reply) => {
    const overlay = db
      .select()
      .from(schema.overlays)
      .where(and(eq(schema.overlays.id, Number(req.params.id)), eq(schema.overlays.userId, req.user.id)))
      .get();
    if (!overlay) return reply.code(404).send({ error: 'Overlay not found' });
    const token = randomToken(24);
    db.update(schema.overlays).set({ token }).where(eq(schema.overlays.id, overlay.id)).run();
    hub.disconnect(overlay.id);
    return { url: `${config.publicUrl}/overlay/${token}` };
  });

  // ---- commands ----
  app.get('/commands', async (req) =>
    db.select().from(schema.commands).where(eq(schema.commands.userId, req.user.id)).orderBy(schema.commands.name).all(),
  );

  app.post('/commands', async (req, reply) => {
    const data = validateCommand(req.body);
    const now = Date.now();
    const overlay = db.select({ id: schema.overlays.id }).from(schema.overlays).where(eq(schema.overlays.userId, req.user.id)).orderBy(schema.overlays.id).get()!;
    const row = db
      .insert(schema.commands)
      .values({ ...data, userId: req.user.id, overlayId: overlay.id, createdAt: now, updatedAt: now })
      .returning()
      .get();
    engine.invalidate(req.user.id);
    return reply.code(201).send(row);
  });

  app.put<{ Params: { id: string } }>('/commands/:id', async (req, reply) => {
    const data = validateCommand(req.body);
    const row = db
      .update(schema.commands)
      .set({ ...data, updatedAt: Date.now() })
      .where(and(eq(schema.commands.id, Number(req.params.id)), eq(schema.commands.userId, req.user.id)))
      .returning()
      .get();
    if (!row) return reply.code(404).send({ error: 'Command not found' });
    engine.invalidate(req.user.id);
    return row;
  });

  app.patch<{ Params: { id: string }; Body: { overlayId: number } }>('/commands/:id/overlay', async (req, reply) => {
    const overlay = db
      .select({ id: schema.overlays.id })
      .from(schema.overlays)
      .where(and(eq(schema.overlays.id, Number(req.body?.overlayId)), eq(schema.overlays.userId, req.user.id)))
      .get();
    if (!overlay) return reply.code(404).send({ error: 'Overlay not found' });
    const command = db
      .update(schema.commands)
      .set({ overlayId: overlay.id, updatedAt: Date.now() })
      .where(and(eq(schema.commands.id, Number(req.params.id)), eq(schema.commands.userId, req.user.id)))
      .returning()
      .get();
    if (!command) return reply.code(404).send({ error: 'Command not found' });
    engine.invalidate(req.user.id);
    return command;
  });

  app.delete<{ Params: { id: string } }>('/commands/:id', async (req) => {
    db.delete(schema.commands)
      .where(and(eq(schema.commands.id, Number(req.params.id)), eq(schema.commands.userId, req.user.id)))
      .run();
    engine.invalidate(req.user.id);
    return { ok: true };
  });

  /** Sends a command through the real overlay pipeline – handy while positioning the browser source in OBS. */
  app.post<{ Params: { id: string } }>('/commands/:id/test', async (req, reply) => {
    const cmd = engine.getCommand(req.user.id, Number(req.params.id));
    if (!cmd) return reply.code(404).send({ error: 'Command not found' });
    // Alerts are tested with sample values so {amount}, {months} etc. show something sensible.
    const sample = { amount: Math.max(cmd.minAmount, cmd.trigger === 'cheer' ? 100 : cmd.trigger === 'raid' ? 25 : 3), months: 6, tier: '1', message: 'This is a test message', args: '' };
    return engine.fire(req.user.id, cmd, req.user.displayName, null, req.user.login, 'test', cmd.trigger === 'chat' ? {} : sample);
  });

  app.post('/alerts/reconnect', async (req) => {
    eventsub.restart(req.user.id);
    return { ok: true };
  });

  // ---- timers ----
  const ownTimer = (userId: number, id: number) =>
    and(eq(schema.timers.userId, userId), eq(schema.timers.id, id));

  app.get('/timers', async (req) =>
    db.select().from(schema.timers).where(eq(schema.timers.userId, req.user.id)).orderBy(schema.timers.name).all(),
  );

  app.post('/timers', async (req, reply) => {
    const data = validateTimer(req.body);
    const now = Date.now();
    const row = db.insert(schema.timers).values({ ...data, userId: req.user.id, createdAt: now, updatedAt: now }).returning().get();
    return reply.code(201).send(row);
  });

  app.put<{ Params: { id: string } }>('/timers/:id', async (req, reply) => {
    const data = validateTimer(req.body);
    const row = db.update(schema.timers).set({ ...data, updatedAt: Date.now() }).where(ownTimer(req.user.id, Number(req.params.id))).returning().get();
    if (!row) return reply.code(404).send({ error: 'Timer not found' });
    timers.reset(row.id);
    return row;
  });

  app.delete<{ Params: { id: string } }>('/timers/:id', async (req) => {
    db.delete(schema.timers).where(ownTimer(req.user.id, Number(req.params.id))).run();
    timers.reset(Number(req.params.id));
    return { ok: true };
  });

  /** Sends the timer's next message right away (handy to check the text). */
  app.post<{ Params: { id: string } }>('/timers/:id/test', async (req, reply) => {
    const t = db.select().from(schema.timers).where(ownTimer(req.user.id, Number(req.params.id))).get();
    if (!t) return reply.code(404).send({ error: 'Timer not found' });
    chat.say(req.user.id, safeReply(renderText(t.messages[0], { user: req.user.displayName, target: req.user.displayName, channel: req.user.login }, 480)));
    return { ok: true };
  });

  // ---- activity ----
  app.get<{ Querystring: { limit?: string; since?: string } }>('/activity', async (req) => {
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const since = Number(req.query.since) || 0;
    return db
      .select()
      .from(schema.activity)
      .where(and(eq(schema.activity.userId, req.user.id), gte(schema.activity.createdAt, since)))
      .orderBy(desc(schema.activity.id))
      .limit(limit)
      .all();
  });

  // ---- uploads ----
  app.get('/uploads', async (req) =>
    db
      .select()
      .from(schema.uploads)
      .where(eq(schema.uploads.userId, req.user.id))
      .orderBy(desc(schema.uploads.createdAt))
      .all()
      .map((u) => ({ ...u, url: `/uploads/${u.id}` })),
  );

  app.post('/uploads', async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'No file received' });
    const ext = UPLOAD_TYPES[file.mimetype];
    if (!ext) {
      file.file.resume();
      return reply.code(415).send({ error: 'Only PNG, JPG, GIF, WEBP, MP3, WAV, OGG, MP4 or WEBM' });
    }
    const id = `${randomToken(12)}${ext}`;
    const dest = path.join(config.uploadDir, id);
    await pipeline(file.file, fs.createWriteStream(dest));
    const isVideo = file.mimetype.startsWith('video/');
    const size = fs.statSync(dest).size;
    if (file.file.truncated || (!isVideo && size > 15 * 1024 * 1024)) {
      fs.rmSync(dest, { force: true });
      return reply.code(413).send({ error: isVideo ? 'Video is larger than 60 MB' : 'File is larger than 15 MB' });
    }
    db.insert(schema.uploads)
      .values({ id, userId: req.user.id, originalName: file.filename.slice(0, 200), mime: file.mimetype, size, createdAt: Date.now() })
      .run();
    return reply.code(201).send({ id, url: `/uploads/${id}`, mime: file.mimetype, size, originalName: file.filename });
  });

  app.delete<{ Params: { id: string } }>('/uploads/:id', async (req) => {
    const row = db
      .delete(schema.uploads)
      .where(and(eq(schema.uploads.id, req.params.id), eq(schema.uploads.userId, req.user.id)))
      .returning()
      .get();
    if (row) fs.rmSync(path.join(config.uploadDir, row.id), { force: true });
    return { ok: true };
  });
}
