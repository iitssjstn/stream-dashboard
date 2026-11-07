---
name: hervat
description: Hervat het werk aan Waviloop (stream-dashboard) in een nieuwe chat - leest docs/HANDOFF.md, de changelog, git en de laatste GitHub Actions-builds en vat samen waar we zijn. Met "/hervat opslaan" wordt de huidige stand in docs/HANDOFF.md vastgelegd en gepusht, zodat een volgende chat verder kan.
---

# Hervat: verder werken aan Waviloop

Waviloop is een eigen alternatief voor StreamElements: Twitch-chatcommands met animaties in een OBS-overlay, alerts, timers, een StreamElements-import en een Discord-bot. Alle kennis die een nieuwe chat nodig heeft staat in **`docs/HANDOFF.md`**. Deze skill heeft twee standen.

Praat altijd **Nederlands** met de gebruiker.

## Stand 1: `/hervat` (zonder argument): oppakken waar we waren

Doe dit in volgorde, zonder eerst te vragen:

1. **Lees** `docs/HANDOFF.md` helemaal en de bovenkant van `CHANGELOG.md` (`[Unreleased]` en de laatste versie).
2. **Git**:
   ```bash
   git fetch -q origin main && git status -sb && git log --oneline -10
   ```
   Staat de lokale `main` achter, doe dan `git pull origin main`. Pull nooit over lokale wijzigingen heen zonder ze eerst te noemen.
3. **Builds**:
   ```bash
   gh run list -R iitssjstn/stream-dashboard -L 5
   ```
   Is de laatste build mislukt, bekijk dan `gh run view <id> -R iitssjstn/stream-dashboard --log-failed | tail -40` en noem de oorzaak.
4. **Klaarzetten om te testen** (alleen als `node_modules` ontbreekt):
   ```bash
   (cd server && npm ci --no-audit --no-fund) && (cd web && npm ci --no-audit --no-fund)
   ```
5. **Vat kort samen** voor de gebruiker (max. ~15 regels):
   - huidige versie (`package.json`) en wat er in `[Unreleased]` staat;
   - laatste 3-5 wijzigingen;
   - status van de laatste build;
   - **openstaande punten** en **de volgende stap** uit HANDOFF.md;
   - vraag waar de gebruiker mee verder wil (stel de volgende stap uit het plan voor).

## Stand 2: `/hervat opslaan`: stand vastleggen voor de volgende chat

1. Werk in `docs/HANDOFF.md` deze secties bij (de rest alleen als er echt iets veranderd is):
   - **Laatst bijgewerkt**: datum en versie;
   - **Huidige stand**: wat er sinds de vorige keer gebouwd/opgelost is (kort, met versie);
   - **Openstaande punten**: dingen die wachten op de gebruiker of nog niet werken;
   - **Volgende stap**: wat de volgende chat als eerste moet doen;
   - **Stappenplan**: vink af wat klaar is.
2. Zet nieuwe wijzigingen die nog geen versie hebben onder `## [Unreleased]` in `CHANGELOG.md`.
3. Commit en push (zie de commitregels in HANDOFF.md, **zonder sessielink**):
   ```bash
   git add docs/HANDOFF.md CHANGELOG.md && git commit -m "Handoff bijgewerkt" && git push origin main
   ```
4. Bevestig aan de gebruiker wat er is vastgelegd.

## Werkregels (altijd)

- Lees `docs/HANDOFF.md` → *Werkafspraken* en *Bekende beperkingen van de omgeving* voordat je iets bouwt, test of pusht.
- **Nooit** een sessielink (claude.ai/...) in de repo, commits of PR's zetten.
- Nieuwe functies: test met de end-to-end test, zet ze in de changelog en breng ze uit als nieuwe versie.
- Nooit geheimen (tokens, wachtwoorden, e-mailadressen) in de repo zetten.
