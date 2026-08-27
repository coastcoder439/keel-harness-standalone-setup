# UI-Standard Werkzeug-Oberflaeche -- ergaenzt docs/ui-standard.md

> Herkunft der Regeln: **IBM Carbon Design System** (Apache-2.0; enthaelt Material aus dem
> Carbon Design System, urheberrechtlich geschuetzt von IBM Corp., verwendet unter der
> Apache-Lizenz 2.0), **SAP Fundamental Styles** (Apache-2.0), **GitHub Primer** (MIT),
> ergaenzt um W3C WCAG 2.1. Stand 27.08.2026.
>
> Dieses Dokument regelt das **WANN welches Muster** genommen wird. `docs/ui-standard.md`
> regelt, **wie es hier heisst** (Klassen-Vokabular, sechs Status-Woerter, Bausteine),
> und `rules.md` regelt, **wie es technisch gebaut** wird (Zugaenglichkeit, Fokus,
> Formulare, Bewegung, Typografie). Bei Widerspruch gilt `docs/ui-standard.md`.

## 1. Tabellen und Listen mit vielen Zeilen

**T1** Nimm eine Tabelle nur, wenn der Leser je Zeile mehrere Spalten gegeneinander vergleichen muss; eine Folge gleichartiger Eintraege bleibt eine Liste aus `HD.zeileHTML`. (Carbon, Data table Usage -- When to use)

**T2** Baue keine Tabelle fuer Rechenarbeit oder komplexere Darstellungen; fuehre statt dessen auf eine eigene Ansicht, statt die Tabelle Richtung Tabellenkalkulation zu erweitern. (Carbon, Data table Usage -- When not to use)

**T3** Setze ueber jede Tabelle einen Titel, der sagt, was die Zeilen gemeinsam haben; eine Zeile darunter darf die Herkunft der Daten erklaeren. (Carbon, Data table Usage -- Content)

**T4** Halte jeden Spaltentitel bei einem oder zwei Woertern, umbreche einen zu langen Titel erst auf zwei Zeilen und kuerze ihn erst danach. (Carbon, Data table Usage -- Column titles)

**T5** Gib der Kopfzeile genau dieselbe Zeilenhoehe wie den Datenzeilen; unterschiedliche Hoehen zwischen Kopf und Rumpf sind ein Fehler. (Carbon, Data table Usage -- Sizing)

**T6** Stimme die Hoehe der Leiste ueber der Tabelle auf die Zeilenhoehe ab: hohe Leiste zu hohen Zeilen, flache Leiste zu flachen Zeilen. (Carbon, Data table Usage -- Sizing)

**T7** Stelle eine Tabelle in den Hauptbereich mit der groessten verfuegbaren Breite; verschachtele nie eine Tabelle in eine Tabelle oder in die schmale 320-Bildpunkt-Detailspalte. (Carbon, Data table Usage -- Placement)

**T8** Bemiss die Spaltenbreiten so, dass der uebliche Inhalt ungekuerzt hineinpasst; Kuerzung ist der Notfall, nicht die Planungsgrundlage. (Carbon, Data table Usage -- Placement)

**T9** Lass die Hervorhebung der Zeile beim Ueberfahren auch bei Zeilen ohne Handlung aktiv, weil sie das Auge ueber die Spalten einer Zeile fuehrt. (Carbon, Data table Usage -- Hover)

**T10** Lege das Sortieren ausschliesslich in die Spaltenkoepfe mit unsortiert, aufsteigend und absteigend; zeige das Zeichen dauerhaft nur an der sortierten Spalte, sonst bei Ueberfahren ODER Tastatur-Fokus. (Carbon, Data table Usage -- Sorting; Tastatur-Fokus ergaenzt)

**T11** Biete Mehrfachauswahl ueber ein Kontrollkaestchen je Zeile an; das Kaestchen im Spaltenkopf waehlt alle Zeilen und traegt gewaehlt, nicht gewaehlt und teilweise gewaehlt. (Carbon, Data table Usage -- Selectable)

