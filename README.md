# Lumio – interactieve Twitch-overlays

Kijkers typen een command zoals `!knuffel` in je Twitch-chat en er verschijnt meteen een geanimeerde anime-scène in je OBS-stream. Je stelt per command de animatie, afbeelding/GIF, tekst, duur, cooldowns, permissies en geluid in.

- **Twitch OAuth** en chat via Twitch IRC (WebSocket, met tags voor badges en bericht-id's)
- **Command-engine**: permissies (iedereen / subs / VIP / mods / streamer), cooldown per gebruiker en globaal, dedupe op Twitch-bericht-id, `{user}`, `{target}` (`!knuffel @naam`) en `{channel}`
- **OBS-overlay**: losse, lichte pagina (~11 KB JS) met transparante achtergrond, realtime via WebSocket, een wachtrij, automatisch opnieuw verbinden en instelbare resolutie
- **Dashboard + editor**: live preview met precies dezelfde renderer als de overlay, positie verslepen, lettertype/kleur/grootte, effecten, deeltjes, uploads (PNG/JPG/GIF/WEBP/MP3/WAV/OGG)
- Standaard-commands: `!knuffel`, `!hug`, `!highfive`, `!love`, `!dance`

## Snel starten met Docker Compose

1. **Start** de app met het image dat GitHub Actions bouwt:
   ```bash
   docker compose pull && docker compose up -d
   ```
   Wil je liever lokaal bouwen? Gebruik dan `docker compose up -d --build`. Zet eventueel `PUBLIC_URL` in `.env` (zie `.env.example`); daar staan geen geheimen in.
2. **Haal de eenmalige setup-code** uit de logs:
   ```bash
   docker logs stream-dashboard | grep "SETUP CODE"
   ```
3. **Open `PUBLIC_URL`** (bijv. <http://localhost:3000>). De setup-wizard toont de *OAuth Redirect URL* die je in de Twitch-app invult. Maak de app aan op <https://dev.twitch.tv/console/apps> (categorie *Broadcasting Suite*) en vul daarna in de wizard de setup-code, de **Client ID** en het **Client Secret** in.
4. Klik op **Koppel je Twitch-account** en kopieer je overlay-URL. De eerste streamer die inlogt wordt **eigenaar** en kan de Twitch-app later wijzigen onder *Instellingen*.
5. Kies in OBS **Bronnen → + → Browser**, plak de URL en stel 1920×1080 in. Vink *Audio regelen via OBS* aan als je geluiden gebruikt.
6. Typ `!knuffel` in je chat. 🎉

### GIF's zoeken met GIPHY (optioneel)

Maak gratis een API-sleutel op <https://developers.giphy.com/dashboard/> (kies *API*). Vul hem daarna in als eigenaar onder **Instellingen → GIPHY**. In de command-editor verschijnt dan de knop **Zoek op GIPHY**.

De sleutel wordt versleuteld opgeslagen, en zoeken gaat via de server, zodat de sleutel nooit in de browser komt. Je kunt hem ook als Docker secret `giphy_api_key` meegeven.

### Hoe de Twitch-gegevens beveiligd zijn

- **Opslag:** de gegevens staan nergens in environment-variabelen of bestanden. Je vult ze één keer in op de website, waarna ze AES-256-GCM-versleuteld in de database staan. Het Client Secret wordt nooit meer naar de browser gestuurd.
- **Controle vooraf:** de wizard controleert de gegevens eerst bij Twitch en slaat ze pas daarna op.
- **Setup-code:** de wizard werkt alleen met de eenmalige setup-code uit de serverlogs, zodat niemand een verse installatie kan overnemen. Na de setup is de wizard dicht en mag alleen de eigenaar de gegevens nog wijzigen. Pogingen zijn beperkt tot 5 per minuut.
- **Sleutel apart (optioneel):** de encryptiesleutel wordt standaard in het data-volume aangemaakt. Wil je hem gescheiden van de database houden, zodat een gelekte back-up van het volume onbruikbaar is? Geef hem dan mee als Docker secret `token_encryption_key` (32 bytes, base64: `openssl rand -base64 32`).
- **Docker secrets (optioneel):** wil je de Twitch-gegevens toch liever als Docker secret beheren, dan hebben die voorrang op de wizard.

De app zoekt elk geheim op deze plekken, in deze volgorde: het bestand uit `<NAAM>_FILE`, daarna `/run/secrets/<naam>`, en pas als laatste de environment-variabele (alleen bedoeld voor lokale ontwikkeling). Het gaat om `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` en `TOKEN_ENCRYPTION_KEY`, allemaal optioneel.

De database, uploads en encryptiesleutel staan in het Docker-volume `lumio-data`, dus ze blijven bewaard na updates en herstarts.

```bash
docker compose logs -f              # logs bekijken
docker compose pull && docker compose up -d   # bijwerken naar het nieuwste image
```

### Op een server met eigen domein

Zet een reverse proxy met TLS (Caddy, Traefik, nginx) voor poort 3000 en stel `PUBLIC_URL=https://jouwdomein.nl` in. De overlay gebruikt dan automatisch `wss://` en cookies worden `Secure`. WebSocket-upgrades moeten worden doorgestuurd. Bij Caddy is dit genoeg:

```
jouwdomein.nl {
  reverse_proxy localhost:3000
}
```

## GitHub Actions

`.github/workflows/build.yml` draait bij elke push en pull request:

1. typecheck, build en de end-to-end test (screenshots komen als artifact bij de run);
2. daarna wordt een Docker-image voor `linux/amd64` en `linux/arm64` (bijv. Raspberry Pi) gebouwd en gepubliceerd naar `ghcr.io/iitssjstn/stream-dashboard` met de tags `latest`, `sha-…` en bij een tag `v1.2.3` ook `1.2.3` en `1.2`.

Het package is standaard privé. Maak het publiek via GitHub → je profiel → *Packages* → *stream-dashboard* → *Package settings*, of log eenmalig in met `docker login ghcr.io` (gebruikersnaam + een token met `read:packages`).

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
cp .env.example .env
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
