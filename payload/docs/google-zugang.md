# Google-Vollzugriff einrichten (Workspace-MCP + YouTube-CLI)

So bekommt der Agent programmatischen Vollzugriff auf den eigenen Google-Kosmos eines
**persoenlichen `@gmail.com`-Kontos** — als der Nutzer selbst, ohne Firmen-Domain.
Belege und die Entscheidungsgeschichte: `docs/packages/google-full-access.md`.

## Warum dieser Weg (und kein anderer)

- **GAM** taugt bei `gmail.com` nicht — es greift auf Nutzerdaten nur ueber
  Domain-Wide Delegation zu, die ein Consumer-Konto nicht hat.
- **Ein Workspace-/Cloud-Identity-Abo** schaltet fuer den Eigenzugriff nichts frei
  (Delegation gaebe es nur fuer Konten INNERHALB einer neuen Domain, nie fuer das
  bestehende gmail.com).
- **Der Weg** ist ein OAuth-User-Token: Gmail, Drive, Docs, Sheets, Slides, Kalender,
  Tasks, Kontakte laufen ueber den fertigen MCP-Server `google-workspace`
  (taylorwilsdon/google_workspace_mcp); **YouTube** (kein Workspace-Dienst) ueber das
  schlanke CLI `tools/google/`. Beide teilen denselben OAuth-Client.

## Schritt 1 — OAuth-Client (einmalig, Mensch)

1. Google Cloud Console: ein Projekt anlegen (oder vorhandenes nutzen) und die noetigen
   APIs aktivieren (Gmail, Drive, Docs, Sheets, Slides, Calendar, Tasks, People, YouTube).
2. **OAuth consent screen**: User type **External**, App-Name + Support-/Kontakt-Mail
   ausfuellen; das eigene Konto unter **Testnutzer** eintragen (Publish geht bei den
   Gmail/Drive-Vollzugriff-Scopes ohne Googles CASA-Audit nicht — Testing-Status genuegt).
3. **Clients → Create client → Desktop app**; die JSON herunterladen, in exakt
   `client_secrets.json` umbenennen und nach `~/.gam/` legen (ausserhalb des Repos —
   nie committen).

## Schritt 2 — Workspace-MCP (Agent registriert, Mensch bestaetigt Consent)

```bash
claude mcp add google-workspace -s local \
  -e GOOGLE_OAUTH_CLIENT_ID="<aus client_secrets.json>" \
  -e GOOGLE_OAUTH_CLIENT_SECRET="<aus client_secrets.json>" \
  -e USER_GOOGLE_EMAIL="<dein@gmail.com>" \
  -e OAUTHLIB_INSECURE_TRANSPORT=1 \
  -- uvx workspace-mcp --single-user --tool-tier core
```

Claude Code neu starten. Beim ersten Google-Tool-Aufruf erscheint eine Consent-URL —
im Browser mit dem eigenen Konto anmelden, beim „nicht verifiziert"-Screen
*Erweitert → Weiter*, alle Haken lassen. Danach cacht der Server den Token unter
`~/.google_workspace_mcp/credentials/`.

## Schritt 3 — YouTube-CLI (Agent, Mensch bestaetigt Consent)

```bash
pip install -r tools/google/requirements.txt
python -m tools.google.cli login     # Consent-URL -> im Browser bestaetigen
python -m tools.google.cli whoami     # zeigt den eigenen Kanal
```

Eigener Token unter `~/.gam/keel-youtube-token.json` (der MCP fordert die YouTube-Scopes
nicht an). Details: `tools/google/README.md`.

## Schritt 4 — 7-Tage-Ablauf (automatisch ueberwacht)

Der OAuth-Token laeuft im Testing-Status nach 7 Tagen ab (unvermeidbar ohne CASA-Audit).
Der Dashboard-Scheduler (`dashboard/scheduler.js`, Job `google-token-check`) prueft das
beim Serverlauf und meldet es im Automatik-Reiter. Erneuern: in Claude Code
„Google neu einloggen" sagen — der Agent loest den Consent neu aus.

## Grenzen (ehrlich)

- **Keep** und die **volle Fotobibliothek** sind ueber User-OAuth auf gmail.com nicht
  erreichbar (Keep = Workspace-only; Photos-Scopes 03/2025 entfernt).
- **YouTube-Uploads** sind zwangsweise privat, bis fuer das Projekt der
  YouTube-API-Compliance-Audit bestanden ist.
