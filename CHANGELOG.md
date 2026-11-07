# Changelog

Alle noemenswaardige wijzigingen per versie. Versienummers volgen [SemVer](https://semver.org/lang/nl/):

- **MAJOR** (2.0.0): grote wijziging waarbij je zelf iets moet aanpassen;
- **MINOR** (1.**1**.0): nieuwe functies;
- **PATCH** (1.0.**1**): bugfixes.

Nieuwe wijzigingen komen eerst onder **[Unreleased]**. Bij een release krijgen ze een versienummer (zie README → *Versies & releases*).

## [Unreleased]

## [1.0.1] - 2026-11-07

### Gewijzigd
- Nieuwe naam: **Lumio heet nu Waviloop**, met de slogan *Make your stream come alive.* Je gegevens en je login blijven gewoon werken (interne namen zoals het databasebestand, de cookies en het Docker-volume `lumio-data` zijn bewust niet veranderd).

## [1.0.0] - 2026-11-06

### Toegevoegd
- Versienummers: changelog, versie zichtbaar in het dashboard (boven je naam) en in `/healthz`, een Docker-image per versie en automatische GitHub Releases.

### Discord
- Meerdere servers eenvoudig beheren: **Server toevoegen**, wisselen tussen servers, **Bot uit deze server halen**.
- Melding als de bot in Discord zelf uit een server is gezet; opnieuw toevoegen herstelt alles.
- De bot vraagt de rechten en intents voor de komende functies (moderatie, rollen, tickets, logs) en valt netjes terug als de Message Content Intent uit staat.
- **Test sturen** gebruikt je eigen profielfoto; de reden van een niet-geladen profielfoto staat in het dashboard.

### StreamElements-import
- Alerts krijgen de naam van hun StreamElements-overlay en variatie (bijv. "Hoofdscherm — Subscriber gift").

## [0.8.1] - 2026-11-06

### Opgelost
- Discord: profielfoto van een nieuw lid op het welkomstplaatje (CDN-omleidingen, volgorde server-foto → accountfoto → standaard).

## [0.8.0] - 2026-11-06

### Toegevoegd
- Discord: welkomstbericht over meerdere regels (tot 1500 tekens).

## [0.7.1] - 2026-11-06

### Opgelost
- Video zonder lengte-informatie eindigt nu als hij echt klaar is.

## [0.7.0] - 2026-11-06

### Toegevoegd
- Video (MP4/WebM, ook transparant) in commands en alerts, met "duur = lengte van de video".
- Discord: eigen botnaam, profielfoto en "over mij" per server.

## [0.6.0] - 2026-11-06

### Toegevoegd
- Discord-bot met welkomstplaatjes (avatar, naam, ledental), live preview en test sturen.

## [0.5.0] - 2026-11-06

### Toegevoegd
- Chat-antwoorden met aliassen en variabelen, timers, alerts via Twitch EventSub (follow, sub, resub, gift, bits, raid) met varianten.
- StreamElements-import van commands, timers en alerts.

## [0.4.0] - 2026-11-05

### Toegevoegd
- Personagestijl "Mensen" naast anime; personages kunnen naar elkaar toe lopen.
- Duidelijke balk bij niet-opgeslagen wijzigingen, Ctrl+S.

## [0.3.0] - 2026-11-04

### Toegevoegd
- Ontvanger-naam (`!knuffel @naam`), terugknop in de editor, lijst naast de overlay-indeling, GIPHY, nieuw dashboard-ontwerp, tekst uit te zetten, hero grid en lijstweergave.

## [0.2.0] - 2026-11-04

### Toegevoegd
- Docker-image via GitHub Actions, setup-wizard voor de Twitch-gegevens (geen secrets meer in de compose).

## [0.1.0] - 2026-11-04

### Toegevoegd
- Eerste versie: Twitch-login, chatcommands, OBS-overlay met anime-animaties, wachtrij en dashboard.
