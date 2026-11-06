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

// The setup code is only printed in the server output, exactly like `docker logs` would show it.
let setupCode = null;
function watchOutput(p) {
  p.stdout.on('data', (d) => {
    const s = d.toString();
    process.stderr.write(s);
    const m = s.match(/SETUP CODE: ([A-F0-9-]+)/);
    if (m) setupCode = m[1];
  });
  return p;
}

const discordEnv = { DISCORD_API_BASE: `http://localhost:${TW_PORT}/discord/api`, DISCORD_AUTHORIZE_URL: `http://localhost:${TW_PORT}/discord/oauth2/authorize`, DISCORD_GATEWAY_URL: `ws://localhost:${TW_PORT}/discord-gw` };

// Set E2E_DOCKER_IMAGE=stream-dashboard:latest to run the same test against the Docker image.
const IMAGE = process.env.E2E_DOCKER_IMAGE;
function startApp() {
  if (IMAGE) {
    const name = 'lumio-e2e';
    spawn('docker', ['rm', '-f', name], { stdio: 'ignore' });
    const env = { PORT: APP_PORT, PUBLIC_URL: APP, LOG_LEVEL: 'warn',
      TWITCH_ID_BASE: `http://localhost:${TW_PORT}`, TWITCH_API_BASE: `http://localhost:${TW_PORT}`, TWITCH_IRC_URL: `ws://localhost:${TW_PORT}/irc`, GIPHY_API_BASE: `http://localhost:${TW_PORT}`, TWITCH_EVENTSUB_URL: `ws://localhost:${TW_PORT}/eventsub`, SE_API_BASE: `http://localhost:${TW_PORT}/se`, TIMER_MINUTE_MS: '400', ...discordEnv };
    const args = ['run', '--rm', '--name', name, '--network', 'host', '-v', 'lumio-e2e-data:/data', ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]), IMAGE];
    const p = watchOutput(spawn('docker', args, { stdio: ['ignore', 'pipe', 'inherit'] }));
    const kill = p.kill.bind(p);
    p.kill = () => { spawn('docker', ['stop', name], { stdio: 'ignore' }); return kill('SIGTERM'); };
    return p;
  }
  const p = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: path.join(ROOT, 'server'),
    env: {
      ...process.env, PORT: String(APP_PORT), PUBLIC_URL: APP, DATA_DIR: DATA, LOG_LEVEL: 'warn',
      TWITCH_ID_BASE: `http://localhost:${TW_PORT}`, TWITCH_API_BASE: `http://localhost:${TW_PORT}`,
      TWITCH_IRC_URL: `ws://localhost:${TW_PORT}/irc`, GIPHY_API_BASE: `http://localhost:${TW_PORT}`, TWITCH_EVENTSUB_URL: `ws://localhost:${TW_PORT}/eventsub`, SE_API_BASE: `http://localhost:${TW_PORT}/se`, TIMER_MINUTE_MS: '400', ...discordEnv,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return watchOutput(p);
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
  // 0. First-run setup wizard: Twitch app credentials entered on the website, guarded by the log-only code
  await page.getByText('Eerste installatie').waitFor();
  await waitFor(() => setupCode);
  check(Boolean(setupCode), 'Setup-code staat alleen in de serverlogs');
  const fill = async (code, secret) => {
    await page.getByPlaceholder('XXXX-XXXX-XXXX').fill(code);
    await page.getByLabel('Client ID').fill('testclient123');
    await page.getByLabel('Client Secret').fill(secret);
    await page.getByRole('button', { name: 'Opslaan en doorgaan' }).click();
  };
  await fill('AAAA-BBBB-CCCC', 'testsecret456');
  await page.getByText('Onjuiste setup-code').waitFor();
  check(true, 'Setup met verkeerde code wordt geweigerd');
  await fill(setupCode, 'verkeerdsecret99');
  await page.getByText('Twitch accepteert deze').waitFor();
  check(true, 'Verkeerd Client Secret wordt bij Twitch gecontroleerd en geweigerd');
  await fill(setupCode, 'testsecret456');
  await page.getByRole('link', { name: /Koppel je Twitch-account/ }).waitFor();
  check(true, 'Twitch-gegevens via de website ingesteld');
  const again = await fetch(`${APP}/setup/twitch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: setupCode, clientId: 'evilclient123', clientSecret: 'evilsecret123' }) });
  check(again.status === 409, 'Setup kan daarna niet opnieuw (ook niet met dezelfde code)');
  await page.getByRole('link', { name: /Koppel je Twitch-account/ }).click();
  await page.waitForURL('**/dashboard');
  await page.getByText('Verbonden met Twitch').waitFor({ timeout: 10000 });
  check(true, 'Streamer koppelt Twitch via OAuth en dashboard toont "Verbonden met Twitch"');
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
  await p2.getByText('Verbonden met Twitch').waitFor({ timeout: 10000 });
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
  const owner = await p1.evaluate(() => fetch('/api/admin/twitch-app').then((r) => r.json()));
  check(owner.source === 'setup' && owner.clientId === 'testclient123' && owner.secretSet && !JSON.stringify(owner).includes('testsecret456'), 'Eigenaar ziet Twitch-app, secret wordt nooit teruggestuurd');
  const notOwner = await p2.evaluate(() => fetch('/api/admin/twitch-app').then((r) => r.status));
  check(notOwner === 403, 'Andere streamer mag Twitch-app niet wijzigen');
  check(statuses.includes('knuffel:cooldown') && statuses.filter((s) => s === 'knuffel:triggered').length === 2, `Activiteit: ${statuses.reverse().join(', ')}`);
  // 12. Recipient name: optional (fallback) vs. required
  const cmds = await p1.evaluate(() => fetch('/api/commands').then((r) => r.json()));
  const love = cmds.find((c) => c.name === 'love');
  const saved = await p1.evaluate((c) => fetch(`/api/commands/${c.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...c, targetMode: 'required', userCooldownSec: 0, globalCooldownSec: 0 }) }).then((r) => r.json()), love);
  check(saved.targetMode === 'required', 'Ontvanger-naam verplicht instellen via de API');
  await waitFor(async () => (await overlay.locator('.lm-item').count()) === 0, 10000);
  tw.chat('knuffelstreamer', { login: 'lover', display: 'Lover', userId: '5010', id: 'msg-9', text: '!love' });
  await sleep(1000);
  check((await overlay.locator('.lm-item').count()) === 0, 'Verplichte naam: "!love" zonder naam doet niets');
  tw.chat('knuffelstreamer', { login: 'lover', display: 'Lover', userId: '5010', id: 'msg-10', text: '!love @BesteVriend' });
  await overlay.waitForSelector('.lm-scene-love', { timeout: 3000 });
  const loveText = await overlay.locator('.lm-text').textContent();
  check(loveText === 'Lover stuurt liefde naar BesteVriend!', `Met naam: "${loveText}"`);
  const denied = (await p1.evaluate(() => fetch('/api/activity').then((r) => r.json()))).find((a) => a.commandName === 'love' && a.status === 'denied');
  check(denied?.detail?.includes('geen naam'), 'Activiteit toont "geen naam opgegeven"');

  // Text can be switched off entirely: only the animation / GIF is shown
  const dance = cmds.find((c) => c.name === 'dance');
  const noText = await p1.evaluate((c) => fetch(`/api/commands/${c.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...c, showText: false, text: '', userCooldownSec: 0, globalCooldownSec: 0 }) }).then((r) => r.json()), dance);
  check(noText.showText === false, 'Tekst uitzetten (ook met lege tekst) wordt geaccepteerd');
  await waitFor(async () => (await overlay.locator('.lm-item').count()) === 0, 10000);
  tw.chat('knuffelstreamer', { login: 'stil', display: 'Stil', userId: '5011', id: 'msg-11', text: '!dance' });
  await overlay.waitForSelector('.lm-scene-dance', { timeout: 3000 });
  check((await overlay.locator('.lm-text').count()) === 0, 'Zonder tekst: alleen de animatie in de overlay');

  // Character style "Mensen": human-proportioned figures instead of chibis
  const hug = cmds.find((c) => c.name === 'hug');
  const people = await p1.evaluate((c) => fetch(`/api/commands/${c.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...c, characterStyle: 'people', userCooldownSec: 0, globalCooldownSec: 0 }) }).then((r) => r.json()), hug);
  check(people.characterStyle === 'people', 'Stijl "Mensen" instellen per command');
  await waitFor(async () => (await overlay.locator('.lm-item').count()) === 0, 10000);
  tw.chat('knuffelstreamer', { login: 'mens', display: 'Mens', userId: '5012', id: 'msg-12', text: '!hug' });
  await overlay.waitForSelector('.lm-scene-hug', { timeout: 3000 });
  check((await overlay.locator('.lm-scene-hug .lm-person').count()) === 2, 'Overlay toont de knuffel met twee "Mensen"-poppetjes');
  await sleep(1700);
  await overlay.screenshot({ path: path.join(OUT, '11-overlay-mensen.png'), omitBackground: true });

  // Walk-in: characters walk towards each other before the high five
  const hf = cmds.find((c) => c.name === 'highfive');
  const walking = await p1.evaluate((c) => fetch(`/api/commands/${c.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...c, walkIn: true, durationMs: 7000, userCooldownSec: 0, globalCooldownSec: 0 }) }).then((r) => r.json()), hf);
  check(walking.walkIn === true, '"Naar elkaar toe lopen" instellen per command');
  await waitFor(async () => (await overlay.locator('.lm-item').count()) === 0, 10000);
  tw.chat('knuffelstreamer', { login: 'loper', display: 'Loper', userId: '5013', id: 'msg-13', text: '!highfive @Vriend' });
  await overlay.waitForSelector('.lm-scene-highfive.lm-walk', { timeout: 3000 });
  await sleep(700);
  const clapEarly = await overlay.evaluate(() => getComputedStyle(document.querySelector('.lm-clap')).opacity);
  await sleep(2100);
  const clapLate = await overlay.evaluate(() => getComputedStyle(document.querySelector('.lm-clap')).opacity);
  check(clapEarly === '0' && Number(clapLate) > 0.9, `Eerst lopen, daarna high five (ster ${clapEarly} → ${clapLate})`);
  await p1.goto(`${APP}/commands/${hug.id}`);
  await p1.getByRole('button', { name: /Mensen/ }).waitFor();
  check((await p1.getByRole('button', { name: /Mensen/ }).getAttribute('aria-pressed')) === 'true', 'Editor toont gekozen stijl "Mensen"');
  await sleep(1800);
  await p1.screenshot({ path: path.join(OUT, '12-editor-mensen.png') });

  await p1.goto(`${APP}/commands/${(await p1.evaluate(() => fetch('/api/commands').then((r) => r.json()))).find((c) => c.name === 'knuffel').id}`);
  await p1.waitForSelector('.lm-scene-hug', { timeout: 5000 });
  await sleep(1800);
  await p1.screenshot({ path: path.join(OUT, '5-editor.png') });

  // 13. Editor: easy way back, with a guard against losing unsaved changes
  const back = p1.getByRole('button', { name: 'Terug naar commands' });
  await back.click();
  await p1.waitForURL('**/commands');
  check(true, 'Zonder wijzigingen: "Terug naar commands" gaat direct terug');
  await p1.locator('.card', { hasText: '!knuffel' }).getByRole('link', { name: 'Bewerken' }).click();
  await p1.getByRole('button', { name: 'Tekst & stijl' }).click();
  await p1.locator('input[maxlength="200"]').fill('{user} knuffelt {target} heel hard!');
  const bar = p1.getByRole('status').filter({ hasText: 'Niet opgeslagen wijzigingen' });
  check(await bar.isVisible(), 'Duidelijke balk "Niet opgeslagen wijzigingen" verschijnt na een wijziging');
  const barBox = await bar.boundingBox();
  const vp1 = p1.viewportSize();
  check(barBox && barBox.y > vp1.height / 2 && barBox.y + barBox.height <= vp1.height, 'Balk staat onderin het scherm (altijd in beeld)');
  await sleep(600);
  await p1.screenshot({ path: path.join(OUT, '13-niet-opgeslagen.png') });
  p1.once('dialog', (dlg) => dlg.dismiss());
  await p1.getByRole('link', { name: 'Dashboard' }).first().click();
  await sleep(300);
  check(/\/commands\/\d+$/.test(p1.url()), 'Menu-link met openstaande wijzigingen: bevestiging, annuleren blijft in de editor');
  await bar.getByRole('button', { name: 'Ongedaan maken' }).click();
  check(!(await bar.isVisible()), '"Ongedaan maken" zet alles terug en de balk verdwijnt');
  await p1.locator('input[maxlength="200"]').fill('{user} knuffelt {target} heel hard!');
  await p1.keyboard.press('Control+s');
  await p1.getByText('!knuffel opgeslagen').waitFor();
  check(!(await bar.isVisible()), 'Ctrl+S slaat op en de balk verdwijnt');
  await p1.locator('input[maxlength="200"]').fill('{user} geeft {target} een knuffel!');
  p1.once('dialog', (dlg) => dlg.dismiss());
  await back.click();
  await sleep(300);
  check(/\/commands\/\d+$/.test(p1.url()), 'Met wijzigingen: bevestiging gevraagd, annuleren blijft in de editor');
  p1.once('dialog', (dlg) => dlg.accept());
  await back.click();
  await p1.waitForURL('**/commands');
  check(true, 'Bevestigen gaat terug naar de commandlijst');

  // 15. GIPHY: owner stores the key in Settings, then searches and picks a GIF in the editor
  await p1.goto(`${APP}/settings`);
  const keyInput = p1.getByLabel('GIPHY API-sleutel');
  await keyInput.fill('verkeerdesleutel1234567');
  await p1.getByRole('button', { name: 'Opslaan', exact: true }).click();
  await p1.getByText('GIPHY accepteert deze API-sleutel niet').waitFor();
  check(true, 'GIPHY: verkeerde sleutel wordt geweigerd');
  await keyInput.fill('giphytestkey1234567890');
  await p1.getByRole('button', { name: 'Opslaan', exact: true }).click();
  await p1.getByText('GIPHY ingesteld').waitFor();
  check(true, 'GIPHY: sleutel opgeslagen via Instellingen');
  const leaks = await p1.evaluate(async () => [await (await fetch('/api/me')).text(), await (await fetch('/api/admin/giphy')).text(), await (await fetch('/api/giphy/search?q=hug')).text()].join(''));
  check(!leaks.includes('giphytestkey1234567890'), 'GIPHY-sleutel komt nooit in de browser');
  check((await p2.evaluate(() => fetch('/api/admin/giphy').then((r) => r.status))) === 403, 'GIPHY-sleutel alleen door eigenaar te beheren');
  const knuffelId = (await p1.evaluate(() => fetch('/api/commands').then((r) => r.json()))).find((c) => c.name === 'knuffel').id;
  await p1.goto(`${APP}/commands/${knuffelId}`);
  await p1.getByRole('button', { name: 'Zoek op GIPHY' }).click();
  const dlg = p1.getByRole('dialog', { name: 'GIF zoeken op GIPHY' });
  await dlg.getByText('Trending').waitFor();
  await dlg.getByPlaceholder(/Zoek een GIF/).fill('hug');
  await dlg.getByTitle('hug gif 0', { exact: true }).waitFor();
  check((await dlg.getByText('Powered by GIPHY').count()) === 1, 'GIPHY: zoekresultaten met "Powered by GIPHY"');
  await dlg.getByRole('button', { name: 'Meer laden' }).click();
  await dlg.getByTitle('hug gif 24', { exact: true }).waitFor();
  check(true, 'GIPHY: meer resultaten laden');
  const box = await dlg.boundingBox();
  const vp = p1.viewportSize();
  const centred = box && box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width && box.y + box.height <= vp.height && Math.abs(box.x + box.width / 2 - vp.width / 2) < 4;
  check(centred, `GIPHY-venster staat volledig en gecentreerd in beeld (${Math.round(box?.x)},${Math.round(box?.y)} ${Math.round(box?.width)}×${Math.round(box?.height)})`);
  await p1.screenshot({ path: path.join(OUT, '8-giphy.png') });
  await dlg.getByTitle('hug gif 3', { exact: true }).click();
  await p1.getByText('Gekozen GIF').waitFor();
  check(await p1.getByRole('status').filter({ hasText: 'Niet opgeslagen' }).isVisible(), 'Na kiezen van een GIF: melding "niet opgeslagen"');
  await p1.getByRole('status').getByRole('button', { name: 'Opslaan' }).click();
  await p1.getByText('!knuffel opgeslagen').waitFor();
  const withGif = (await p1.evaluate(() => fetch('/api/commands').then((r) => r.json()))).find((c) => c.name === 'knuffel');
  check(withGif.imageUrl === 'https://media.giphy.com/media/hug-3/giphy.gif', `GIPHY-GIF opgeslagen bij !knuffel (${withGif.imageUrl})`);

  // 14. Layout: command list next to the canvas
  await p1.setViewportSize({ width: 1440, height: 1000 });
  await p1.goto(`${APP}/overlay`);
  const list = p1.getByRole('list', { name: 'Commands in de overlay' });
  await list.waitFor();
  const visibleCount = (await p1.evaluate(() => fetch('/api/commands').then((r) => r.json()))).filter((c) => c.animation !== 'none').length;
  check((await list.getByRole('listitem').count()) === visibleCount, `Indeling toont lijst met alle ${visibleCount} overlay-elementen (commands + alerts)`);
  await list.getByRole('button', { name: /!love/ }).click();
  await p1.getByRole('button', { name: 'Test in OBS' }).waitFor();
  check(true, 'Command in lijst selecteren toont Test/Bewerken');
  await sleep(1500);
  await p1.getByText('Indeling', { exact: true }).scrollIntoViewIfNeeded();
  await p1.screenshot({ path: path.join(OUT, '7-layout.png') });

  // 16. Commands page: hero grid and list view, choice remembered
  await p1.goto(`${APP}/commands`);
  await p1.locator('article.card').first().waitFor();
  check((await p1.locator('article.card').count()) === 5, 'Hero grid toont alle commands als kaart met visual');
  await sleep(400);
  await p1.screenshot({ path: path.join(OUT, '9-commands-grid.png') });
  await p1.getByRole('button', { name: 'Lijst' }).click();
  await p1.locator('ul li', { hasText: '!knuffel' }).waitFor();
  await p1.reload();
  await p1.locator('ul li', { hasText: '!knuffel' }).waitFor();
  check((await p1.locator('article.card').count()) === 0, 'Lijstweergave wordt onthouden na herladen');
  await sleep(600);
  await p1.screenshot({ path: path.join(OUT, '10-commands-list.png') });
  await p1.getByRole('button', { name: 'Grid' }).click();
  await p1.goto(`${APP}/dashboard`);
  await p1.getByText('Recente activiteit').waitFor();
  await sleep(600);
  await p1.screenshot({ path: path.join(OUT, '6-dashboard-activity.png') });

  // ===== 17. Chat replies, timers, alerts (EventSub) and the StreamElements import =====
  const api1 = (url, method = 'GET', body) => p1.evaluate(([u, m, b]) => fetch(u, { method: m, headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ status: r.status, json: await r.json() })), [url, method, body]);
  const sentIncludes = (txt) => waitFor(() => tw.state.sent.some((l) => l.includes(txt)), 6000);
  const baseCmd = (await api1('/api/commands')).json.find((c) => c.name === 'knuffel');
  const mk = (over) => ({ ...baseCmd, id: undefined, aliases: [], reply: null, trigger: 'chat', minAmount: 0, userCooldownSec: 0, globalCooldownSec: 0, ...over });

  let r = await api1('/api/commands', 'POST', mk({ name: 'discord', animation: 'none', text: '', showText: false, reply: 'Join onze Discord {user}! Gebruikt: {count}x {random:5-5}', aliases: ['dc'] }));
  check(r.status === 201, 'Chat-command zonder animatie (alleen antwoord) aanmaken');
  tw.chat('knuffelstreamer', { login: 'chatter', display: 'Chatter', userId: '7001', id: 'msg-c1', text: '!dc' });
  check(await sentIncludes('PRIVMSG #knuffelstreamer :Join onze Discord Chatter! Gebruikt: 1x 5'), 'Bot antwoordt in de chat via alias !dc met {user}, {count} en {random}');
  await api1('/api/commands', 'POST', mk({ name: 'echo', animation: 'none', text: '', showText: false, reply: '{args}' }));
  tw.chat('knuffelstreamer', { login: 'stout', display: 'Stout', userId: '7002', id: 'msg-c2', text: '!echo /ban knuffelstreamer' });
  await sentIncludes('ban knuffelstreamer');
  check(!tw.state.sent.some((l) => l.includes(':/ban')), 'Kijker kan via {args} geen chatcommando (/ban) laten uitvoeren');

  r = await api1('/api/timers', 'POST', { name: 'Test timer', messages: ['Timer bericht A', 'Timer bericht B'], intervalMin: 1, offlineIntervalMin: 0, minChatLines: 2, enabled: true });
  check(r.status === 201, 'Timer aanmaken');
  await sleep(1200);
  check(!tw.state.sent.some((l) => l.includes('Timer bericht A')), 'Timer wacht op genoeg chatberichten');
  tw.chat('knuffelstreamer', { login: 'a1', display: 'A1', userId: '7003', id: 'msg-t1', text: 'hoi' });
  tw.chat('knuffelstreamer', { login: 'a2', display: 'A2', userId: '7004', id: 'msg-t2', text: 'hallo' });
  check(await sentIncludes('Timer bericht A'), 'Timer stuurt bericht na interval + minimaal aantal chatberichten');
  await api1(`/api/timers/${r.json.id}`, 'PUT', { ...r.json, enabled: false });

  const subscribed = await waitFor(async () => (await api1('/api/me')).json.alerts.subscribed.length === 6, 8000);
  check(Boolean(subscribed), 'EventSub verbonden: follows, subs, resubs, gifts, bits en raids');
  check(tw.state.subs.some((s) => s.type === 'channel.follow' && s.condition.moderator_user_id === '1001' && s.transport.method === 'websocket'), 'Follow-abonnement met juiste condition en websocket-transport');
  await waitFor(async () => (await overlay.locator('.lm-item').count()) === 0, 15000);
  tw.event('channel.follow', { user_id: '9001', user_name: 'NieuweVolger', broadcaster_user_id: '1001' }, 'follow-1');
  tw.event('channel.follow', { user_id: '9001', user_name: 'NieuweVolger', broadcaster_user_id: '1001' }, 'follow-1');
  await overlay.waitForSelector('.lm-scene-wave', { timeout: 4000 });
  check((await overlay.locator('.lm-text').textContent()) === 'Bedankt voor de follow, NieuweVolger!', 'Follow-alert verschijnt in de overlay');
  await waitFor(async () => (await overlay.locator('.lm-item').count()) === 0, 10000);
  await sleep(800);
  check((await overlay.locator('.lm-item').count()) === 0, 'Dubbel afgeleverd Twitch-event speelt maar één keer');
  r = await api1('/api/commands', 'POST', mk({ name: 'mega-cheer', trigger: 'cheer', minAmount: 500, animation: 'dance', text: 'MEGA {amount} van {user}!', showText: true, targetMode: 'none' }));
  check(r.status === 201, 'Bits-variant vanaf 500 aanmaken');
  tw.event('channel.cheer', { user_name: 'Rijk', bits: 1000, message: 'Cheer1000', is_anonymous: false });
  await overlay.waitForSelector('.lm-scene-dance', { timeout: 4000 });
  check((await overlay.locator('.lm-text').textContent()) === 'MEGA 1000 van Rijk!', 'Variant met hoogste passende minimum wordt gekozen (1000 bits → vanaf 500)');
  await waitFor(async () => (await overlay.locator('.lm-item').count()) === 0, 10000);
  tw.event('channel.cheer', { user_name: 'Klein', bits: 50, message: '', is_anonymous: false });
  await overlay.waitForSelector('.lm-text', { timeout: 4000 });
  check((await overlay.locator('.lm-text').textContent()) === 'Klein cheert 50 bits!', 'Onder het minimum: standaard bits-alert');
  await waitFor(async () => (await overlay.locator('.lm-item').count()) === 0, 10000);

  await p1.goto(`${APP}/import`);
  await p1.getByLabel('StreamElements JWT-token').fill('fout.token.hier');
  await p1.getByRole('button', { name: 'Ophalen' }).click();
  await p1.getByText('weigert dit JWT-token').waitFor();
  check(true, 'Import: ongeldig JWT geeft een duidelijke foutmelding');
  await p1.getByLabel('StreamElements JWT-token').fill('aaa.bbb.ccc');
  await p1.getByRole('button', { name: 'Ophalen' }).click();
  await p1.getByText('!socials').waitFor();
  check(await p1.getByText('Variabelen niet ondersteund (blijven als tekst staan): ${uptime}').isVisible(), 'Import: niet-ondersteunde variabelen worden gemeld');
  check(!(await p1.getByText('Video wordt niet ondersteund').isVisible()), 'Import: video-alerts worden gewoon overgenomen (geen waarschuwing meer)');
  check(await p1.getByText('Twitch heeft hosts afgeschaft').isVisible(), 'Import: host-alert overgeslagen met uitleg');
  await sleep(300);
  await p1.screenshot({ path: path.join(OUT, '14-import-preview.png'), fullPage: true });
  await p1.getByRole('button', { name: /onderdelen importeren/ }).click();
  await p1.getByText('Import voltooid').waitFor();
  const imported = (await api1('/api/commands')).json;
  const socials = imported.find((c) => c.name === 'socials');
  check(socials?.reply === 'Socials van {channel}: discord.gg/test (aangeroepen door {user})' && socials.aliases.includes('links') && !socials.aliases.includes('dc'), `Command geïmporteerd met omgezette variabelen; alias die al bestond (dc) overgeslagen`);
  const koekje = imported.find((c) => c.name === 'koekje');
  check(koekje?.permission === 'moderator' && koekje.reply.startsWith('{user} geeft {target} {random:1-10} koekjes') && koekje.targetFallback === '{user}', 'accessLevel 500 → moderator; ${touser} → {target} met {user} als terugval');
  const timersNow = (await api1('/api/timers')).json;
  check(timersNow.some((t) => t.name === 'Socials timer' && t.intervalMin === 20 && t.minChatLines === 5 && t.messages[0] === 'Volg me op Insta: @knuffel'), 'Timer geïmporteerd (interval en chatLines)');
  const seFollow = imported.find((c) => c.name === 'se-follow-0');
  check(seFollow?.enabled && seFollow.animation === 'image' && seFollow.imageUrl.includes('default.gif') && seFollow.text === '{user} volgt nu!' && seFollow.style.accentColor === '#3f51b5', 'Follow-alert geïmporteerd met afbeelding, geluid, tekst en kleur');
  check(imported.find((c) => c.name === 'alert-follow')?.enabled === false, 'Lumio-standaard follow-alert is uitgezet zodat er geen dubbele alert komt');
  check(imported.some((c) => c.trigger === 'resub' && c.minAmount === 2) && imported.some((c) => c.trigger === 'gift' && c.text === '{user} gifted de chat a subscription!'), 'Sub-variaties: resub (vanaf 2 maanden) en gift overgenomen');
  check(imported.some((c) => c.trigger === 'raid' && c.minAmount === 5), 'Raid minimum (5 kijkers) overgenomen');
  check(imported.find((c) => c.name === 'mega-cheer')?.enabled === true, 'Zelfgemaakte alert-varianten blijven aan na import');
  check(imported.find((c) => c.name === 'se-cheer-0')?.imageUrl === 'https://cdn.example.com/cheer.webm' && imported.find((c) => c.name === 'se-cheer-0')?.animation === 'image', 'Video-alert (WebM) uit StreamElements overgenomen');
  tw.chat('knuffelstreamer', { login: 'fan9', display: 'Fan9', userId: '7009', id: 'msg-i1', text: '!links' });
  check(await sentIncludes('Socials van knuffelstreamer: discord.gg/test (aangeroepen door Fan9)'), 'Geïmporteerd command werkt in de chat (via alias !links)');
  tw.event('channel.follow', { user_name: 'ImportVolger' }, 'follow-2');
  await overlay.waitForSelector('.lm-image', { timeout: 4000, state: 'attached' });
  check((await overlay.locator('.lm-text').textContent()) === 'ImportVolger volgt nu!', 'Geïmporteerde follow-alert speelt in de overlay');
  await sleep(500);
  await overlay.screenshot({ path: path.join(OUT, '15-overlay-import-alert.png'), omitBackground: true });
  await p1.goto(`${APP}/alerts`);
  await p1.getByText('Twitch-events verbonden').waitFor();
  await sleep(400);
  await p1.screenshot({ path: path.join(OUT, '16-alerts.png'), fullPage: true });

  // ===== 18. Discord: one-time bot setup, "connect your server", welcome images =====
  const BOT_TOKEN = `${'d'.repeat(30)}.discord.${'t'.repeat(30)}`;
  await p1.goto(`${APP}/discord`);
  await p1.getByText('Discord-bot instellen (eenmalig, eigenaar)').waitFor();
  await p1.getByLabel('Application ID').fill('123456789012345678');
  await p1.getByLabel('Client Secret').fill('discordsecret1234567890');
  await p1.getByLabel('Bot-token').fill(`${'x'.repeat(30)}.discord.${'t'.repeat(30)}`);
  await p1.getByRole('button', { name: 'Bot opslaan' }).click();
  await p1.getByText('Discord weigert het bot-token').waitFor();
  check(true, 'Discord: verkeerd bot-token wordt geweigerd');
  await p1.getByLabel('Bot-token').fill(BOT_TOKEN);
  await p1.getByRole('button', { name: 'Bot opslaan' }).click();
  await p1.getByText('Bot LumioBot is ingesteld').waitFor();
  check(!(await p1.evaluate(async () => [await (await fetch('/api/admin/discord')).text(), await (await fetch('/api/discord')).text()].join(''))).includes('discord.ttt'), 'Discord: bot-token komt nooit terug in de browser');
  check(Boolean(await waitFor(async () => (await api1('/api/discord')).json.bot.status === 'connected', 8000)), 'Discord-bot verbonden met de Gateway');
  check((await p2.evaluate(() => fetch('/api/admin/discord').then((r) => r.status))) === 403, 'Alleen de eigenaar beheert de Discord-bot');

  await p1.goto(`${APP}/discord`);
  await p1.getByRole('link', { name: 'Verbind je Discord-server' }).first().click();
  await p1.getByRole('region', { name: 'Discord-server Knuffel Discord' }).waitFor();
  check(true, 'Streamer verbindt zijn Discord-server met één klik (OAuth bot-uitnodiging)');
  const guildBox = p1.getByRole('region', { name: 'Discord-server Knuffel Discord' });
  await guildBox.getByRole('combobox').selectOption({ label: '#welkom' });
  check((await guildBox.getByRole('combobox').locator('option').allTextContents()).every((t) => !t.includes('Voice')), 'Alleen tekstkanalen zijn te kiezen');
  await guildBox.getByLabel('Titel', { exact: true }).fill('Welkom {name}!');
  const prev = guildBox.getByAltText('Voorbeeld van het welkomstplaatje');
  await prev.waitFor();
  await sleep(900);
  check((await prev.evaluate((img) => img.naturalWidth)) === 1100, 'Live preview van het welkomstplaatje (door de server gerenderd)');
  await guildBox.getByRole('button', { name: 'Opslaan' }).click();
  await p1.getByText('Welkomstinstellingen opgeslagen').waitFor();

  tw.discordJoin({ id: '555000000000000001', username: 'nieuwkomer', global_name: 'Nieuwkomer', avatar: null });
  check(Boolean(await waitFor(() => tw.state.discordPosts.length === 1, 8000)), 'Iemand joint de Discord → welkomstbericht verstuurd');
  const post = tw.state.discordPosts[0];
  check(post.channel === '111' && post.payload.content === 'Welkom <@555000000000000001> in Knuffel Discord! 🎉' && post.payload.allowed_mentions.users[0] === '555000000000000001', `In het gekozen kanaal, met vermelding: "${post.payload.content}"`);
  check(post.file.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && post.file.length > 5000, `Met PNG-welkomstplaatje (${Math.round(post.file.length / 1024)} KB)`);
  fs.writeFileSync(path.join(OUT, '17-discord-welkom.png'), post.file);
  tw.discordJoin({ id: '555000000000000001', username: 'nieuwkomer', global_name: 'Nieuwkomer', avatar: null });
  tw.discordJoin({ id: '666000000000000001', username: 'somebot', avatar: null, bot: true });
  await sleep(1200);
  check(tw.state.discordPosts.length === 1, 'Geen dubbel welkom en bots worden niet verwelkomd');
  await guildBox.getByRole('button', { name: 'Test sturen' }).click();
  await p1.getByText('Testbericht verstuurd in Discord').waitFor();
  check(tw.state.discordPosts[1]?.payload.content === 'Welkom **KnuffelStreamer** in Knuffel Discord! 🎉' && tw.state.discordPosts[1].payload.allowed_mentions.users.length === 0, 'Test sturen werkt (zonder echte vermelding)');
  const gNow = (await api1('/api/discord')).json.guilds[0];
  await api1(`/api/discord/guilds/${gNow.id}`, 'PUT', { ...gNow, message: 'Hallo {user},\r\n\r\nWelkom in {server}!\nLees de regels.' });
  await api1(`/api/discord/guilds/${gNow.id}/test`, 'POST');
  check(tw.state.discordPosts.at(-1)?.payload.content === 'Hallo **KnuffelStreamer**,\n\nWelkom in Knuffel Discord!\nLees de regels.', 'Welkomstbericht over meerdere regels blijft netjes behouden');
  await p1.reload();
  await p1.getByRole('region', { name: 'Discord-server Knuffel Discord' }).waitFor();
  check((await p1.getByRole('region', { name: 'Discord-server Knuffel Discord' }).locator('textarea').first().inputValue()) === 'Hallo {user},\n\nWelkom in {server}!\nLees de regels.', 'Berichtveld toont de meerdere regels');
  check((await p2.evaluate(() => fetch('/api/discord').then((r) => r.json()))).guilds.length === 0, 'Andere streamer ziet jouw Discord-server niet');

  // Own bot look on this server: name, profile photo, bio
  const pngUpload = await p1.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = c.height = 300;
    const x = c.getContext('2d');
    x.fillStyle = '#ec4899';
    x.fillRect(0, 0, 300, 300);
    x.fillStyle = '#fff';
    x.font = 'bold 160px sans-serif';
    x.fillText('K', 90, 210);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const fd = new FormData();
    fd.append('file', new File([blob], 'botfoto.png', { type: 'image/png' }));
    return (await fetch('/api/uploads', { method: 'POST', body: fd })).json();
  });
  await p1.reload();
  const profileBox = p1.getByRole('region', { name: 'Bot-profiel op Knuffel Discord' });
  await profileBox.waitFor();
  await profileBox.getByLabel('Naam van de bot').fill('KnuffelBot');
  await profileBox.getByTitle('botfoto.png').click();
  await profileBox.getByLabel('Over mij').fill('De officiële bot van KnuffelStreamer 💜');
  await profileBox.getByRole('button', { name: 'Bot-profiel opslaan' }).click();
  await p1.getByText('Bot-profiel op Knuffel Discord bijgewerkt').waitFor();
  const prof = tw.state.discordProfile;
  check(prof?.nick === 'KnuffelBot' && prof.bio === 'De officiële bot van KnuffelStreamer 💜' && prof.avatar?.startsWith('data:image/png;base64,'), 'Eigen botnaam, profielfoto en bio naar Discord gestuurd (alleen voor deze server)');
  check((await api1('/api/discord')).json.guilds[0].botProfile.avatar === pngUpload.url, 'Bot-profiel bewaard');

  await sleep(400);
  await p1.screenshot({ path: path.join(OUT, '18-discord.png'), fullPage: true });

  // ===== 19. Video: upload a real WebM clip and play it via a chat command, for exactly its own length =====
  const vid = await p1.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 180;
    const x = c.getContext('2d');
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm' });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.start();
    const t0 = performance.now();
    await new Promise((resolve) => {
      const draw = () => {
        const t = performance.now() - t0;
        x.fillStyle = `hsl(${(t / 10) % 360} 80% 50%)`;
        x.fillRect(0, 0, 320, 180);
        if (t < 2000) requestAnimationFrame(draw);
        else resolve();
      };
      draw();
    });
    rec.stop();
    await new Promise((r) => (rec.onstop = r));
    const fd = new FormData();
    fd.append('file', new File([new Blob(chunks, { type: 'video/webm' })], 'clip.webm', { type: 'video/webm' }));
    const res = await fetch('/api/uploads', { method: 'POST', body: fd });
    return { status: res.status, json: await res.json() };
  });
  check(vid.status === 201 && vid.json.url.endsWith('.webm'), 'Video (WebM) uploaden in de mediabibliotheek');
  r = await api1('/api/commands', 'POST', mk({ name: 'clip', animation: 'image', imageUrl: vid.json.url, useVideoLength: true, durationMs: 15000, text: '{user} speelt een clip!', showText: true }));
  check(r.status === 201 && r.json.useVideoLength === true, 'Command met video en "duur = lengte van de video"');
  await waitFor(async () => (await overlay.locator('.lm-item').count()) === 0, 15000);
  const tv = Date.now();
  tw.chat('knuffelstreamer', { login: 'cliplover', display: 'ClipLover', userId: '7020', id: 'msg-v1', text: '!clip' });
  await overlay.waitForSelector('video.lm-image', { timeout: 6000 });
  const vstate = await overlay.evaluate(() => {
    const v = document.querySelector('video.lm-image');
    return { paused: v.paused, loop: v.loop, src: v.getAttribute('src') };
  });
  check(vstate.src === vid.json.url && !vstate.paused && !vstate.loop, 'Overlay speelt de video af');
  const videoGone = await waitFor(async () => (await overlay.locator(".lm-item").count()) === 0, 12000);
  const shown = Date.now() - tv;
  check(Boolean(videoGone) && shown < 8000, `Video verdwijnt na zijn eigen lengte (${(shown / 1000).toFixed(1)}s i.p.v. de ingestelde 15s)`);
} finally {
  await browser.close();
  app.kill('SIGTERM');
  tw.close();
  fs.rmSync(DATA, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
