# Google verbinden — einmalige Einrichtung (optional)

Diese Anleitung ist optional. Das Dashboard läuft ohne sie vollständig; nur die
Google-Fähigkeiten bleiben inaktiv, bis der Zugang steht. Der Zugang ist bewusst NICHT auf
einzelne Dienste verengt: du legst dein eigenes Google-Projekt mit dem **ganzen
Google-Kosmos** an (alle unten gelisteten APIs) und erteilst EINEN Login. So ist voller
Zugriff da, nichts ist abgeschnitten. Meldet das Dashboard `google_not_configured`, ist
genau diese Anleitung der Weg.

**Wer macht was.** Der Agent fährt Konsole und Browser selbst. Die **einzige** Handlung auf
deiner Seite ist der Google-**Login** (Passwort/2-Faktor) und, ganz am Ende, ein Klick auf
„Zulassen" beim Zustimmungsbildschirm. Der Agent tippt nie dein Passwort und nie den
Client-Schlüssel. Du musst nirgends „Enter" in einer Konsole drücken.

## Warum dieser Weg

- **Ein Login, voller Zugriff — der ganze Google-Kosmos, nichts abgeschnitten.** Statt
  mehrerer Connectoren mit je beschnittenen Rechten legst du EIN eigenes Projekt an, in dem
  das **komplette Google-API-Set** aktiv ist, und registrierst EINEN eigenen OAuth-Client.
  Das Dashboard spricht damit die rohen Google-REST-Schnittstellen direkt an.
- **Deine Identität, nicht die eines anderen.** Jede Installation bringt ihr eigenes
  Projekt und ihren eigenen Client mit. Es wird nie ein fremder Zugang mitgeliefert oder
  vorausgesetzt; deine Zugangsdatei verlässt deinen Rechner nicht und wird nie committet.

## Warum NICHT GAM (ehrlich)

GAM (Google Apps Manager) kann grundsätzlich ein Cloud-Projekt anlegen. Für ein **privates
`gmail.com`/`googlemail.com`-Konto** ist der GAM-Weg aber eine **Sackgasse**: `gam create
project` verlangt, dass sein „GAM Project Creation"-Client zuerst über die
**Workspace-Admin-Konsole `admin.google.com`** als *trusted* freigegeben wird — und diese
Konsole hat nur ein Workspace-/Cloud-Identity-**Administratorkonto**, kein Consumer-Konto.
Das wurde an einem echten Privatkonto nachgeprüft.
Deshalb führt diese Anleitung den **Cloud-Console-Weg von Hand** — er ist für ein
Privatkonto durchführbar und stellt denselben Endzustand her (Projekt + alle APIs +
OAuth-Desktop-Client). Wer ein echtes Workspace-Firmenkonto mit Admin-Rechten hat, kann GAM
nutzen; für alle anderen ist der Weg unten der richtige.

## Schritt 1 — Beim Zielkonto anmelden

Der Agent öffnet `accounts.google.com`; **du** meldest dich mit dem Konto an, das später die
Daten liefern soll (inkl. 2-Faktor). Danach übernimmt der Agent.

## Schritt 2 — Neues Projekt anlegen

**Vorher prüfen:** Hat das Konto schon ein Projekt für diesen Zugang, wird es
weiterverwendet und kein zweites angelegt. Andere Projekte im Konto werden nicht angefasst.

