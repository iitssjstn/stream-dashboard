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

// Set E2E_DOCKER_IMAGE=stream-dashboard:latest to run the same test against the Docker image.
const IMAGE = process.env.E2E_DOCKER_IMAGE;
function startApp() {
  if (IMAGE) {
    const name = 'lumio-e2e';
    spawn('docker', ['rm', '-f', name], { stdio: 'ignore' });
    const env = { PORT: APP_PORT, PUBLIC_URL: APP, LOG_LEVEL: 'warn',
      TWITCH_ID_BASE: `http://localhost:${TW_PORT}`, TWITCH_API_BASE: `http://localhost:${TW_PORT}`, TWITCH_IRC_URL: `ws://localhost:${TW_PORT}/irc`, GIPHY_API_BASE: `http://localhost:${TW_PORT}` };
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
      TWITCH_IRC_URL: `ws://localhost:${TW_PORT}/irc`, GIPHY_API_BASE: `http://localhost:${TW_PORT}`,
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

  await p1.goto(`${APP}/commands/${(await p1.evaluate(() => fetch('/api/commands').then((r) => r.json()))).find((c) => c.name === 'knuffel').id}`);
  await p1.waitForSelector('.lm-scene-hug', { timeout: 5000 });
  await sleep(1800);
  await p1.screenshot({ path: path.join(OUT, '5-editor.png') });

  // 13. Editor: easy way back, with a guard against losing unsaved changes
  const back = p1.getByRole('button', { name: 'Terug naar commands' });
  await back.click();
  await p1.waitForURL('**/commands');
  check(true, 'Zonder wijzigingen: "Terug naar commands" gaat direct terug');
  await p1.getByRole('link', { name: 'Bewerken' }).first().click();
  await p1.getByRole('button', { name: 'Tekst & stijl' }).click();
  await p1.locator('input[maxlength="200"]').fill('{user} knuffelt {target} heel hard!');
  check(await p1.getByText('niet opgeslagen').isVisible(), 'Label "niet opgeslagen" verschijnt na een wijziging');
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
  await p1.getByRole('button', { name: 'Opslaan', exact: true }).click();
  await p1.getByText('!knuffel opgeslagen').waitFor();
  const withGif = (await p1.evaluate(() => fetch('/api/commands').then((r) => r.json()))).find((c) => c.name === 'knuffel');
  check(withGif.imageUrl === 'https://media.giphy.com/media/hug-3/giphy.gif', `GIPHY-GIF opgeslagen bij !knuffel (${withGif.imageUrl})`);

  // 14. Layout: command list next to the canvas
  await p1.setViewportSize({ width: 1440, height: 1000 });
  await p1.goto(`${APP}/overlay`);
  const list = p1.getByRole('list', { name: 'Commands in de overlay' });
  await list.waitFor();
  check((await list.getByRole('listitem').count()) === 5, 'Indeling toont lijst met alle 5 commands');
  await list.getByRole('button', { name: /!love/ }).click();
  await p1.getByRole('button', { name: 'Test in OBS' }).waitFor();
  check(true, 'Command in lijst selecteren toont Test/Bewerken');
  await sleep(1500);
  await p1.getByText('Indeling', { exact: true }).scrollIntoViewIfNeeded();
  await p1.screenshot({ path: path.join(OUT, '7-layout.png') });
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
