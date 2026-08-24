# UI-Standard des Dashboards — lebendes Dokument

> Destilliert aus [`docs/history/dashboard-spec.md`](history/dashboard-spec.md)
> (die volle Spezifikation, archiviert) + `docs/dashboard-entscheidungen.md` +
> der Owner-Regel 25.08.2026: "du musst alle unsere regeln auch auf das
> dashboard anwenden. es ergibt keinen sinn für einen user, nur für
> maschinen." Wer eine Seite baut oder ändert, prüft gegen diese sieben Punkte
> — nicht gegen das Gedächtnis.

1. **Sätze, keine Fragmente.** Jede Zahl steht in einem Erklärsatz
   (`.erklaersatz`), nie als nackter Wert ohne Kontext. Keine Versalien-Wand:
   `.eigenschaft-abschnitt > summary` ist `text-transform:uppercase` — dafür
   gebaut, ein kurzes Feldgruppen-Label zu tragen (12 Zeichen), nicht einen
   ganzen Satz. Ein Paket-Titel oder eine Status-Zeile gehört NIE in ein
   `<summary>` dieser Klasse.

2. **Eine Klassen-Vokabular pro Kontext, nicht gemischt.** `.eintrag-*`
   (Titel/Untertitel/Meta/Status, `text-sm`) ist für Haupt-Listen gebaut —
   die Zeilen der Hauptfläche. `.eigenschaft-*` (`text-xs`, feste Label-
   Spalte) ist für die schmale 320-px-Detail-Spalte gebaut. Wer Haupt-Inhalt
   in `.eigenschaft-*` verpackt, bekommt eine Debug-Tabelle statt einer
   Seite — genau der Fehler der Kommandobrücke v1 (25.08.2026, Owner-Befund).

3. **Sechs Status-Wörter, nie Farbe allein.** `ok · hinweis · fehlt · befund
   · unlesbar · entfaellt` — immer über `HD.statusChip(code)` (Glyphe + Wort).
   Kein eigenes Icon, kein eigenes Wort für denselben Zustand erfinden.

4. **Etablierte Bausteine wiederverwenden, nicht neu erfinden.**
   `HD.gruppeHTML(titel, anzahl, offen)` für benannte Blöcke (Vorbild:
   `HD.fehltHTML`, `HD.ablaufHTML` in pages.js — ein bloßes `<section>` ohne
   eigene Klasse, kein `<h1>`/`<h2>`/`<h3>`). `HD.zeileHTML(e)` für
   Eintragszeilen. `HD.leerHTML(art)` für Leerzustände (Icon · Titel · Text ·
   Handlung). Der Seitenname steht NUR in der Kopfzeile (Pfadleiste) — kein
   zweites `<h1>` in der Hauptfläche.

5. **Kein Unicode-Symbol statt Icon.** ☐/☑ o.ä. sind Fremdkörper in einer
   Oberfläche, die durchgehend Lucide-SVGs führt (`HD.icon(name)`,
   Namensliste in `render/icons.js`).

6. **Verbotene Wörter** (Messlatte, `VERBOTEN` in labels.js): Brett, Posten,
   Rubrik, Marke, Dringlichkeit, Kennung, „nicht messbar", Wächter,
   Fähigkeiten, Befehle, Agenten (als Messvokabular), Krume/Tafel/
   Einzelansicht (als Code-Namen), Abkürzungen (Z., Anz., geänd., Std.).

7. **Optische Abnahme ist Pflicht, kein Nebenprodukt.** Vor jeder
   Fertigmeldung an UI-Code: echter Screenshot im Browser, gegen diese Liste
   geprüft — nicht nur DOM-Struktur/Text gelesen. Verankert in
   `working-method.md` (Verify-Schritt).
