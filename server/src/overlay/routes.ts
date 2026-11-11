import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { db, schema } from '../db/index.js';
import { config } from '../config.js';
import type { OverlayHub } from './hub.js';
import { widgetState } from './widgets.js';

const findByToken = (token: string) =>
  /^[\w-]{16,64}$/.test(token) ? db.select().from(schema.overlays).where(eq(schema.overlays.token, token)).get() : undefined;

export async function overlayRoutes(app: FastifyInstance, { hub }: { hub: OverlayHub }) {
  // The browser source page itself. Independent of the dashboard: a tiny vanilla bundle.
  app.get<{ Params: { token: string } }>('/overlay/:token', async (req, reply) => {
    if (!findByToken(req.params.token)) return reply.code(404).type('text/html').send('<!doctype html><title>Overlay not found</title>');
    const file = path.join(config.webDist, 'overlay.html');
    if (!fs.existsSync(file)) return reply.code(503).send('Web build ontbreekt: voer `npm run build` uit.');
    return reply
      .header('cache-control', 'no-store')
      .header('x-robots-tag', 'noindex')
      .type('text/html; charset=utf-8')
      .send(fs.createReadStream(file));
  });

  app.get<{ Params: { token: string } }>('/ws/overlay/:token', { websocket: true }, (socket, req) => {
    const overlay = findByToken(req.params.token);
    if (!overlay) {
      socket.close(4004, 'unknown overlay');
      return;
    }
    const user = db.select().from(schema.users).where(eq(schema.users.id, overlay.userId)).get();
    if (!user) {
      socket.close(4004, 'unknown overlay');
      return;
    }
    hub.add(overlay.id, socket, { type: 'config', width: overlay.width, height: overlay.height, channel: user.login }, widgetState(user.id, overlay.id));
    req.log.info({ userId: user.id, overlayId: overlay.id, clients: hub.count(overlay.id) }, 'overlay connected');
  });
}
