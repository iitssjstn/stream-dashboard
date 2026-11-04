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
import { validateCommand, ValidationError } from './validate.js';
import { ANIMATIONS, EFFECTS, PARTICLES, PERMISSIONS } from '../commands/defaults.js';
import type { ChatManager } from '../twitch/manager.js';
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
};

type Deps = { chat: ChatManager; engine: CommandEngine; hub: OverlayHub };

export const overlayUrl = (u: User) => `${config.publicUrl}/overlay/${u.overlayToken}`;

export async function apiRoutes(app: FastifyInstance, { chat, engine, hub }: Deps) {
  app.addHook('preHandler', requireUser);

  app.setErrorHandler((error, _req, reply) => {
    const err = error as Error & { code?: string; statusCode?: number };
    if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return reply.code(409).send({ error: 'Dit command bestaat al' });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    app.log.error(err);
    return reply.code(500).send({ error: 'Interne fout' });
  });

  app.get('/me', async (req) => {
    const u = req.user;
    const dayAgo = Date.now() - 24 * 3600_000;
    const stats = db
      .select({
        commands: sql<number>`(select count(*) from commands where user_id = ${u.id} and enabled = 1)`,
        triggers24h: sql<number>`(select count(*) from activity where user_id = ${u.id} and status = 'triggered' and created_at >= ${dayAgo})`,
      })
      .from(sql`(select 1)`)
      .get();
    // Plays per hour over the last 24 hours (oldest first) for the dashboard sparkline.
    const hourStart = Math.floor(Date.now() / 3600_000) * 3600_000;
    const firstHour = hourStart - 23 * 3600_000;
    const playsByHour = new Array<number>(24).fill(0);
    for (const r of db
      .select({ t: schema.activity.createdAt })
      .from(schema.activity)
      .where(and(eq(schema.activity.userId, u.id), eq(schema.activity.status, 'triggered'), gte(schema.activity.createdAt, firstHour)))
      .all()) {
      playsByHour[Math.min(23, Math.floor((r.t - firstHour) / 3600_000))]++;
    }
    return {
      user: {
        id: u.id,
        login: u.login,
        displayName: u.displayName,
        profileImageUrl: u.profileImageUrl,
        scopes: u.scopes.split(' ').filter(Boolean),
        authError: u.authError,
      },
      overlay: {
        url: overlayUrl(u),
        width: u.overlayWidth,
        height: u.overlayHeight,
        connectedClients: hub.count(u.id),
      },
      chat: { enabled: u.chatEnabled, ...chat.status(u.id) },
      stats: { ...stats, playsByHour, playsFirstHour: firstHour },
      twitchConfigured: twitchConfigured(),
      isOwner: ownerUserId() === u.id,
      giphyEnabled: giphyKey().source !== 'none',
    };
  });

  app.get('/meta', async () => ({ animations: ANIMATIONS, permissions: PERMISSIONS, effects: EFFECTS, particles: PARTICLES }));

  app.patch<{ Body: { overlayWidth?: number; overlayHeight?: number; chatEnabled?: boolean } }>('/settings', async (req) => {
    const b = req.body ?? {};
    const patch: Partial<User> = { updatedAt: Date.now() };
    if (b.overlayWidth !== undefined) patch.overlayWidth = Math.min(7680, Math.max(320, Math.round(Number(b.overlayWidth))));
    if (b.overlayHeight !== undefined) patch.overlayHeight = Math.min(4320, Math.max(240, Math.round(Number(b.overlayHeight))));
    if (b.chatEnabled !== undefined) patch.chatEnabled = Boolean(b.chatEnabled);
    db.update(schema.users).set(patch).where(eq(schema.users.id, req.user.id)).run();
    const u = db.select().from(schema.users).where(eq(schema.users.id, req.user.id)).get()!;
    hub.broadcast(u.id, { type: 'config', width: u.overlayWidth, height: u.overlayHeight, channel: u.login });
    if (b.chatEnabled !== undefined) (u.chatEnabled ? chat.ensure(u.id) : chat.stop(u.id));
    return { ok: true };
  });

  app.post('/chat/reconnect', async (req) => {
    chat.restart(req.user.id);
    return { ok: true };
  });

  app.post('/overlay/regenerate', async (req) => {
    const token = randomToken(24);
    db.update(schema.users).set({ overlayToken: token, updatedAt: Date.now() }).where(eq(schema.users.id, req.user.id)).run();
    hub.disconnect(req.user.id);
    return { url: `${config.publicUrl}/overlay/${token}` };
  });

  // ---- commands ----
  app.get('/commands', async (req) =>
    db.select().from(schema.commands).where(eq(schema.commands.userId, req.user.id)).orderBy(schema.commands.name).all(),
  );

  app.post('/commands', async (req, reply) => {
    const data = validateCommand(req.body);
    const now = Date.now();
    const row = db
      .insert(schema.commands)
      .values({ ...data, userId: req.user.id, createdAt: now, updatedAt: now })
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
    if (!row) return reply.code(404).send({ error: 'Command niet gevonden' });
    engine.invalidate(req.user.id);
    return row;
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
    if (!cmd) return reply.code(404).send({ error: 'Command niet gevonden' });
    return engine.fire(req.user.id, cmd, req.user.displayName, null, req.user.login, 'test');
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
    if (!file) return reply.code(400).send({ error: 'Geen bestand ontvangen' });
    const ext = UPLOAD_TYPES[file.mimetype];
    if (!ext) {
      file.file.resume();
      return reply.code(415).send({ error: 'Alleen PNG, JPG, GIF, WEBP, MP3, WAV of OGG' });
    }
    const id = `${randomToken(12)}${ext}`;
    const dest = path.join(config.uploadDir, id);
    await pipeline(file.file, fs.createWriteStream(dest));
    if (file.file.truncated) {
      fs.rmSync(dest, { force: true });
      return reply.code(413).send({ error: 'Bestand is groter dan 15 MB' });
    }
    const size = fs.statSync(dest).size;
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
