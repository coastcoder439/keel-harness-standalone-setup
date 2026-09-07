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
4. **Arbeiten:** Nur gebundene Sessions schreiben in ihr Leaf-OWNS. Claims,
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

Git-Mutationen laufen ausschließlich über harness-core/git/git-intent.mjs.
Leaf-Sessions committen nicht in einer parallelen Welle (erzwungen: git-intent checkpoint, WAVE_IN_PROGRESS). Recoverable
discard/recover, letzter eigener Checkpoint-Revert, Integration und
Owner-freigegebener Publish haben je genau einen getesteten Intent.

UI-Verifikation braucht einen echten Browser-Screenshot gegen den vereinbarten
Maßstab. DOM-Text allein erfüllt kein visuelles Gate.

Portabilität wird beim Schreiben entschieden, nicht nachträglich: Windows ist
die erste Zielplattform, deshalb setzt jeder neue Code Pfade über `path.join`
statt über zusammengesetzte Strings zusammen, führt plattformabhängiges
Verhalten über eine ausdrückliche `process.platform`-Weiche und verwendet
POSIX-Dateimodi nur hinter genau dieser Weiche. Der Nachweis auf macOS ist
nachgelagert und gehört in das Paket `new-harness-portability`; bis er vorliegt,
behauptet kein Kommentar und kein Bericht eine dort ungemessene Plattform.
