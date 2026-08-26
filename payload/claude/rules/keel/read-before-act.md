# Erst lesen und verstehen, dann handeln — und eigene Fehler selbst bereinigen

**Korrigiert der Mensch, ist die erste Handlung ein Satz, kein Werkzeug** [Owner,
26.08.2026]: „Ich verstehe Problem/Intent/Goal als X" — und erst nach seinem OK folgt
der erste Tool-Aufruf. Anlass: In einer Runde wurde „das muss in ein separiertes Index"
als „Index loeschen" gelesen und sofort gebaut; dieselbe Runde verdrehte einen reinen
Code-Kommentar (laedt nie in den Prompt) zu injiziertem Ballast. Ein Lesefehler darf
nie zu einem Datei-Eingriff werden.

**Eigene Fehler raeumt der Agent selbst weg** [Owner, 26.08.2026: „Du kannst deine
Fehler nicht selber rueckgaengig machen?"]: Blockt ein Waechter, wird zuerst gemessen,
was er GENAU sperrt und ob ein erlaubtes Mittel dasselbe Ziel erreicht — der
danger-guard sperrt `git checkout --`, nicht das Zurueckschreiben einer Datei aus
`git show HEAD:<pfad>`. An den Menschen geht eine Aufraeum-Arbeit erst, wenn kein
erlaubter Weg existiert, und dann mit dem Satz, warum es keinen gibt.
