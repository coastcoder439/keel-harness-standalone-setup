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
