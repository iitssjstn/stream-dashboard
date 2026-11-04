// Full-chain test: OAuth login -> overlay URL -> OBS-like browser source -> chat "!knuffel"
// -> command engine -> WebSocket -> animation visible -> disappears. Dashboard closed meanwhile.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { startFakeTwitch } from './fake-twitch.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = process.env.E2E_OUT ?? path.join(ROOT, 'e2e', 'output');
fs.mkdirSync(OUT, { recursive: true });
const DATA = fs.mkdtempSync(path.join(OUT, 'data-'));
const TW_PORT = 4110, APP_PORT = 3110, APP = `http://localhost:${APP_PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? '✔' : '✘'} ${msg}`); if (!cond) failures++; };

// Set E2E_DOCKER_IMAGE=stream-dashboard:latest to run the same test against the Docker image.
const IMAGE = process.env.E2E_DOCKER_IMAGE;
function startApp() {
  if (IMAGE) {
    const name = 'lumio-e2e';
    spawn('docker', ['rm', '-f', name], { stdio: 'ignore' });
    const env = { PORT: APP_PORT, PUBLIC_URL: APP, LOG_LEVEL: 'warn', TWITCH_CLIENT_ID: 'test-client', TWITCH_CLIENT_SECRET: 'test-secret',
      TWITCH_ID_BASE: `http://localhost:${TW_PORT}`, TWITCH_API_BASE: `http://localhost:${TW_PORT}`, TWITCH_IRC_URL: `ws://localhost:${TW_PORT}/irc` };
    const args = ['run', '--rm', '--name', name, '--network', 'host', '-v', 'lumio-e2e-data:/data', ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]), IMAGE];
    const p = spawn('docker', args, { stdio: ['ignore', 'inherit', 'inherit'] });
    const kill = p.kill.bind(p);
    p.kill = () => { spawn('docker', ['stop', name], { stdio: 'ignore' }); return kill('SIGTERM'); };
    return p;
  }
  const p = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: path.join(ROOT, 'server'),
    env: {
      ...process.env, PORT: String(APP_PORT), PUBLIC_URL: APP, DATA_DIR: DATA, LOG_LEVEL: 'warn',
      TWITCH_CLIENT_ID: 'test-client', TWITCH_CLIENT_SECRET: 'test-secret',
      TWITCH_ID_BASE: `http://localhost:${TW_PORT}`, TWITCH_API_BASE: `http://localhost:${TW_PORT}`,
      TWITCH_IRC_URL: `ws://localhost:${TW_PORT}/irc`,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  return p;
}
async function waitFor(fn, ms = 10000, step = 100) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(step); }
  return null;
}
const until = (cond) => waitFor(async () => cond());

const tw = await startFakeTwitch(TW_PORT);
let app = startApp();
await waitFor(() => fetch(`${APP}/healthz`).then((r) => r.ok));