Der Agent öffnet `console.cloud.google.com`, geht über die Projektauswahl auf **Neues
Projekt** und setzt den **Projektnamen = Inhaber + Zweck + Umfang**, z. B.
„WEE Google Admin-Vollzugriff" (höchstens 30 Zeichen: Buchstaben, Ziffern, Leerzeichen,
Bindestrich). Die **Projekt-ID** ist derselbe Name klein geschrieben mit Bindestrichen
(z. B. `wee-admin-vollzugriff`); sie ist später nicht mehr änderbar. Mit dem Wort „google"
lehnte die Konsole die ID ab („Die Projekt-ID ist nicht verfügbar", 29.09.2026).

**Warum:** Das Projekt ist der Google-Zugang der ganzen Organisation, nicht eines
einzelnen Harness-Ordners. Weitere Nutzer und Installationen hängen sich an dasselbe
Projekt; am Namen muss im Google-Konto sofort erkennbar sein, wem der Zugang gehört und
dass er vollen Zugriff gibt [Owner 29.09.2026].

## Schritt 3 — Den ganzen Kosmos aktivieren (nur fehlende, je Aufruf höchstens 20)

Google aktiviert **höchstens 20 Schnittstellen je Aufruf** („A single request can enable a
maximum of 20 services at a time", Service-Usage-Doku zu `services.batchEnable`) und der
Aufruf **scheitert ganz**, wenn eine Schnittstelle der Liste schon aktiv ist
[Owner 29.09.2026; Beleg Projekt `wee-admin-vollzugriff`: alle 40 in einem Aufruf
scheiterten mit „Aktivierung fehlgeschlagen", 20 + 19 gingen durch]. Deshalb in dieser
Reihenfolge:

1. Unter **APIs und Dienste → Aktivierte APIs und Dienste** lesen, was schon an ist. Google
   schaltet in jedem neuen Projekt selbst eine Reihe ein, darunter
   „Google Cloud Storage JSON API" (`storage-api.googleapis.com`) aus der Liste unten.
2. Aus der Liste unten **nur die fehlenden** nehmen.
3. Sie in **Teilen von höchstens 20** über den Sammel-Link aktivieren:

```
https://console.cloud.google.com/flows/enableapi?apiid=<APIID-LISTE>&project=<PROJEKT-ID>
```

mit dieser vollständigen `apiid`-Liste (komma-getrennt, das ist der ganze Kosmos):

```
accesscontextmanager.googleapis.com,admin.googleapis.com,alertcenter.googleapis.com,
analyticsadmin.googleapis.com,calendar-json.googleapis.com,chat.googleapis.com,
chromemanagement.googleapis.com,chromepolicy.googleapis.com,classroom.googleapis.com,
cloudchannel.googleapis.com,cloudidentity.googleapis.com,cloudresourcemanager.googleapis.com,
contacts.googleapis.com,datastudio.googleapis.com,docs.googleapis.com,drive.googleapis.com,
driveactivity.googleapis.com,drivelabels.googleapis.com,forms.googleapis.com,
gmail.googleapis.com,groupsmigration.googleapis.com,groupssettings.googleapis.com,
iam.googleapis.com,iamcredentials.googleapis.com,keep.googleapis.com,licensing.googleapis.com,
meet.googleapis.com,mybusinessaccountmanagement.googleapis.com,people.googleapis.com,
pubsub.googleapis.com,reseller.googleapis.com,searchconsole.googleapis.com,
sheets.googleapis.com,siteverification.googleapis.com,slides.googleapis.com,
storage-api.googleapis.com,
tagmanager.googleapis.com,tasks.googleapis.com,vault.googleapis.com,youtube.googleapis.com
```

Im Flow je Teil: **„Projekt bestätigen" → Weiter → Aktivieren**. Fertig, wenn jeder Teil
„Sie haben Folgendes aktiviert" zeigt.

Das sind **40 bewusst aktivierte APIs**. Unter „Aktivierte APIs und Dienste" zählt die
Konsole danach **mehr** (typisch um die 60) — die Differenz sind GCP-Standard-APIs, die
Google in jedem neuen Projekt selbst anschaltet (BigQuery, Logging, Monitoring,
Storage und weitere). Das ist normal und kein Fehler.

Ein Teil des Sets (z. B. `admin`, `vault`, `reseller`, `licensing`, `cloudchannel`,
`chromemanagement`, `cloudidentity`, `meet`, `chat`, `classroom`) ist nur mit einem echten
Workspace-**Firmenkonto** nutzbar; das **Aktivieren** gelingt trotzdem und schadet nicht, so
ist der Kosmos vollständig, falls das Konto später eine Domain bekommt. Für ein
`gmail.com`-Konto sofort nutzbar sind Gmail, Drive, Docs, Sheets, Calendar, Tasks, People
(Kontakte), Forms und YouTube.

## Schritt 4 — OAuth-Consent konfigurieren

Der Agent öffnet die **Google Auth Platform** (`console.cloud.google.com/auth`) → **Erste
Schritte** und füllt aus:

- App-Name = voller Name der Organisation + „Google Admin-Vollzugriff" (z. B. „World Eden
  Era – Google Admin-Vollzugriff"; den sieht jeder Nutzer beim Anmelden), Support-Mail und
  Kontakt = deine Konto-Mail.
- **Nutzertyp: Extern** (ein `gmail.com`-Konto hat nur diese Wahl; ein Workspace-Konto
  könnte „Intern" nehmen).
- Den Haken „Ich akzeptiere die Richtlinie zu Nutzerdaten für Google API-Dienste" setzt der
  **Agent selbst** und klickt durch; das Ja dazu gibt der Mensch einmal beim Start der
  Einrichtung im Chat, nicht mitten im Lauf [Owner 29.09.2026]. Danach „Erstellen" →
  Meldung „OAuth-Konfiguration erstellt".

## Schritt 5 — Dich selbst als Testnutzer eintragen

Unter **Zielgruppe → Nutzer hinzufügen** trägst du **dein eigenes Konto** als Testnutzer ein
und speicherst.

> **Gotcha `googlemail.com`:** Hat deine Adresse die Form `…@googlemail.com`, trage die
> **`…@gmail.com`-Form** ein. Google normalisiert intern auf `gmail.com`; die
> `googlemail.com`-Schreibweise löst sonst einen harmlosen „nicht berechtigt"-Hinweis aus,
> obwohl der `gmail.com`-Eintrag gültig gespeichert wird.

Der volle Gmail-/Drive-Zugriff gilt als *restricted*; „In Produktion veröffentlichen"
verlangt Googles Audit und ist für ein Privatkonto unrealistisch. Der **Testing-Status
genügt** — mit dem 7-Tage-Ablauf unten (max. 100 Testnutzer).

## Schritt 6 — OAuth-Client erstellen (Typ Desktop)

> **Vorher ansagen (der Agent sagt dir das aktiv):** „Gleich lädt Google eine Datei herunter
> (`client_secrets.json`) — bitte **Zulassen**, nicht ablehnen. Das ist deine Zugangsdatei;
> sie landet in deinem Downloads-Ordner." Ohne diese Ansage wundert man sich über den
> Download-Dialog und lehnt ihn evtl. ab — dann fehlt die Datei.

Unter **Clients → Client erstellen**: **Anwendungstyp „Desktopanwendung"**, Name frei
(z. B. „Desktop-Client 1") → **Erstellen**. Ein Desktop-Client erlaubt Loopback-Redirects;
Redirect-URIs musst du nicht eintragen (das Dashboard verbindet über einen lokalen
Loopback-Rücklauf).

Im Dialog „OAuth-Client erstellt" auf **„JSON herunterladen"** klicken. Die Warnung „Sie
können den Clientschlüssel nicht mehr ansehen, nachdem Sie das Dialogfeld geschlossen haben"
ist normal — die heruntergeladene Datei enthält alles. Behandle die JSON wie ein Passwort.

**Sofort danach verschiebt der Agent die Datei aus dem Download-Ordner an den Ablageort aus
Schritt 7 (Weg B)**; im Download-Ordner bleibt nichts liegen. Der Mensch klickt nur
„Herunterladen", er wählt keinen Ordner und verschiebt nichts [Owner 29.09.2026].

## Schritt 7 — Zugangsdatei ablegen

Ein Zugangswert steht NIE in einer Repo-Datei. Zwei gleichwertige Wege:

**Weg A — Umgebungsvariable (am einfachsten).** `GOOGLE_CLIENT_SECRETS` auf den absoluten
Pfad der JSON setzen, bevor du das Dashboard startest:

```powershell
$env:GOOGLE_CLIENT_SECRETS = "C:\Users\<du>\Downloads\client_secret_....json"   # Windows
```
```bash
export GOOGLE_CLIENT_SECRETS="$HOME/Downloads/client_secret_....json"           # macOS/Linux
```

**Weg B — fester Ablagepfad im Datenverzeichnis der Installation.** JSON in
`google-client-secrets.json` umbenennen und ablegen unter:

- **Windows:** `%LOCALAPPDATA%\KeelHarness\accountability\<Instanz>\google-client-secrets.json`
- **macOS/Linux:** `$XDG_DATA_HOME/keel-harness/accountability/<Instanz>/...`
  (ohne `XDG_DATA_HOME`: `~/.local/share/keel-harness/accountability/<Instanz>/...`)

`<Instanz>` ist ein aus dem Installationspfad abgeleiteter Schlüssel (16 Hex-Zeichen);
Ableitung in `accountabilityDataDirectoryForHarnessRoot` in
`dashboard/lib/accountability/harness.ts`.

## Schritt 8 — Im Dashboard verbinden

1. Dashboard starten: `npm run dashboard` und die angezeigte Adresse im Browser oeffnen.
2. Accountability -> **Einstellungen** -> **„Google verbinden"**.
3. Konto auswaehlen. Beim Hinweis „Google hat diese App nicht ueberprueft" auf **„Weiter"**.
4. Auf dem Zustimmungsbildschirm zuerst **„Alle auswaehlen"** klicken, dann **„Weiter"**.
5. Das Dashboard zeigt die Google-Quellen als **LIVE**. Der Token liegt lokal
   (`google-token.json` im Datenverzeichnis der Installation), nie im Repository.

> **Falle — die Rechte sind standardmaessig ALLE LEER.** Google listet jede Berechtigung als
> einzelne, **nicht vorausgewaehlte** Checkbox. Ohne **„Alle auswaehlen"** erteilst du einen
> Zugang **ohne Rechte**, und das Dashboard bleibt trotz „verbunden" ohne Daten. Das gilt
> bei **jedem** erneuten Verbinden aufs Neue. Das ist Googles Verhalten, nicht das des Harness.

**So sieht ein geglueckter Lauf aus:** Google Tasks, Google Kalender und E-Mail stehen auf
**LIVE**, und im Arbeitsraum tauchen echte Aufgaben, Termine und Betreffzeilen des
verbundenen Kontos auf.

Das Dashboard fordert beim Verbinden genau diesen Scope-Satz an (aus `GOOGLE_SCOPES` in
`dashboard/lib/accountability/google-auth.ts`):

```
https://mail.google.com/                                   (ganzes Gmail: lesen, senden, organisieren)
https://www.googleapis.com/auth/gmail.settings.basic       (serverseitige Filter)
https://www.googleapis.com/auth/calendar                   (voller Kalender)
https://www.googleapis.com/auth/tasks
https://www.googleapis.com/auth/drive
https://www.googleapis.com/auth/documents
https://www.googleapis.com/auth/spreadsheets
https://www.googleapis.com/auth/presentations
https://www.googleapis.com/auth/contacts
https://www.googleapis.com/auth/userinfo.profile
https://www.googleapis.com/auth/userinfo.email
```

## 7-Tage-Ablauf im Testing-Status und Erneuern

Solange der Consent-Screen im **Testing**-Status steht, läuft der Token nach **7 Tagen** ab
— eine Google-Vorgabe für restricted Scopes ohne bestandenen Audit, auf `gmail.com` nicht
umgehbar. Erneuern: im Dashboard **„Google neu verbinden"** und den Consent einmal
durchlaufen. Projekt und Client bleiben; nur der Token wird neu ausgestellt.

## Abbau — trennen, widerrufen, aufräumen

Der Zugriff ist eine stehende Vollmacht auf dein Google-Konto und lebt nicht im
Repository. Drei Ebenen, von sanft bis vollständig:

1. **Trennen im Dashboard** (Knopf „Trennen" neben dem Verbindungsstatus): widerruft
   den Token bei Google und löscht die Token-Datei. Das Cloud-Projekt und die
   Zugangsdatei bleiben — ein späteres „Verbinden" braucht nur den Consent erneut.
2. **Deinstallation** (`node install.mjs uninstall --target <repo>`): stellt nur den
   Repo-Baum wieder her und NENNT das Datenverzeichnis außerhalb des Repos
   (Windows: `%LOCALAPPDATA%\KeelHarness\accountability\<Instanz>`; darin
   `google-token.json` und `google-client-secrets.json`). Mit
   `--purge-accountability-data` widerruft der Installer den Token und entfernt das
   ganze Verzeichnis samt lokalem Assistenten-Speicher.
3. **Im Google-Konto selbst**: <https://myaccount.google.com/permissions> zeigt die App
   und erlaubt „Zugriff entfernen" — das wirkt auch dann, wenn der lokale Rechner
   weg ist. Das Cloud-Projekt löschst du in der Cloud Console unter „IAM & Verwaltung
   → Einstellungen → Beenden".

Was im Google-Konto ANGELEGT wurde, bleibt von allen drei Ebenen unberührt: die
Postfach-Organisation (Labels, serverseitige Filter, archivierte Mails) hat im
Dashboard einen eigenen Rückbau-Knopf (Mail-Linse, Abschnitt „Rückbau"), der die
Filter löscht, archivierte Mails in den Posteingang zurücklegt und die vom Dashboard
angelegten Labels entfernt.

## Grenzen (ehrlich)

- Ohne bestandenen Google-Audit bleibt der Testing-Status mit dem 7-Tage-Token.
- **Keep** und die **volle Fotobibliothek** sind über User-OAuth auf `gmail.com` nicht
  erreichbar (Keep = Workspace-only; die Photos-Scopes wurden 03/2025 entfernt) — auch wenn
  die `keep`-API im Projekt aktiv ist.
- Die Workspace-**Admin-/Enterprise-APIs** (admin, vault, reseller, licensing, cloudchannel,
  chromemanagement/-policy, cloudidentity, groups*, meet, chat, classroom) sind ohne
  Firmen-Domain nicht nutzbar; sie sind Teil des vollen Sets und aktiviert, tragen für ein
  `gmail.com`-Konto aber keinen Zugriff.
- **YouTube** ist kein Workspace-Dienst: der Workspace-Login oben fordert die YouTube-Scopes
  nicht mit an. YouTube läuft über einen EIGENEN Token desselben OAuth-Clients, ausgestellt
  von einem schlanken eigenen CLI nach dem Muster von `tools/google/`. YouTube-Uploads
  bleiben zwangsweise privat, bis der YouTube-API-Compliance-Audit bestanden ist.
