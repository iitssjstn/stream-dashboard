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
import { db, runMigrations, schema } from './db/index.js';
import { eq } from 'drizzle-orm';
import { OverlayHub } from './overlay/hub.js';
import { CommandEngine } from './commands/engine.js';
import { ChatManager } from './twitch/manager.js';
import { EventSubManager } from './twitch/eventsub.js';
import { TimerScheduler } from './timers/scheduler.js';
import { seedDefaultAlerts } from './commands/seed.js';
import { importRoutes } from './import/routes.js';
import { discordRoutes } from './discord/routes.js';
import { DiscordBot } from './discord/bot.js';
import { authRoutes } from './auth/routes.js';
import { setupRoutes } from './setup/routes.js';
import { giphyRoutes } from './giphy/routes.js';
import { ensureSetupCode, twitchConfigured } from './settings.js';
import { apiRoutes } from './api/routes.js';
import { overlayRoutes } from './overlay/routes.js';

runMigrations();

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  trustProxy: true,
});

const hub = new OverlayHub();
const engine = new CommandEngine(hub, app.log);
let timers: TimerScheduler;
const chat = new ChatManager(app.log, (userId, msg) => {
  timers.onChat(userId);
  engine.handleChat(userId, msg);
});
timers = new TimerScheduler((userId, text) => chat.say(userId, text), app.log);
engine.setChatSender((userId, text) => chat.say(userId, text));
const eventsub = new EventSubManager(app.log, (userId, ev) => {
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (user) engine.handleAlert(userId, user.login, ev);
});
// Accounts created before alerts existed get the default alerts once.
for (const u of db.select({ id: schema.users.id }).from(schema.users).all()) seedDefaultAlerts(u.id);

await app.register(cookie, { secret: createHash('sha256').update(config.encryptionKey).update('cookie').digest('hex') });
await app.register(websocket, { options: { maxPayload: 64 * 1024 } });
// Videos may be up to 60 MB; images and audio are limited to 15 MB in the upload route.
await app.register(multipart, { limits: { fileSize: 60 * 1024 * 1024, files: 1 } });
await app.register(rateLimit, { max: 300, timeWindow: '1 minute', allowList: (req) => req.url.startsWith('/assets/') });

app.get('/healthz', async () => ({ ok: true }));

await app.register(authRoutes, { chat, eventsub });
await app.register(setupRoutes, { chat, eventsub });
await app.register(giphyRoutes);
await app.register(apiRoutes, { prefix: '/api', chat, engine, hub, eventsub, timers });
await app.register(importRoutes, { prefix: '/api/import', engine });
const discordBot = new DiscordBot(app.log);
await app.register(discordRoutes, { bot: discordBot });
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
if (!twitchConfigured()) {
  const code = ensureSetupCode();
  const line = '='.repeat(64);
  // Plain stdout so it is easy to spot with `docker logs stream-dashboard`.
  console.log(`\n${line}\n  Twitch is nog niet ingesteld. Open ${config.publicUrl}\n  en vul deze eenmalige setup-code in:\n\n      SETUP CODE: ${code}\n\n  (nieuwe code bij elke herstart zolang de setup niet klaar is)\n${line}\n`);
}
chat.startAll();
eventsub.startAll();
void discordBot.start();

const shutdown = async () => {
  chat.stopAll();
  eventsub.stopAll();
  timers.close();
  discordBot.stop();
  engine.close();
  hub.close();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