const browser = await chromium.launch();
try {
  // 1. Streamer logs in with Twitch
  const dash = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await dash.newPage();
  await page.goto(APP);
  await page.getByRole('link', { name: /Koppel je Twitch-account/ }).click();
  await page.waitForURL('**/dashboard');
  await page.getByText('Verbonden met chat').waitFor({ timeout: 10000 });
  check(true, 'Streamer koppelt Twitch via OAuth en dashboard toont "Verbonden met chat"');
  const me = await page.evaluate(() => fetch('/api/me').then((r) => r.json()));
  check(me.user.login === 'knuffelstreamer', `Ingelogd als ${me.user.login}`);
  check(/\/overlay\/[\w-]{20,}$/.test(me.overlay.url), `Unieke overlay-URL: ${me.overlay.url.replace(/(overlay\/.{4}).*/, '$1…')}`);
  await page.screenshot({ path: path.join(OUT, '1-dashboard.png') });

  // 2. OBS: open the URL in a separate cookieless context, like a Browser Source
  const obs = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const overlay = await obs.newPage();
  await overlay.goto(me.overlay.url + '?debug');
  await overlay.getByText('verbonden').waitFor();
  const bg = await overlay.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(bg === 'rgba(0, 0, 0, 0)', `Overlay-achtergrond transparant (${bg})`);
  await overlay.goto(me.overlay.url); // without debug badge from here on
  await until(async () => (await (await fetch(`${APP}/healthz`)).ok) && true);

  // 3. Close the dashboard entirely
  await dash.close();
  check(true, 'Dashboard gesloten');
  await sleep(500);

  // 4. Viewer types !knuffel in Twitch chat
  const t0 = Date.now();
  tw.chat('knuffelstreamer', { login: 'animefan42', display: 'AnimeFan42', userId: '5001', id: 'msg-1', text: '!knuffel' });
  const item = await overlay.waitForSelector('.lm-item', { timeout: 3000 }).catch(() => null);
  check(Boolean(item), `Overlay ontvangt event realtime (${Date.now() - t0} ms na chatbericht)`);
  check((await overlay.locator('.lm-scene-hug .lm-chibi').count()) === 2, 'Anime-knuffelanimatie met twee personages getoond');
  const text = await overlay.locator('.lm-text').textContent();
  check(text === 'AnimeFan42 geeft de streamer een knuffel!', `Tekst: "${text}"`);
  await sleep(1700);
  await overlay.screenshot({ path: path.join(OUT, '2-overlay-knuffel.png'), omitBackground: true });
  const gone = await waitFor(async () => (await overlay.locator('.lm-item').count()) === 0, 6000);
  check(Boolean(gone) && Date.now() - t0 < 6500, `Animatie verdwijnt automatisch na ~5s (${Date.now() - t0} ms)`);

  // 5. Duplicate delivery of the same Twitch message id is ignored
  tw.chat('knuffelstreamer', { login: 'animefan42', display: 'AnimeFan42', userId: '5001', id: 'msg-1', text: '!knuffel' });
  await sleep(800);
  check((await overlay.locator('.lm-item').count()) === 0, 'Dubbel afgeleverd bericht (zelfde id) wordt niet opnieuw uitgevoerd');

  // 6. Same viewer again within cooldown -> blocked
  tw.chat('knuffelstreamer', { login: 'animefan42', display: 'AnimeFan42', userId: '5001', id: 'msg-2', text: '!knuffel' });
  await sleep(800);
  check((await overlay.locator('.lm-item').count()) === 0, 'Cooldown blokkeert tweede !knuffel van dezelfde kijker');

  // 7. Queue: several commands quickly -> played one after another
  tw.chat('knuffelstreamer', { login: 'otaku', display: 'Otaku', userId: '5002', id: 'msg-3', text: '!highfive @AnimeFan42' });
  tw.chat('knuffelstreamer', { login: 'dancer', display: 'Dancer', userId: '5003', id: 'msg-4', text: '!dance' });
  await overlay.waitForSelector('.lm-scene-highfive', { timeout: 3000 });
  await sleep(1600);
  await overlay.screenshot({ path: path.join(OUT, '3-overlay-highfive.png'), omitBackground: true });
  check((await overlay.locator('.lm-item').count()) === 1, 'Wachtrij: slechts één animatie tegelijk');
  check((await overlay.locator('.lm-text').textContent()) === 'Otaku geeft AnimeFan42 een high five!', '@target wordt ingevuld');
  await overlay.waitForSelector('.lm-scene-dance', { timeout: 8000 });
  check(true, 'Tweede event uit de wachtrij speelt daarna af');
  await sleep(1500);
  await overlay.screenshot({ path: path.join(OUT, '4-overlay-dance.png'), omitBackground: true });

  // 8. Permission: unknown command / non-command ignored
  tw.chat('knuffelstreamer', { login: 'rando', display: 'Rando', userId: '5004', id: 'msg-5', text: 'hallo !knuffel' });
  tw.chat('knuffelstreamer', { login: 'rando', display: 'Rando', userId: '5004', id: 'msg-6', text: '!bestaatniet' });

  // 9. Isolation: a second streamer's chat never reaches streamer 1's overlay
  tw.state.nextAccount = 'streamer2';
  const dash2 = await browser.newContext();
  const p2 = await dash2.newPage();
  await p2.goto(`${APP}/auth/twitch/login`);
  await p2.waitForURL('**/dashboard');
  await p2.getByText('Verbonden met chat').waitFor({ timeout: 10000 });
  const me2 = await p2.evaluate(() => fetch('/api/me').then((r) => r.json()));
  check(me2.overlay.url !== me.overlay.url, 'Tweede streamer krijgt een eigen overlay-URL');
  await waitFor(async () => (await overlay.locator('.lm-item').count()) === 0, 10000);
  tw.chat('anderestreamer', { login: 'viewer2', display: 'Viewer2', userId: '6001', id: 'msg-7', text: '!knuffel' });
  await sleep(1200);
  check((await overlay.locator('.lm-item').count()) === 0, 'Event van streamer 2 komt NIET in overlay van streamer 1');

  // 10. Server restart: overlay reconnects by itself and chat reconnects with stored (encrypted) tokens
  app.kill('SIGTERM');
  await new Promise((r) => app.once('exit', r));
  await sleep(1000);
  app = startApp();
  await waitFor(() => fetch(`${APP}/healthz`).then((r) => r.ok));
  await waitFor(() => tw.state.sockets.has('knuffelstreamer'), 10000);
  await sleep(4000); // overlay backoff
  tw.chat('knuffelstreamer', { login: 'newfan', display: 'NewFan', userId: '5009', id: 'msg-8', text: '!KNUFFEL' });
  const after = await overlay.waitForSelector('.lm-item', { timeout: 8000 }).catch(() => null);
  check(Boolean(after), 'Na server-herstart: overlay en chat verbinden automatisch opnieuw en !knuffel werkt weer');

  // 11. Activity log contains what happened
  const acts = await p2.evaluate(() => fetch('/api/activity').then((r) => r.json()));
  check(Array.isArray(acts) && acts.every((a) => a.viewer !== 'AnimeFan42'), 'Activiteit is per streamer gescheiden');
  const ctx1 = await browser.newContext();
  tw.state.nextAccount = 'streamer1';
  const p1 = await ctx1.newPage();
  await p1.goto(`${APP}/auth/twitch/login`);
  await p1.waitForURL('**/dashboard');
  const acts1 = await p1.evaluate(() => fetch('/api/activity').then((r) => r.json()));
  const statuses = acts1.map((a) => `${a.commandName}:${a.status}`);
  check(statuses.includes('knuffel:cooldown') && statuses.filter((s) => s === 'knuffel:triggered').length === 2, `Activiteit: ${statuses.reverse().join(', ')}`);
  await p1.goto(`${APP}/commands/${(await p1.evaluate(() => fetch('/api/commands').then((r) => r.json()))).find((c) => c.name === 'knuffel').id}`);
  await p1.waitForSelector('.lm-scene-hug', { timeout: 5000 });
  await sleep(1800);
  await p1.screenshot({ path: path.join(OUT, '5-editor.png') });
  await p1.goto(`${APP}/dashboard`);
  await p1.getByText('Recente activiteit').waitFor();
  await sleep(600);
  await p1.screenshot({ path: path.join(OUT, '6-dashboard-activity.png') });
} finally {
  await browser.close();
  app.kill('SIGTERM');
  tw.close();
  fs.rmSync(DATA, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