**T12** Nimm fuer die Auswahl genau einer Zeile eine Radio-Schaltflaeche links und stelle die zugehoerige einzelne Handlung rechts in die Leiste ueber der Tabelle. (Carbon, Data table Usage -- Radio selection)

**T13** Blende die Leiste fuer Handlungen auf mehreren Zeilen erst ein, sobald die erste Zeile gewaehlt ist, sperre waehrenddessen alle Handlungen in den einzelnen Zeilen und biete Abbrechen am rechten Ende an. (Carbon, Data table Usage -- Batch actions)

**T14** Nutze aufklappbare Zeilen fuer ergaenzende oder erst bei Bedarf geladene Daten; wird es im aufgeklappten Bereich eng, fuehre auf eine eigene Seite oder in die Detailspalte. (Carbon, Data table Usage -- Expandable)

**T15** Biete Alles-aufklappen nicht als Voreinstellung an, weil es den Ladevorteil des spaeteren Abfragens wieder aufhebt. (Carbon, Data table Usage -- Batch expansion)

**T16** Setze bei Zeilen mit Aufklappen und Auswahl das Aufklapp-Element ganz links und die Auswahl rechts daneben, nie umgekehrt. (Carbon, Data table Usage -- Expandable + selectable)

**T17** Zeige bei weniger als drei Handlungen je Zeile diese unmittelbar als eigene Schaltflaechen; erst ab drei buendele sie in ein Menue am rechten Zeilenende. (Carbon, Data table Usage -- Inline actions)

**T18** Halte die Handlungen einer Zeile sichtbar, sobald die Zeile Maus-Hover ODER Tastatur-Fokus hat, und zeige sie auf Geraeten ohne Zeigegeraet dauerhaft. (Carbon, Data table Usage -- Overflow menu; Tastatur-Fokus ergaenzt)

**T19** Fuehre in der Leiste ueber der Tabelle hoechstens fuenf Handlungen und schiebe weitere in ein Menue; dort stehen nur tabellenweite Handlungen, nie zeilenbezogene. (Carbon, Data table Usage -- Table toolbar)

**T20** Stelle die Seitenweiterschaltung immer unter die Tabelle; die einfache Form fuehrt nur vorwaerts und rueckwaerts, die erweiterte zusaetzlich Zeilen je Seite und Sprung auf eine Seite. (Carbon, Data table Usage -- Pagination)

**T21** Schalte abwechselnde Zeilenhintergruende nur dann zu, wenn der Leser waagerecht ueber viele Spalten hinweg liest. (Carbon, Data table Usage -- Alternating row color)

**T22** Kuerze einen Wert nur, wenn dabei mindestens drei Zeichen wegfallen und mindestens vier Zeichen stehen bleiben; sonst verbreitere die Spalte. (Carbon, Overflow content -- Truncation)

**T23** Kuerze Fliesstext am Ende, kuerze vorn, wenn der Anfang austauschbar ist, und kuerze in der Mitte, wenn sich die Werte nur an Anfang und Ende unterscheiden. (Carbon, Overflow content -- Variations)

**T24** Kuerze niemals Titel, Beschriftungen, Fehlertexte oder Meldungstexte; Kuerzung trifft nur Werte in Zellen und lange Namen. (Carbon, Overflow content -- Usage)

**T25** Mache den vollen Wert jedes gekuerzten Textes bei Ueberfahren UND bei Tastatur-Fokus abrufbar; einzige Ausnahme ist das Ende eines gekuerzten Absatzes. (Carbon, Overflow content -- Truncation; Tastatur-Fokus ergaenzt)

**T26** Nutze bei viel nachfolgendem Inhalt eine Schaltflaeche unter der Liste statt weicher Verlaeufe oder endlosen Weiterrollens, und benenne sie Mehr laden, wenn die Ladezeit der Grund ist. (Carbon, Overflow content -- Show more buttons)

