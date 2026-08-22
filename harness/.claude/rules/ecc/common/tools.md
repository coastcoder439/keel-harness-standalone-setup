# Werkzeuge — CLI vor MCP vor Browser

> Quelle und Begründung (mit Messwerten): `docs/tool-sourcing.md` im Werkbank-Repo.
> Diese Datei ist die operative Kurzfassung, die in jeder Session geladen wird.
> Anlass: Browsersteuerung für Daten benutzt, für die eine CLI existiert.

## Die Rangfolge (gilt bei jeder fehlenden Fähigkeit)

**1. CLI → 2. MCP → 3. Browsersteuerung.** Eine Stufe tiefer erst, wenn die darüber
nachweislich nicht geht. **„Ich kenne kein CLI" ist kein Nachweis** — erst suchen.

- **CLI** kostet **null**, bis sie aufgerufen wird; die Ausgabe lässt sich vor dem Modell
  filtern (`| jq`, `| grep`, `| head`); läuft in Subagenten und Hooks; ist wiederholbar.
- **MCP** kostet **dauerhaft** — die Werkzeug-Schemata liegen in *jeder* Session im Fenster,
  auch in Sessions, die den Dienst nie anfassen. Nur wenn keine CLI existiert oder die
  Anmeldung nur so geht.
- **Browser** kostet **pro Blick** (jeder Screenshot ist ein voller Anhang). Nur für
  Oberflächen, nie für Daten. *Wer damit Text holt, bezahlt Bilder für Buchstaben.*

## Beschaffen statt umgehen

1. `command -v <werkzeug>` — ist es schon da?
2. Suchen: `gh search repos` · `pip index versions <x>` · `npm search` · `brew search`
3. Installieren ohne Systemrechte: `pip install --user` · `npm i -g` · `brew install` ·
   offizielles Release-Binary
4. Fehlt beides, dann erst MCP; fehlt auch das, dann erst Browser.

## Wenn die CLI streikt: nicht absteigen, nachsehen

**Version veraltet? → Argumente/Modus? → bekannter Umgehungs-Schalter? → erst dann abwärts.**
(Praxisbeispiel: ein Player-Client-Schalter loeste, was wie ein kaputtes Werkzeug aussah.)

## Bestandsregel

Jeder dauerhaft verbundene MCP-Server braucht eine Begründung, die seine Kosten in **allen**
Sessions rechtfertigt. Kein MCP, für den eine CLI existiert — außer die CLI kann etwas nicht
(Anmeldung, Push-Ereignisse).
