# Overdracht (handoff)

> Dit bestand is het geheugen tussen chats. Begin een nieuwe chat met **`/hervat`**; sluit af met **`/hervat opslaan`**.

**Laatst bijgewerkt:** 2026-11-07, versie **1.0.0**

## Wat is Waviloop

Slogan: **Make your stream come alive.** (Engels, zo laten.)

Een webapp die lijkt op StreamElements, met een eigen ontwerp:

- **Twitch-chatcommands** (`!knuffel`, `!hug`, …) spelen animaties af in een **OBS-overlay** (Browser Source).
- **Anime-personages** of de stijl "Mensen", die naar elkaar toe kunnen lopen; eigen GIF's en video's (MP4/WebM); GIPHY.
- **Chat-antwoorden**, **timers** en **alerts** (follow, sub, resub, gift, bits, raid via Twitch EventSub).
- **StreamElements-import**: commands, timers en alerts.
- **Discord-bot**: één gedeelde bot; streamers voegen hem met één klik toe aan hun server(s). Welkomstplaatjes, een eigen bot-profiel per server.
- **Dashboard** in het Nederlands: donker, paars/blauw, neon-kaarten.

Repo: `iitssjstn/stream-dashboard` (openbaar). Productie draait bij de eigenaar via Docker Compose achter Nginx Proxy Manager (met **Websockets Support aan**).

> **Naam:** het project heette eerst *Lumio* en heet sinds 2026-11-07 **Waviloop**. Enkele interne namen zijn bewust gebleven, omdat bestaande installaties ervan afhangen: het databasebestand `lumio.sqlite`, de cookies `lumio_session`/`lumio_*_state`, het Docker-volume `lumio-data` en de CSS-prefix `lm-`. Verander die niet.

## Architectuur (kort)

```
server/   Node 22 + Fastify 5 + Drizzle (SQLite, migraties in server/drizzle, draaien automatisch)
  src/twitch/     OAuth, IRC-chat per streamer, EventSub (alerts), token-refresh
  src/commands/   engine (chat + alerts → overlay/chat-antwoord), standaard-commands/-alerts
  src/timers/     timer-scheduler
  src/overlay/    WebSocket-hub per streamer + overlay-route
  src/discord/    gateway-bot, REST, welkomstplaatje (canvas), routes
  src/import/     StreamElements-import
  src/setup/, settings.ts   setup-wizard en versleutelde instellingen (Twitch, GIPHY, Discord)
web/      React 19 + Vite 8 + Tailwind 4
  overlay.html + src/overlay/   lichte overlay (vanilla TS); renderer.ts wordt ook in de editor gebruikt
  src/dashboard/                 dashboard (pages/, components/)
e2e/      run.mjs (volledige keten met Playwright) + fake-twitch.mjs (testversie van Twitch, Discord, GIPHY en StreamElements)
scripts/release.mjs             versie ophogen
.github/workflows/build.yml      test → Docker-image (amd64+arm64, ghcr.io) → automatische release
```

Geheimen (Twitch, GIPHY, Discord) worden **op de website** ingevuld en AES-256-GCM-versleuteld opgeslagen. Ze staan nooit in de compose of de env; Docker secrets zijn optioneel en hebben voorrang.

## Werkafspraken

- **Taal:** Nederlands met de gebruiker en in de UI; code en commentaar in het Engels.
- **Geen sessielinks** in de repo, commits of PR's. Commitbericht in het Nederlands; afsluiten met alleen:
  `Co-Authored-By: Claude <noreply@anthropic.com>` (gebruik de modelnaam die je harness opgeeft, zonder sessieregel).
- **Testen:** elke functie krijgt checks in `e2e/run.mjs`. Draai de test lokaal vóór het pushen.
- **Versies (SemVer):** wijzigingen gaan onder `## [Unreleased]` in `CHANGELOG.md`. Uitbrengen: `npm run release:minor|patch|major` en daarna `git push origin main`. GitHub Actions maakt de tag, het image (`:X.Y.Z`, `:X.Y`, `latest`) en de GitHub Release.
- **De gebruiker updatet** met `docker compose pull stream-dashboard && docker compose up -d stream-dashboard`. Geef dat commando na elke release.
- **Usage sparen:** wacht niet minutenlang op CI. Check één keer en meld de status.

## Bekende beperkingen van de omgeving (cloud-sessie)