## 2. Filtern und Suchen

**T27** Nimm Einfachauswahl, wenn genau ein Wert einer Kategorie einschraenken darf (die Auswahl ist dann nie leer), und Mehrfachauswahl, sobald mehrere Werte derselben Kategorie gleichzeitig gelten sollen. (Carbon, Filtering -- Single selection, Multiselect)

**T28** Fuehre jede Kategorie als eigene Menge von Werten zu einem Thema, schreibe den Kategorienamen aus und baue sie mit `HD.gruppeHTML(titel, anzahl, offen)`, wobei die Anzahl die aktiven Werte dieser Kategorie nennt. (Carbon, Filtering -- Selecting multiple categories)

**T29** Stelle mehrere Kategorien senkrecht links neben der Liste oder waagerecht darueber dar und stecke sie niemals gemeinsam in ein Aufklapp-Menue. (Carbon, Filtering -- Selecting multiple categories)

**T30** Sammle die Auswahl hinter einem Knopf Filter anwenden und halte die Liste bis zum Druck unveraendert, wenn ueber mehrere Kategorien gewaehlt wird oder das Nachladen spuerbar dauert. (Carbon, Filtering -- Multiple filters with batch updates)

**T31** Wende den Filter sofort bei jeder einzelnen Auswahl an, wenn es nur eine Kategorie gibt oder ohnehin nur eine Auswahl erwartet wird. (Carbon, Filtering -- Multiple filters with instant updates)

**T32** Starte eine Kategorie mit allen Werten ausgewaehlt, wenn ueblicherweise nur einzelne Kriterien ausgeschlossen werden, und mit keinem Wert, wenn ueblicherweise nur ein einziges Kriterium interessiert; lege das je Kategorie einzeln fest. (Carbon, Filtering -- Filter states)

**T33** Zeige am geschlossenen Filter, dass gefiltert wird, und schreibe die Zahl der aktiven Filter als vollen Satz, nie als nackte Zahl neben dem Titel. (Carbon, Filtering -- Filter states)

**T34** Biete das Zuruecksetzen direkt am geschlossenen Filter an, gib jeder Kategorie ein eigenes und ergaenze ein zweites ueber alle Kategorien, sobald mehrere zugleich auf dieselbe Liste wirken. (Carbon, Filtering -- Resetting filters)

**T35** Stelle beim Zuruecksetzen den festgelegten Startzustand der Kategorie wieder her, nicht pauschal nichts ausgewaehlt. (Carbon, Filtering -- Resetting filters)

**T36** Beschreibe Filterwerte nie mit den sechs Status-Woertern; ausgewaehlt und nicht ausgewaehlt ist ein Auswahlzustand und bekommt kein Status-Zeichen. (Carbon, Filtering -- Filter states; Hauspunkt 3)

**T37** Nimm die Suche fuer frei getippte Stichwoerter und den Filter fuer vorgegebene Werte; biete die Kategorien erst an der Ergebnisliste an, nicht vor dem ersten Tippen. (Carbon, Search -- Overview, Results page)

**T38** Nimm die mitlaufende Suche fuer kleine Mengen wie eine Seite oder eine Liste, schraenke nach jedem Zeichen ein und verzichte auf einen Absende-Knopf zugunsten eines Loesch-Bedienelements mit `HD.icon(name)`. (Carbon, Search -- Active search)

**T39** Suche erst auf Ausloesung und fuehre auf eine eigene Ergebnisseite, wenn die Menge gross ist oder jede Abfrage spuerbar teuer wird. (Carbon, Search -- Basic search, When to use)

