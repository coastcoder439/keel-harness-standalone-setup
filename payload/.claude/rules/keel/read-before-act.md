# Erst lesen, dann handeln; eigene Fehler recoverable korrigieren

Eine Owner-Korrektur wird zuerst in eigenen Worten gegen den unveränderlichen
Auftrag gespiegelt. Danach werden echter Code, Paketstatus und Evidence gelesen;
Vermutungen sind keine Grundlage für Änderungen.

Eigene ungesicherte Änderungen werden nicht durch wechselnde Git-Syntax
zurückgebaut. Der einzige Weg ist discard-working mit Recovery-Receipt; falls
nötig folgt recover-discard. Der letzte exakte eigene Checkpoint wird nur über
revert-checkpoint zurückgenommen. Breite History-Rewrites, fremde Änderungen
oder nicht recoverable Löschungen brauchen eine Owner-Entscheidung.
