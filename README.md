# Lumio – interactieve Twitch-overlays

Kijkers typen een command zoals `!knuffel` in je Twitch-chat en er verschijnt meteen een geanimeerde anime-scène in je OBS-stream. Je stelt per command de animatie, afbeelding/GIF, tekst, duur, cooldowns, permissies en geluid in.

- **Twitch OAuth** en chat via Twitch IRC (WebSocket, met tags voor badges en bericht-id's)
- **Command-engine**: permissies (iedereen / subs / VIP / mods / streamer), cooldown per gebruiker en globaal, dedupe op Twitch-bericht-id, `{user}`, `{target}` (`!knuffel @naam`) en `{channel}`
- **OBS-overlay**: losse, lichte pagina (~11 KB JS) met transparante achtergrond, realtime via WebSocket, een wachtrij, automatisch opnieuw verbinden en instelbare resolutie
- **Dashboard + editor**: live preview met precies dezelfde renderer als de overlay, positie verslepen, lettertype/kleur/grootte, effecten, deeltjes, uploads (PNG/JPG/GIF/WEBP/MP3/WAV/OGG)
- Standaard-commands: `!knuffel`, `!hug`, `!highfive`, `!love`, `!dance`

## Snel starten met Docker Compose

1. **Maak een Twitch-app** op <https://dev.twitch.tv/console/apps>:
   - *OAuth Redirect URL*: `http://localhost:3000/auth/twitch/callback` (of `https://jouwdomein.nl/auth/twitch/callback`)
   - Categorie: *Broadcasting Suite*. Noteer de **Client ID** en maak een **Client Secret** aan.
2. **Configureer** de app:
   ```bash
   cp .env.example .env
   ```
   Vul `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` en `PUBLIC_URL` in. `PUBLIC_URL` moet overeenkomen met de redirect-URL uit stap 1.
3. **Start** de app:
   ```bash
   docker compose up -d --build
   ```
4. Open `PUBLIC_URL` (bijv. <http://localhost:3000>), klik op **Koppel je Twitch-account** en kopieer je overlay-URL.
5. Kies in OBS **Bronnen → + → Browser**, plak de URL en stel 1920×1080 in. Vink *Audio regelen via OBS* aan als je geluiden gebruikt.
6. Typ `!knuffel` in je chat. 🎉

De database, uploads en encryptiesleutel staan in het Docker-volume `lumio-data`, dus ze blijven bewaard na updates en herstarts.

```bash
docker compose logs -f              # logs bekijken
git pull && docker compose up -d --build   # bijwerken
```

### Op een server met eigen domein

Zet een reverse proxy met TLS (Caddy, Traefik, nginx) voor poort 3000 en stel `PUBLIC_URL=https://jouwdomein.nl` in. De overlay gebruikt dan automatisch `wss://` en cookies worden `Secure`. WebSocket-upgrades moeten worden doorgestuurd. Bij Caddy is dit genoeg:

```
jouwdomein.nl {
  reverse_proxy localhost:3000
}
```

## Architectuur

```
server/                     Node.js + Fastify + Drizzle (SQLite)
  src/twitch/               OAuth/Helix-API, token-refresh, IRC-chatverbinding per streamer
  src/commands/             Command-engine: parsing, permissies, cooldowns, dedupe
  src/overlay/              WebSocket-hub per streamer + route voor de browser source
  src/api/                  REST-API voor het dashboard (commands, uploads, activiteit, instellingen)
  src/auth/                 Sessies (httpOnly, signed cookies) en OAuth-callback
  drizzle/                  SQL-migraties (draaien automatisch bij het opstarten)
web/
  overlay.html, src/overlay Vanilla TS overlay (geen framework) + gedeelde renderer
  src/dashboard             React + Tailwind dashboard en editor
e2e/                        End-to-end test van de volledige keten
```

- **Onafhankelijke overlay**: de server houdt per streamer zelf een chatverbinding open (ook na een herstart), dus het dashboard hoeft niet open te staan.
- **Isolatie**: elke streamer heeft een geheim, willekeurig overlay-token. Sockets worden per gebruikers-id gegroepeerd en chatberichten worden alleen geaccepteerd voor het eigen kanaal.
- **Betrouwbaarheid**: heartbeat (ping/pong) in beide richtingen, exponential backoff, een watchdog in de overlay, een replay-buffer van 30 s voor events terwijl OBS herlaadt, en dedupe op server (Twitch-bericht-id) en client (event-id).
- **Beveiliging**: Twitch-tokens worden met AES-256-GCM versleuteld opgeslagen, de OAuth-state wordt gecontroleerd, chattekst wordt alleen als tekst gerenderd (nooit als HTML), uploads staan op een allowlist (geen SVG) met `nosniff`, en er is rate limiting.
- **PostgreSQL later**: het schema gebruikt alleen portable kolomtypes. Overstappen betekent `drizzle-orm/pg-core` + `drizzle-kit generate --dialect postgresql`.

## Lokaal ontwikkelen

```bash
npm run install:all
cp .env.example .env               # vul de Twitch-gegevens in
npm run dev:server                 # API op :3000
npm run dev:web                    # Vite op :5173 (proxy naar :3000)
```

Zet tijdens Vite-ontwikkeling `APP_URL=http://localhost:5173` in `.env`, zodat je na het inloggen terugkomt op de Vite-server.

## Tests

`e2e/run.mjs` test de hele keten met een echte browser (Playwright): OAuth-login, overlay-URL, de overlay als losse browser source, dashboard sluiten, een chatbericht `!knuffel`, de animatie verschijnt en verdwijnt, dedupe, cooldown, wachtrij, isolatie tussen streamers en een herstart van de server.

Omdat CI geen echte Twitch-chat kan aansturen, gebruikt de test `e2e/fake-twitch.mjs`. Die server spreekt hetzelfde OAuth-, Helix- en IRC-protocol als Twitch en wordt alleen in de test gebruikt. De app zelf praat altijd met de echte Twitch, tenzij je `TWITCH_*_BASE` / `TWITCH_IRC_URL` overschrijft.

```bash
npm i -g playwright && npx playwright install chromium
npm run test:e2e
E2E_DOCKER_IMAGE=stream-dashboard:latest node e2e/run.mjs   # zelfde test tegen het Docker-image
```