- **Twitch, Discord, StreamElements en GIPHY zijn hier niet bereikbaar.** Test via `e2e/fake-twitch.mjs` en zeg eerlijk wat niet echt getest is.
- **Versie-tags pushen kan hier niet** (`git push origin vX` en de tags-API worden geblokkeerd). Daarom maakt de workflow de tag zelf.
- **Pushen** geeft soms `fatal error in commit_refs_rules`. Dat is een tijdelijke fout bij GitHub: probeer het opnieuw met een pauze (2/4/8 s).
- **Docker-build in de sandbox** heeft geen eigen internet. Bouw met `--network=host`, `--build-arg HTTPS_PROXY=$HTTPS_PROXY` en een tijdelijke kopie van de Dockerfile die de CA uit `/root/.ccr/ca-bundle.crt` in elke stage zet. Een eventueel gestart `dockerd` moet je zelf starten.
- **Playwright:** gebruik de vooraf geïnstalleerde versie (`require('playwright')`); installeer geen andere.
- **`rm -rf` met meerdere paden** wordt soms door een veiligheidscheck tegengehouden. Splits het of laat het weg (`.dockerignore` sluit `node_modules`/`dist` al uit).

### End-to-end test lokaal draaien

```bash
(cd web && npm run build) && node e2e/run.mjs
```
Duurt ±3 min en eindigt met `All checks passed`. Als iets hangt: `pkill -f "src/index.ts"`.

## Huidige stand

- **v1.0.0** (2026-11-06): alles uit de lijst hierboven, plus versiebeheer en de Discord-basis voor meerdere servers (toevoegen, wisselen, bot eruit halen, extra rechten en intents).
- De e2e-test heeft **119 checks**, allemaal groen.

## Openstaande punten

1. **Profielfoto van nieuwe Discord-leden** is volgens de gebruiker nog niet zichtbaar op het welkomstplaatje.
   - Er zijn al fixes voor omleidingen, server-foto's en de user-agent.
   - Sinds 1.0.0 staat de reden van een mislukte foto zichtbaar op de Discord-pagina (`bot.avatarError`).
   - **Vraag de gebruiker om die melding** en los het gericht op.
2. **Eigen bot-profiel per server** (avatar/bio via `PATCH /guilds/{id}/members/@me`) is niet met de echte Discord getest.
3. De gebruiker moet na de update in het Discord Developer Portal **Message Content Intent** aanzetten en de server één keer opnieuw toevoegen (voor de nieuwe rechten).

## Volgende stap

**Stap 2 van het Discord-plan: Moderatie → v1.1.0.** Vraag de gebruiker eerst of hij daarmee verder wil.

## Stappenplan Discord (afgesproken met de gebruiker)

- [x] 1. Basis: meerdere servers simpel beheren, rechten en intents (v1.0.0)
- [ ] 2. Moderatie: AutoMod (woorden, links, caps, spam, mentions, invites), waarschuwingen, slash-commands (`/warn`, `/warnings`, `/timeout`, …) → v1.1.0
- [ ] 3. Rollen: autoroles, reaction roles, button roles
- [ ] 4. Levels & XP met een openbaar leaderboard
- [ ] 5. Social-meldingen: Twitch en YouTube (RSS, gratis); **X alleen met een eigen betaalde API-sleutel** van de streamer (besloten)
- [ ] 6. Ticket- en supportsysteem
- [ ] 7. Server-statistieken en ModLogs
- [ ] 8. Rechten- en teambeheer: **teamleden toevoegen op Twitch-naam met een rol** (Moderator / Editor / Beheerder), inloggen met Twitch en wisselen tussen accounts (besloten)

Uitgangspunt van de gebruiker: **zo simpel mogelijk** voor mensen met weinig technische kennis (duidelijke stappen, uitleg in gewone taal).

### Technische aantekeningen voor de volgende stappen
- `DiscordBot.events` (EventEmitter) geeft elke gateway-dispatch door, zodat feature-modules zich kunnen abonneren.
- Intents: FULL = GUILDS | GUILD_MEMBERS | GUILD_MODERATION | GUILD_MESSAGES | GUILD_MESSAGE_REACTIONS | MESSAGE_CONTENT, met automatische terugval zonder MESSAGE_CONTENT bij close-code 4014 (`status.messageContent`).
- De uitnodiging vraagt al `bot applications.commands` en de rechten voor kicken, bannen, timeouts, berichten beheren, rollen, kanalen, het auditlog en reacties (`BOT_PERMISSIONS` in `server/src/discord/routes.ts`).
