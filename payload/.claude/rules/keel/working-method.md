# Arbeitsweise — sieben Schritte, sieben technische Besitzer

Ein Paket plant nicht nur Arbeit, sondern bindet den Originalauftrag bis zum
Endnachweis. Die sieben Schritte laufen in dieser Reihenfolge:
`docs/packages/<packageId>/` ist dauerhafte Fachwahrheit; `.unlazy/` ist nur
ignorierter Runtime- und Receipt-Zustand und wird niemals zum zweiten Plan.
Geschlossene Paket-Bundles werden nicht geloescht; ihre Evidence bleibt
versionierte Projektgeschichte.

1. **Erfassen:** OWNER.md speichert den unveränderlichen Owner-Auftrag und
   fortlaufende Anforderungen R1..Rn. PACKAGE.md leitet genau ein Problem,
   Intent und Goal daraus ab. Owner- und Paket-Schema blockieren Platzhalter,
   fehlende R→C-Zuordnung und spätere Ersetzung.
2. **Zuordnen:** Das nächste echte Git-Repo des Schreibziels besitzt
   `docs/packages/<packageId>/PACKAGE.md` samt Bundle-Sidecars. Activation erzeugt genau ein package.ref für Repo,
   Paket und Scope. Gleichnamige Pakete anderer Repos sind andere Identitäten.
3. **DoD/Contract:** Vor Fan-out müssen C→Gate-Mapping, vollständiger
   azyklischer Depth Tree, Leaf-/Node-Ledger, disjunkte OWNS sowie ausführbare
   CHECK/EXPECT- oder klar manuelle Gates bestehen.
4. **Arbeiten:** Ein Arbeitsagent schreibt in das OWNS seines Leaf; der Rücklauf
   übernimmt nur diese Dateien. Claims,
   Leases und Dispatch-Wellen laufen über Unlazy. Alle Mitglieder einer Welle
   werden gestartet und mit nativen Handles registriert, bevor gewartet wird.
5. **Coverage:** Owner-Schema prüft R→C, Paket-Schema C→Gate und Tree/Gate-
   Abdeckung. Fehlende oder doppelte Zuordnung ist ein Fehler, keine Restnotiz.
6. **Fulfillment:** Provider-Meldungen zählen nicht. return reverifiziert
   Leaves lokal; integrate erzeugt nach allen Returns einen gemeinsamen
   Integrations-Checkpoint und prüft Leaf→Node→Root. Erst grüne Evidence darf
   Planhaken ableiten.
7. **Abschluss:** close blockiert offene Sessions, Wellen, Entscheidungen,
   Gate-Lücken, stale Evidence, Owner-/Goal-Drift, Redundanz und zweite
   Wahrheiten. `package-cli.mjs` close reverifiziert erneut und schreibt den Receipt.

Prompt-Form und dod-guard erinnern nur an lesbare Kommunikation. Sie erzwingen
keinen dieser Schritte. Coverage und Fulfillment sind getrennte Messungen.
Geprueft gegen: und Offen: sind Berichtsformat, niemals Ersatz für Evidence.

Leaf-Sessions committen nicht mitten in einer parallelen Welle; der Parent
integriert alle verifizierten Leaves einmal (integrate). Git selbst ist lokal
frei; harness-core/git/git-intent.mjs bleibt als optionales Werkzeug. Ein
Publish braucht den Owner-OK-Wortlaut.

UI-Verifikation braucht einen echten Browser-Screenshot gegen den vereinbarten
Maßstab. DOM-Text allein erfüllt kein visuelles Gate. Das Gate nennt die Zustände
(Datei mit id, Pfad, Fenstergröße, Thema); fotografiert wird mit dem einen festen Skript
`node checks/ui-shots.mjs --states <Datei> --out <Ordner> --base-url http://127.0.0.1:<Port> (--code-root <Ordner der Quellen> | --harness-dashboard)`
nach dem Vorschau-Start (`preview_start` ist für Agenten frei, ebenso `node dashboard/serve.mjs`),
nie mit einem eigenen Skript je Paket. Jedes Bild hängt am Code-Stand der Oberfläche; `--verify`
lehnt Bilder eines älteren Stands ab, ein neuer Lauf fotografiert nur die genannten Zustände neu.

Portabilität wird beim Schreiben entschieden, nicht nachträglich: Windows ist
die erste Zielplattform, deshalb setzt jeder neue Code Pfade über `path.join`
statt über zusammengesetzte Strings zusammen, führt plattformabhängiges
Verhalten über eine ausdrückliche `process.platform`-Weiche und verwendet
POSIX-Dateimodi nur hinter genau dieser Weiche. Der Nachweis auf macOS ist
nachgelagert und gehört in das Paket `new-harness-portability`; bis er vorliegt,
behauptet kein Kommentar und kein Bericht eine dort ungemessene Plattform.
