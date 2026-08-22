# Werkzeug-Beschaffung: CLI vor MCP vor Browser

> Wie ein Agent an eine Fähigkeit kommt, die er noch nicht hat. Operative Kurzfassung, die in
> jeder Session lädt: [`.claude/rules/keel/tools.md`](../.claude/rules/keel/tools.md).
>
> Anlass [E, Auftraggeber 31.07.2026]: „grundsätzlich fehlt die Regel, nach bevorzugt CLIs zu suchen und
> zu installieren (dann MCP), anstatt Tokens über Browsersteuerung zu verwenden."

## Die Rangfolge

**1. CLI** → **2. MCP** → **3. Browsersteuerung**

Eine Stufe wird erst betreten, wenn die darüber nachweislich nicht geht. **„Ich kenne kein CLI"
ist kein Nachweis** — gesucht wird, bevor abgestiegen wird.

| Stufe | Kosten im Kontext | Wann sie richtig ist |
|---|---|---|
| **CLI** | **null**, bis sie aufgerufen wird. Die Ausgabe lässt sich vor dem Modell filtern (`grep`, `jq`, `head`) | immer, wenn es eine gibt |
| **MCP** | **dauerhaft**: die Werkzeug-Schemata liegen in **jeder** Session im Fenster, auch in Sessions, die den Dienst nie anfassen | wenn es keine CLI gibt, oder Anmeldung/API nur so funktioniert |
| **Browser** | **pro Blick**: jeder Screenshot, jeder Seitenbaum ist ein voller Anhang | wenn eine Menschen-Oberfläche der einzige Weg ist (Login-only, visuelle Abnahme) |

## Warum die Reihenfolge so herum steht

- **Eine CLI kostet nichts, solange sie schweigt.** Ein MCP-Server kostet, sobald er verbunden
  ist — in jeder Session, für jede Rolle, ob gebraucht oder nicht.
- **Die Ausgabe einer CLI lässt sich vor dem Modell zusammenstreichen.** Ein Browser-Screenshot
  nicht: er kommt ganz oder gar nicht.
- **Eine CLI läuft in Subagenten und in Hooks.** Browsersteuerung nicht — sie braucht die
  Sitzung, in der der Mensch sitzt.
- **Eine CLI ist wiederholbar.** Derselbe Befehl gibt dieselbe Ausgabe; ein Klickpfad nicht.

## Der Beschaffungs-Weg

1. **Suchen, nicht raten.** `gh search repos` · `gh api search/repositories` · `pip index versions <x>` ·
   `npm search` · `brew search`. Der Befehl `command -v <x>` beantwortet „ist es schon da?" in
   einer Zeile.
2. **Installieren.** Nutzerweit, ohne Systemrechte: `pip install --user` · `npm i -g` · `brew install` ·
   offizielles Release-Binary. Die Fundstelle festhalten (siehe Beispiel unten).
3. **Erst wenn keine CLI existiert:** MCP prüfen — und zwar mit der Frage, ob er den Platz in
   *jeder* Session wert ist.
4. **Erst wenn beides nichts hergibt:** Browser.

## Wenn die CLI streikt: erst Version und Argumente, dann absteigen

Ein Fehlschlag ist selten ein Grund, die Stufe zu wechseln. Die Reihenfolge beim Nachsehen:
**Version veraltet? → Argumente/Modus? → gibt es einen bekannten Umgehungs-Schalter? → erst dann
abwärts.**

**Beleg (31.07.2026, gemessen):** Zwei YouTube-Transkripte sollten ausgewertet werden.

```bash
python3 -m pip install --user yt-dlp        # 2025.10.14 — höchste Fassung für Python 3.9
yt-dlp --skip-download --write-auto-sub …   # ERROR: The page needs to be reloaded.
```

Der Abstieg auf Browsersteuerung wäre hier der Reflex gewesen — falsch. Der Grund war der
voreingestellte Player-Client:

```bash
yt-dlp --skip-download --write-auto-sub --sub-lang "en-orig,en" --sub-format vtt \
       --extractor-args "youtube:player_client=android" -o "%(id)s.%(ext)s" "<url>"
```

Ergebnis: beide Transkripte in einem Durchgang, 41 700 Zeichen Klartext nach dem Säubern der
VTT-Dateien. Über Browsersteuerung wären das Dutzende Screenshots gewesen — für dieselbe
Information, die eine Zeile Shell liefert.

## Was das für den Werkzeug-Bestand heißt

- **Jeder verbundene MCP-Server braucht eine Begründung**, die die Kosten in *allen* Sessions
  rechtfertigt. Ein Server, der einmal im Monat gebraucht wird, gehört nicht dauerhaft verbunden.
- **Kein MCP, für den eine CLI existiert**, außer die CLI kann etwas nicht (Anmeldung, Push-Ereignisse).
- **Browsersteuerung ist kein Werkzeug für Daten**, sondern für Oberflächen. Wer damit Text holt,
  bezahlt Bilder für Buchstaben.

## Bewährte CLIs in dieser Werkbank

| Zweck | Werkzeug | Prüfen mit |
|---|---|---|
| GitHub (Repos, Suche, API, PRs) | `gh` | `gh --version` |
| JSON filtern, bevor es ins Fenster kommt | `jq` | `jq --version` |
| Video/Audio/Untertitel von Plattformen | `yt-dlp` | `yt-dlp --version` |
| Versionsverwaltung, auch über Repo-Grenzen (`git -C`) | `git` | `git --version` |

Fehlt eines, ist der erste Schritt die Installation — nicht der Umweg.

→ Nachbau: [rebuild-guide.md](rebuild-guide.md)
