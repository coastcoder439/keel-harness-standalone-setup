# Erst lesen, dann handeln; eigene Fehler recoverable korrigieren

Eine Owner-Korrektur wird zuerst in eigenen Worten gegen den unveränderlichen
Auftrag gespiegelt. Danach werden echter Code, Paketstatus und Evidence gelesen;
Vermutungen sind keine Grundlage für Änderungen.

Eigene ungesicherte Änderungen werden nicht blind zurückgebaut: erst den Stand
sichern (Commit oder Kopie), dann zurücknehmen, sodass der Rückbau selbst
wiederherstellbar bleibt. Der letzte eigene Checkpoint wird mit git revert
zurückgenommen, nicht durch Umschreiben der Historie. Breite History-Rewrites,
fremde Änderungen oder nicht recoverable Löschungen entscheidet der Owner; sein
ausdrücklicher Auftrag im Chat genügt. Auf GitHub gilt zusätzlich der
GitHub-Löschschutz.

**Bei „entweder … oder“ genau eine Option** [Owner 03.09.2026: „mach es einfach rückgängig den move des symbols“]:
Der Agent setzt genau eine Option um und nennt sie im Bericht. Eine Rücknahme liest den alten
Stand wörtlich aus Git (`git show <commit>:<pfad>`) und ändert nur die verlangte Zeile.