**T40** Setze keine Beschriftung ueber das Suchfeld; ein Lupen-Icon ueber `HD.icon(name)` und ein Platzhaltersatz, der das Durchsuchte benennt, reichen aus. (Carbon, Search -- Don't include a label)

**T41** Erlaube in einer vorgeschalteten Bereichsauswahl immer nur einen Bereich, biete stets den Eintrag Alle an und waehle ihn vor. (Carbon, Search -- Add a scope filter)

**T42** Nenne die Trefferzahl in jedem Fall als Satz, auch bei null Treffern, und bei Bereichsauswahl zusaetzlich je Bereich. (Carbon, Search -- Display the number of results)

**T43** Lass einen aus der Ergebnisliste uebernommenen Filter ueber die folgenden Suchen bestehen, bis er verworfen wird oder die Sitzung neu beginnt. (Carbon, Search -- Focused search)

**T44** Halte nach jedem Filterschritt die Arbeitsstelle in der Liste; das Nachladen darf niemanden an den Listenanfang zurueckwerfen. (Carbon, Search -- Faceted filtering)

## 3. Leerzustaende und Teilausfall

**T45** Uebergib `HD.leerHTML(art)` genau einen dieser sechs Werte: `keine-daten`, `kein-treffer`, `nichts-zu-tun`, `kein-zugriff`, `einrichtung-noetig`, `quelle-gestoert`; jeder andere Wert ist ein Fehler. (Carbon, Types of empty states)

**T46** Waehle `keine-daten` nur, wenn die Quelle antwortete und wirklich nichts enthielt; blieb sie stumm, nimm `quelle-gestoert`. (Primer, Degraded page content)

**T47** Setze den Leerzustand genau an die Stelle, an der die Daten gestanden haetten, und ersetze das ganze ausgefallene Element samt Kopfzeile, statt eine leere Liste stehen zu lassen. (Carbon, Where to use; Best practices)

**T48** Zeige nie einen allgemeinen Leerzustand dort, wo der Mensch selbst schon etwas angelegt hat, sondern erklaere die Stoerung. (Primer, Replacing UI with messages)

**T49** Formuliere den Titel bei `keine-daten` als positiven Anfangssatz und sage im Text in einem Satz, was hier stehen wird, sobald Daten vorliegen. (Carbon, Anatomy; No data empty states)

**T50** Biete bei `kein-treffer` als Handlung an, Suche oder Filter zu lockern, und nenne im Text die gerade wirkende Einschraenkung. (Carbon, User action empty states)

**T51** Lass bei `nichts-zu-tun` den Handlungsteil leer, wenn es keinen naechsten Schritt gibt, weil schlicht nichts vorliegt. (Carbon, User action empty states)

**T52** Nenne bei `kein-zugriff`, wer den Zugang erteilt und auf welchem Weg der Mensch ihn anfragt; nenne bei `einrichtung-noetig` nur den ersten Einrichtungsschritt, nicht die vollstaendige Einrichtung. (Carbon, Error management empty states)

**T53** Sage bei `quelle-gestoert` in klaren Worten, welche Quelle ausgefallen ist und wo der Mensch nachliest; eine Fehlernummer allein genuegt nicht. (Carbon, Error management empty states)

**T54** Fuehre je Leerzustand hoechstens einen hervorgehobenen Weg; jeden weiteren stelle als schlichten Verweis darunter, und bei mehreren gleichzeitig sichtbaren Leerzustaenden bleibt hoechstens einer hervorgehoben. (Carbon, No data empty states; Multiple empty states)

**T55** Fuehre den Menschen nie in eine Sackgasse: gibt es einen sinnvollen naechsten Schritt, steht er im Leerzustand. (Carbon, Error management empty states, Don't)

**T56** Beschreibe im Leerzustand ausschliesslich den Bereich, in dem er steht, sachlich und ohne Scherz, in gewoehnlicher Sprache statt in Fachkuerzeln des Systems. (Carbon, No data empty states, Don't; Error management empty states, Do)

**T57** Lass das Icon weg, sobald der Platz schmal ist (Detailspalte, kleine Kacheln) oder mehrere Leerzustaende nebeneinander stehen. (Carbon, Image choice considerations; Best practices)

**T58** Ersetze die ganze Seite nur dann durch eine Fehlerseite, wenn der tragende Inhalt fehlt; faellt nur Beiwerk aus, zeige die Seite mit dem Rest weiter. (Primer, Primary vs secondary experiences)

**T59** Zeige einen Streifen ueber der Seite, wenn eine Stoerung mehrere Bereiche zugleich trifft, und fasse ab mehr als fuenf Stoerungsmeldungen alles zu dieser einen Meldung zusammen. (Primer, Global system notifications; Degraded page content)

**T60** Entferne eine Schaltflaeche, die gerade nichts bewirkt, nur solange ihr Fehlen niemanden ratlos macht; nie entfernt werden Absenden, Antworten und Beurteilen. (Primer, Non-functional buttons)

**T61** Schalte eine tragende Schaltflaeche nie wegen einer Stoerung tot, sondern lass sie erreichbar und erklaere an Ort und Stelle, warum sie gerade nicht greift. (Primer, Non-functional buttons)

**T62** Blende eine Zahl, die wegen der Stoerung fehlt, ganz aus statt einer Null oder eines Platzhalters, und erklaere die Luecke an der Stelle selbst. (Primer, Handling unavailable counts)

**T63** Setze bei einem Eintrag, dessen Wert wegen der Stoerung fehlt, den Status auf `unlesbar`, statt einen erfundenen oder alten Wert weiterzuzeigen. (Primer, Removing UI)

**T64** Lass die Hauptnavigation immer stehen, nimm nur die einzelnen Verweise heraus, deren Daten fehlen, und rendere Verweise auf fehlende Daten gar nicht erst. (Primer, Degraded navigation; Page navigation)

**T65** Sag es ausdruecklich, wenn ein Bereich zuerst geladen hat und dann scheiterte; lautlos verschwinden lassen ist verboten. (Primer, Loading states and timeouts)

**T66** Lass keinen Bereich unbegrenzt laden: nach Ablauf der Wartezeit tritt `quelle-gestoert` an seine Stelle. (Primer, Loading states and timeouts)

**T67** Lass in einem halb bedienbaren Formular Eingabefeld und Absenden stehen und erklaere die Stoerung direkt am betroffenen Feld. (Primer, Removing UI, Forms)

## 4. Zustand zeigen, Laden, Gesperrt gegen Nur-Lesen

**T68** Zeige eine Statusanzeige nur, wenn daraus eine Handlung folgt oder der Zustand wirklich wichtig ist; sonst schreib den Zustand als gewoehnlichen Satz in die Zeile. (Carbon, Status indicator -- Cognitive load)

**T69** Halte hoechstens fuenf bis sechs Statusanzeigen gleichzeitig im selben Blickfeld; werden es mehr, buendle die Zeilen ueber `HD.gruppeHTML`. (Carbon, Status indicator -- Cognitive load)

**T70** Fasse mehrere Zustaende einer Gruppe zu einem zusammen und zeige den aufmerksamsten der Gruppe: befund vor fehlt vor unlesbar vor hinweis vor ok. (Carbon, Status indicator -- Consolidated statuses)

**T71** Setze die Statusanzeige in dieselbe Zeile wie das Ding, das sie beschreibt, stelle sie vor den Titel-Text und richte sie bei gestapelten Zeilen linksbuendig aus. (Carbon, Status indicator -- Labeling and type pairing, Alignment)

**T72** Setze an eine Sammelzeile nur dann eine Anzahl, wenn die genaue Zahl fuer eine Entscheidung zaehlt; sonst zeige nur, dass es dort etwas Neues gibt. (Carbon, Status indicator -- Badge indicator)

**T73** Kennzeichne eine Veraenderung gegenueber dem letzten Stand mit Vorzeichen oder Pfeil-Icon vor der Zahl, nie mit Farbe als einzigem Traeger. (Carbon, Status indicator -- Differential indicator)

**T74** Verwende dieselbe Glyphe-Wort-Paarung aus `HD.statusChip` in der ganzen Oberflaeche fuer denselben Zustand; dieselbe Glyphe in zwei Bedeutungen ist verboten. (Carbon, Status indicator -- Best practices)

**T75** Zeige unter einer Sekunde gar keine Lade-Anzeige, bis drei Sekunden eine Anzeige ohne Wert, bis zehn Sekunden einen Fortschritt mit Wert. (Primer, Loading -- Adapting to different wait times)

**T76** Behandle jeden Vorgang ueber zehn Sekunden als Hintergrund-Arbeit mit Fortschrittswert und lass die uebrige Seite bedienbar. (Primer, Loading -- Adapting to different wait times)

**T77** Nimm ein Skelett nur fuer Behaelter und Datenbereiche wie Listenzeilen, Karten und Tabellen; nie fuer Knoepfe, Eingabefelder, Auswahllisten, Dialoge oder Meldungen. (Carbon, Loading -- Skeleton states)

**T78** Baue das Skelett in genau der Form, die der geladene Inhalt danach einnimmt, damit beim Ersetzen kein Sprung im Seitenaufbau entsteht. (Primer, Loading -- Scoping loading indicators)

**T79** Lass Flaechen ohne Text einfach leer, statt fuer jedes einzelne Element ein Skelett zu zeichnen. (Carbon, Loading -- Progressive loading)

**T80** Lade in Stufen: zuerst Geruest und Text, danach Bilder, Inhalt ausserhalb des Sichtbereichs und die bedienbaren Teile. (Carbon, Loading -- Progressive loading)

**T81** Zeige jeden Eintrag einer Liste, sobald er geladen ist, statt bis zum letzten Eintrag alles zurueckzuhalten. (Primer, Loading -- Incremental loading)

**T82** Ersetze mehrere benachbarte Lade-Anzeigen durch eine einzige fuer den ganzen Bereich und setze sie bei grossen Bereichen mittig, aber innerhalb des sichtbaren Ausschnitts. (Primer, Loading -- Small areas, Large areas)

**T83** Nimm eine Vollbild-Anzeige nur bei wirklich gesperrter Bedienung -- beim Speichern eingegebener Daten oder wenn die ganze Seite neu rechnet -- und sonst die Anzeige an Ort und Stelle in Zeile oder ausloesendem Knopf. (Carbon, Loading -- Full-screen loading, Inline loading)

**T84** Zeige den Leerzustand ueber `HD.leerHTML` erst, wenn das Laden beendet ist und wirklich nichts vorliegt; waehrend des Ladens gehoert dorthin das Skelett. (Carbon, Loading -- Skeleton states)

**T85** Melde am Ende jedes Vorgangs sichtbar, ob er geglueckt oder gescheitert ist, und biete beim Scheitern die Wiederholung als Handlung im selben Bereich an. (Primer, Loading -- Lifecycle of a loading state)

**T86** Sperre waehrend des Absendens die Eingabefelder, aber nicht den ausloesenden Knopf selbst -- der traegt die Lade-Anzeige und bleibt lesbar. (Primer, Loading -- Disabling controls during loading)

**T87** Sperre ein Bedienelement nur, solange eine Voraussetzung fehlt, schreib in den Erklaersatz daneben, was es wieder freigibt, und lass es waehrend der Sperre sichtbar an seinem Platz. (Carbon, Disabled states -- Default disabled)

**T88** Zeige Inhalt, den man lesen soll aber nicht aendern darf, als nur-lesbar und niemals als gesperrt -- gesperrte Inhalte gelten als nicht lesbar. (Carbon, Read-only states -- Best practices)

**T89** Nimm nur-lesbar fuer laufenden Vorgang, Belegung durch jemand anderen und fehlende Aenderungs-Berechtigung; nimm gesperrt allein fuer fehlende Voraussetzung. (Carbon, Read-only states -- When to use)

**T90** Blende ein Element vollstaendig aus, wenn die Berechtigung zum Sehen fehlt; dann darf weder Platzhalter noch Wort noch Sperre davon zeugen. (Carbon, Disabled states -- Hidden)

**T91** Behalte im nur-lesbaren Zustand Aufbau, Abstaende und Textfarbe des bedienbaren Zustands bei und nimm nur die Anfass-Zeichen wie Rahmen und Icon-Farbe zurueck. (Carbon, Read-only states -- Formatting)

**T92** Lass ein bereits gesperrtes Element auch dann gesperrt, wenn die ganze Ansicht auf nur-lesbar umschaltet, und ersetze in nur-lesbaren Feldern jede Aufforderung durch eine Aussage. (Carbon, Read-only states -- Read-only viewports, Content)

## 5. Informationsdichte

**T93** Setze die Dichtestufe einmal am umschliessenden Behaelter der Seite und lass Listen, Spalten und Schaltflaechen sie erben, statt sie je Zeile zu setzen. (SAP content-density, Application-Level Density)

**T94** Betreibe das Dashboard als Standard in der kompakten Stufe, weil es mit Maus und Tastatur bedient wird und viele Zeilen gleichzeitig zeigen soll. (SAP content-density, Mouse/Keyboard Devices)

**T95** Schalte die gesamte Oberflaeche auf die komfortable Stufe, sobald sie mit dem Finger bedient wird, und halte dort jedes Klickziel mindestens 44 mal 44 Bildpunkte gross. (SAP content-density, Touch Devices; W3C WCAG 2.1, Target Size Enhanced)

**T96** Setze die kompakte Stufe nur dort ein, wo mit einem Zeigegeraet gearbeitet wird, denn ihr Klickziel von 32 Bildpunkten liegt unter dem Fingermass. (SAP content-density, Accessibility Considerations)

**T97** Waehle die Stufe nach der Fensterbreite: unterhalb von 1024 Bildpunkten komfortabel, ab 1024 Bildpunkten kompakt; bleib komfortabel, solange eine Ansicht weniger als zehn bedienbare Elemente zeigt. (SAP content-density, Responsive Density, Decision Guide)

**T98** Verwende die sehr dichte Stufe ausschliesslich in einer Haupt-Liste mit vielen Spalten, nie fuer eine ganze Seite, und verbiete sie auf fingerbedienten Geraeten. (SAP content-density, Condensed Mode, Accessibility Considerations)

**T99** Lass einen Baustein, der die sehr dichte Stufe nicht beherrscht, auf die kompakte Stufe zurueckfallen, statt ihn einzeln kleiner zu rechnen. (SAP content-density, Fallback behavior)

**T100** Mische innerhalb einer Liste niemals zwei Dichtestufen; benachbarte Zeilen und ihre Schaltflaechen tragen dieselbe Hoehe. (SAP content-density, Never Mix Modes)

**T101** Erlaube eine abweichende Stufe nur fuer einen vollstaendig abgegrenzten Bereich, etwa die Werkzeugleiste ueber der Liste, und setze sie an dessen Behaelter. (SAP content-density, Section-Level Density)

**T102** Halte die Schriftgroesse zwischen komfortabler und kompakter Stufe unveraendert und verkleinere allein Innenabstand, Aussenabstand und Zeilenhoehe. (SAP content-density, Spacing Changes)

**T103** Plane die Zeilenhoehe der Haupt-Liste mit rund 44 Bildpunkten komfortabel, 32 kompakt und 24 sehr dicht, und miss sie an der gebauten Seite nach. (SAP content-density, Size Comparison)

**T104** Lass benachbarte Klickziele einer dichten Zeile einander nicht ueberdecken, denn ueberlappende Flaeche zaehlt nicht zur Zielgroesse. (W3C WCAG 2.1, Target Size Enhanced)

## Bewusst nicht abgedeckt

- **Tastatur-Kurzbefehle und Befehlspalette** -- in KEINER der geprueften Quellen enthalten. Es gibt hier keine Regel dazu; wer eine braucht, muss zuerst eine Quelle beschaffen.
- **Massenbearbeitung** -- Auswahl mehrerer Zeilen ist geregelt (T11, T13), das Bearbeiten mehrerer Werte in einem Zug nicht.
- **Virtualisierung grosser Listen** -- Ladeverhalten ist geregelt (T80, T81), das Auslassen nicht sichtbarer Zeilen nicht; das gehoert zur Bau-Mechanik.
- **Beim Rollen stehenbleibende Kopfzeile** -- beide gelesenen Tabellen-Quellseiten sagen dazu nichts; keine Regel erfunden.
- **Filter im Adressfeld, teilbare Links** -- weder Filtering noch Search sagen ein Wort zu URL oder teilbaren Zustaenden.

## Aufgeloeste Kollisionen

- **Hauspunkt 3, sechs abgeschlossene Status-Woerter.** Carbon fuehrt zusaetzliche Sortier-, Auswahl- und Facetten-Zustaende, vier Fehlerarten und Farbwerte fuer Entwurf und Ausreisser; Primer verlangt einen dritten Zustand fuer ausgefallene Bedienelemente. Kein siebtes Wort uebernommen: die Fehlerarten leben ausschliesslich als Werte von `HD.leerHTML(art)` (T45), fehlende Werte an Eintraegen bekommen das vorhandene Wort `unlesbar` (T63), Auswahlzustaende von Filtern bekommen gar kein Status-Zeichen (T36), und die Rangfolge beim Zusammenfassen bleibt innerhalb der sechs Woerter (T70).
- **Hauspunkt 5, kein Unicode-Symbol statt Icon.** Carbon beschreibt Loeschen als Kreuz-Zeichen, Suche als Lupen-Zeichen, Zeilenaktionen als Auslassungspunkte und eine reine Form-plus-Farbe-Anzeige ohne Symbol; Primer nennt fuer den Erfolgsfall ein Haken-Zeichen; SAP bewertet mit Haken, Kreuz und Warnzeichen. Alles ueber `HD.icon(name)` beziehungsweise die Glyphe-Wort-Paarung von `HD.statusChip` aufgeloest (T38, T40, T74); Carbons Auslassungspunkte-als-Schaltflaeche wurde nicht uebernommen, T17 fuehrt statt dessen ein Menue mit Symbol.
- **Hauspunkt 1, jede Zahl in einem Erklaersatz.** Carbon fordert die Zahl der aktiven Filter und die Trefferzahl als blossen Wert; beide Regeln verlangen hier den vollen Satz (T33, T42).
- **Nur-Hover-Sichtbarkeit gegen Tastatur-Bedienbarkeit.** Carbon bindet Zeilenaktionen, das Sortierzeichen nicht sortierter Spalten und den vollen Text gekuerzter Werte an reines Ueberfahren mit der Maus. Ueberall auf "Maus-Hover ODER Tastatur-Fokus" erweitert (T10, T18, T25); Carbons eigene Ausnahme fuer Geraete ohne Zeigegeraet steht in T18.
- **Hauspunkt 2 und Vanilla-JS gegen fremdes Vokabular.** Carbon, SAP und Primer steuern ueber eigene Klassen-, Komponenten- und Prop-Namen. Kein einziger davon uebernommen; die Dichte wird einmal am Seiten-Behaelter gesetzt und vererbt (T93), damit neben `.eintrag-*` und `.eigenschaft-*` kein drittes Vokabular entsteht.
- **Englische Coding-Namen gegen deutsche Ursachen-Woerter.** Die sechs Werte des Arguments `art` in `HD.leerHTML` sind deutsch und mit Bindestrich geschrieben (T45) -- eine bewusste Ausnahme genau fuer dieses eine Argument, beim Einbau kurz zu bestaetigen.
- **Ausblenden gegen Leerzustand.** Spurloses Ausblenden bei fehlender Sicht-Berechtigung (T90) und sichtbar-aber-leer ueber `HD.leerHTML` (T84) sind zwei verschiedene Faelle und duerfen nicht vermischt werden.
