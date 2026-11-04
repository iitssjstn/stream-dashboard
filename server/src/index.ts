import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { config } from './config.js';
import { runMigrations } from './db/index.js';
import { OverlayHub } from './overlay/hub.js';
import { CommandEngine } from './commands/engine.js';
import { ChatManager } from './twitch/manager.js';
import { authRoutes, twitchConfigured } from './auth/routes.js';
import { apiRoutes } from './api/routes.js';
import { overlayRoutes } from './overlay/routes.js';

runMigrations();

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  trustProxy: true,
});

const hub = new OverlayHub();
const engine = new CommandEngine(hub, app.log);
const chat = new ChatManager(app.log, (userId, msg) => engine.handleChat(userId, msg));

await app.register(cookie, { secret: createHash('sha256').update(config.encryptionKey).update('cookie').digest('hex') });
await app.register(websocket, { options: { maxPayload: 64 * 1024 } });
await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
await app.register(rateLimit, { max: 300, timeWindow: '1 minute', allowList: (req) => req.url.startsWith('/assets/') });

app.get('/healthz', async () => ({ ok: true }));

await app.register(authRoutes, { chat });
await app.register(apiRoutes, { prefix: '/api', chat, engine, hub });
await app.register(overlayRoutes, { hub });

// Public uploaded media (random, unguessable file names). nosniff + no SVG prevents script injection.
await app.register(fastifyStatic, {
  root: config.uploadDir,
  prefix: '/uploads/',
  decorateReply: false,
  maxAge: '7d',
  immutable: true,
  setHeaders: (res) => {
    res.header('x-content-type-options', 'nosniff');
    res.header('access-control-allow-origin', '*');
  },
});

// Built dashboard SPA (production). In development Vite serves it and proxies here.
if (fs.existsSync(config.webDist)) {
  await app.register(fastifyStatic, { root: config.webDist, prefix: '/', wildcard: false, index: false });
  const indexHtml = path.join(config.webDist, 'index.html');
  app.setNotFoundHandler((req, reply) => {
    if (req.method !== 'GET' || req.url.startsWith('/api/') || req.url.startsWith('/ws/')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.type('text/html; charset=utf-8').send(fs.createReadStream(indexHtml));
  });
}

await app.listen({ port: config.port, host: config.host });
if (!twitchConfigured()) app.log.warn('TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET ontbreken: Twitch-login is uitgeschakeld.');
chat.startAll();

const shutdown = async () => {
  chat.stopAll();
  engine.close();
  hub.close();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
