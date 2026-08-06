# 11 — Vollständigkeits-Prüfung: was „fertig" wirklich heißt

> **Status:** gilt ab sofort für jede Planungs- und Bau-Arbeit in dieser Werkbank.
> **Anlass (Auftraggeber, 30.07.2026):** „Du sagst immer wieder, es ist fertig — aber es ist nicht
> fertig. Es sind tausend Lücken drin." Das stimmte jedes Mal. Dieses Dokument ist die
> Antwort darauf: die Fehlermuster, die Definition von *fertig*, die Prüf-Dimensionen und
> die Gegenproben. Es ist harness-tauglich geschrieben (übernehmbar nach
> `.claude/rules/ecc/common/`).

---

## 1. Die Beweislage — echte Fehler, nicht ausgedachte

Diese Muster stammen alle aus **diesem** Projekt. Sie sind der Grund für jede Regel unten.

| # | Muster | Was wirklich passiert ist |
|---|---|---|
| **F1** | **„Fertig" = Formular ausgefüllt statt Frage beantwortet** | Der Arbeitspaket-Plan wurde für bau-bereit erklärt, weil **jedes** Paket Datenmodell, Oberfläche, Prüfschritte und Testplan hatte. Es fehlten trotzdem: die drei Onboardings, Infotexte, Touren, das mitnehmbare Fenster, die Druckerpresse und die **komplette Laufzeit-/Arbeitsplatz-Schicht**. Alle Formulare waren voll — die Fragen waren nie gestellt worden. |
| **F2** | **Das Dokument gegen sich selbst geprüft, nie gegen seine Quellen** | Der Plan lief durch drei Audits — jedes Mal als Dokument gegen den Code. Erst als der Inhaber auf die Marken- und Vision-Dokumente zeigte, fielen **19 ungedeckte Ansprüche** heraus. Ein Plan kann in sich schlüssig und trotzdem am Auftrag vorbei sein. |
| **F3** | **Entscheidung ohne Nachbarschafts-Gegenprobe** | „Zwei Nutzerklassen: die meisten arbeiten nur im Browser" war lokal plausibel — und schnitt global den Ast ab, für den die CLI-Druckerpresse überhaupt existiert (Agenten sollen die Programme des Menschen bedienen, und die liegen auf seiner Maschine). |
| **F4** | **Zwei unabhängige Achsen in eine Entscheidung gepresst** | „Wo arbeitet der Mensch (Browser/Terminal)" und „wo läuft der Agent (Server/Maschine/Knoten/Sandbox)" sind zwei Fragen. Als eine behandelt, zementiert die Antwort auf die erste stillschweigend die zweite. |
| **F5** | **Zustimmung eingeholt statt Folgepflicht gesucht** | „Isolierte Arbeitsbereiche einschalten — nickst du?" Die eigentliche Arbeit war zu finden, dass der Fork alte Arbeitsbäume zwar **markiert**, aber nie **aufräumt**. Die Entscheidung erzeugt eine Pflicht; die gehört in denselben Plan. |
| **F6** | **Alarm oder Entwarnung auf halber Verifikation** | Gemeldet: „Agenten erben den privaten Harness des Server-Benutzers." Geprüft war nur die eine Hälfte (kein `.claude` im Pfad). Die andere Hälfte — Anweisungen und Fähigkeiten werden **explizit und isoliert injiziert** — hätte den Alarm entkräftet. |
| **F7** | **Der Akteur, der niemandem gehört, fällt durch** | Das Team-Onboarding fehlte, weil niemand fragte: *Wer legt eigentlich ein Team an, und wie erlebt der Lead das?* Der Assistent hatte einen Besitzer (Paket 4), das Team hatte keinen. |
| **F8** | **Zahlen altern zwischen Messen und Schreiben** | Zeilennummern, Zählungen, Commit-Kürzel — in der Übergabe der Nachbar-Sitzung waren fünf Angaben schon beim Abgeben falsch. Prosa altert langsam, Ziffern schnell. |
| **F9** | **Semantische Zusage, wo eine strukturelle Prüfung möglich wäre** | Die Freigabe-Schleuse des Gedächtnisses lässt einen Befund „Ergänzung" **ohne Menschen** wirken — und verlässt sich darauf, dass der prüfende Agent das Wort richtig verwendet. Der Inhalt ist dabei unbegrenzt: ein Vorschlag, der eine Seite vollständig ersetzt, ist genauso „Ergänzung", wenn der Prüfende ihn so nennt. *(Befund der Gedächtnis-Sitzung, 30.07.2026 — dort als E33 vermerkt, nicht beschlossen.)* Verwandt, aus derselben Woche: Der Fork prüfte auf dem Werkzeug-Pfad die **Stimmigkeit** einer behaupteten Identität statt ihrer **Herkunft** — beides Fälle, in denen einer Beurteilung vertraut wurde, wo eine Eigenschaft messbar gewesen wäre. |

---

## 2. Die Definition: wann etwas **bau-fertig** ist

> **Ein Vorhaben ist bau-fertig, wenn keine dieser acht Fragen offen ist.**
> Solange eine offen ist, heißt die richtige Antwort nicht „fertig", sondern
> *„geprüft gegen A, B, C — offen ist X."*

1. **Akteure.** Hat **jeder** Akteur — jede Menschen-Rolle **und** jede Agenten-Art — auf
   jeder Fläche, die er berührt, einen definierten Weg? **Einschließlich des Falls
   „darf nicht"** (was sieht er, was passiert beim Versuch)?
2. **Lebenszyklus.** Ist **jede** Phase abgedeckt: entstehen · einrichten · benutzen ·
   ändern · scheitern · übergeben · beenden · abbauen? (Der häufigste blinde Fleck sind
   die letzten drei.)
3. **Governance je Fähigkeit.** Für **jede** Fähigkeit beantwortet: wer darf · wer sieht ·
   **wo ist der Einstellungs-Ort** · was wird protokolliert · wer nimmt ab?
4. **Versprechen.** Ist **jeder** Anspruch aus Vision, Marke und Zielbild entweder einem
   Paket zugeordnet — oder ausdrücklich terminiert bzw. begründet verworfen? „Nicht
   erwähnt" ist keine der drei Möglichkeiten.
   **Ein Versprechen kann halb zugeordnet sein** *(ergänzt 01.08.2026, aus zwei realen
   Funden)* — das ist der Zustand, der am leichtesten durchrutscht, weil die Zeile bereits
   ein Paket nennt:
   - **Zwei Hälften, eine erledigt.** „Bibliothek, aus der Bereiche freigeschaltet werden":
     die Auslieferungs-**Maschinerie** ist gebaut, der auszuliefernde **Inhalt** existiert
     nicht. Beide Zustände gehören **namentlich in dieselbe Zeile** — nicht in zwei Einträge,
     sonst trägt ein Anspruch zwei Kennungen und die nächste Durchsicht vergleicht Zusagen
     nicht mehr eins zu eins mit Register-Zeilen.
   - **Der Ort ist zugeordnet, das absolute Wort nicht.** „Der Orchestrator ist die
     **einzige** nötige Oberfläche": der Ort existiert, aber „einzige" ist eine Zusage, die
     **nur als Abnahmekriterium existieren kann** — entweder es gibt einen Prüfschritt, der
     einen Menschen ohne jede andere Fläche durchlaufen lässt, oder der Satz muss weg. Eine
     dritte Möglichkeit gibt es nicht. Alarmwörter: *einzige, jede, immer, ohne, vollständig,
     jederzeit, null.*
5. **Belege.** Ist **jede** Behauptung über die Plattform am Code belegt — **inklusive
   Gegenprobe** (was müsste falsch sein, wenn die Behauptung stimmt)?
6. **Fehlerfall.** Hat **jeder** Ablauf ein definiertes Verhalten bei Abbruch, Ausfall,
   Zeitüberschreitung und verschwundenem Akteur?
7. **Folgepflichten.** Erzeugt eine Entscheidung eine Pflicht (aufräumen, migrieren,
   überwachen, nachziehen)? Ist **diese Pflicht selbst geplant**? Eine Entscheidung mit
   verwaister Folgepflicht ist nicht fertig, sondern verschoben.
8. **Widerspruchsfreiheit.** Sagt kein Dokument etwas anderes als ein anderes — und kein
   Fließtext etwas anderes als der Warnkasten darüber?

---

## 3. Die drei Gegenproben — vor **jeder** Entscheidung

Kurz genug, um sie immer zu machen. Sie hätten F3, F4 und F5 verhindert.

- **G1 · Widerspruchsprobe.** Widerspricht diese Entscheidung einem Versprechen der Vision
  oder einer früheren Entscheidung? *(Konkret nachsehen, nicht erinnern.)*
- **G2 · Achsenprobe.** Presse ich hier zwei unabhängige Fragen in eine Antwort?
  **Test:** Kann ich mir einen realen Fall denken, in dem das eine gilt und das andere
  nicht? Dann sind es zwei Achsen und brauchen zwei Entscheidungen.
- **G3 · Folgepflichtprobe.** Was muss **danach** dauerhaft getan werden, damit diese
  Entscheidung trägt? Wer tut es? Ist das geplant — oder habe ich gerade eine Waise erzeugt?
- **G4 · Messbarkeitsprobe** *(gegen F9)*. Verlasse ich mich hier auf eine **Beurteilung**, wo
  eine **Eigenschaft** prüfbar wäre? **Test:** Ich nehme an, der Beurteilende irrt oder ist
  unterwandert — bleibt dann noch eine Schranke? Wenn nein, muss die Zusage strukturell werden.
  *Gilt besonders für alles, was ohne Menschen wirkt.*

---

## 4. Wo nachschauen — die Quellen-Rangfolge

Der Fehler F2 entsteht, wenn nur in der mittleren Ebene geprüft wird.

| Ebene | Quelle | Was sie beantwortet |
|---|---|---|
| **Auftrag** | Marken-Masterplan, Vision | Was hat der Inhaber überhaupt versprochen? |
| **Produktbild** | Zielbild-Artifact | Wie soll es sich anfühlen, wer darf was? |
| **Umsetzung** | Arbeitspaket-Plan + Ergänzungspläne | Wie wird es gebaut? |
| **Wahrheit** | Der Quellcode des Forks und der Plugins | Was kann die Plattform wirklich? |
| **Nachbarn** | Übergaben und Stände der Parallel-Sitzungen | Was baut gerade jemand anderes? |
| **Historie** | Projekt-Gedächtnis, Korrektur-Logs | Was wurde schon entschieden und warum? |
| **Zuständigkeit** | Rollen-/Sitzungs-Tabelle | Wer darf das überhaupt anfassen? |

**Regel:** Eine Vollständigkeits-Aussage ist nur so viel wert wie die **oberste** Ebene,
gegen die sie geprüft wurde. Wer nur „Umsetzung gegen Wahrheit" prüft, findet nie ein
vergessenes Versprechen.

---

## 5. Sprachregeln, die Selbstbetrug verhindern

Die Regeln stehen nach dem gruppiert, *worauf* sie sich richten: die eigene
Statusaussage · zitierte Zahlen und Kennungen · Belege · die Prüfung selbst.
Vorher war es eine flache Liste aus zwölf Punkten, an einem einzigen Tag um
sieben gewachsen — eine Regel auf Platz zwölf findet niemand.

### 5.1 Was man über den eigenen Stand sagen darf

- **„Fertig" ist verboten als Selbstauskunft.** Erlaubt ist: *„Geprüft gegen \<Quellen\> —
  offen ist \<Liste\>."* Wenn die Liste leer ist, sagt man **welche acht Fragen** geprüft
  wurden (Abschnitt 2).

- **Ein Warnkasten ersetzt keine Korrektur** (F1/F8). Wer „überholt" markiert, aber den
  Fließtext stehen lässt, hat die Arbeit nicht gemacht — nur den Ort markiert.

- **Eine Berichtigung wird selbst belegt.** Wer einen *gemeldeten* Fehler behebt, prüft ihn
  zuerst **selbst an der Quelle** — auch wenn der Melder gründlich wirkt. **Eine falsche
  Berichtigung ist schädlicher als der Fehler, den sie beheben soll:** Sie kommt mit dem
  Anschein der Prüfung und wird beim nächsten Mal nicht mehr hinterfragt.
  **Beleg statt Behauptung:** Am 31.07.2026 meldete die Beleg-Nachmessung 24 fehlerhafte
  Code-Verweise. **Zwei davon waren selbst falsch** — der ursprüngliche Text hatte recht.
  Sie wurden nur deshalb nicht eingebaut, weil der Berichtigungs-Auftrag diese Regel
  ausdrücklich enthielt. Ohne sie wären beim Beseitigen von Fehlern zwei neue entstanden.

---

### 5.2 Zahlen, Kennungen, Verweise — alles, was man zitiert

- **Zahlen werden beim Schreiben gemessen, nicht erinnert** (F8). Wo eine Zahl altert,
  gehört der Befehl daneben, mit dem der Leser sie selbst ermittelt.

- **Der danebenstehende Befehl muss der sein, der die Zahl erzeugt hat** (F8, verschärft
  01.08.2026). Real passiert: gemessen wurde mit einem gefilterten Aufruf, danebengeschrieben
  der ungefilterte — wer ihn nachtippt, bekommt eine andere Zahl, und der ganze Beleg wirkt
  falsch, obwohl seine Aussage trägt. **Prüfung vor dem Abschicken: den eigenen Befehl noch
  einmal so ausführen, wie er im Text steht.** Weicht das Ergebnis ab, ist nicht die Zahl das
  Problem, sondern die Formulierung — dann trennt man beide Zahlen („acht Treffer, davon null
  Schema-Objekte") statt die unbequeme wegzufiltern. Und wer diesen Fehler bei sich findet,
  prüft die **anderen** Zahlen desselben Tages nach: in einem Dokument wiegt er schwerer als
  in einer Nachricht.

- **Kennungen und Namen werden abgelesen, nicht erinnert** (F8, erweitert 01.08.2026 — eigener
  Fehler desselben Tages). Die Regel „Zahlen beim Schreiben messen" gilt genauso für
  **Commit-Kennungen, Dateinamen, Zeilennummern und Bezeichner**. **Real passiert:** In den
  Meldungen dieses Tages waren **drei von neun genannten Commit-Kennungen frei erfunden** —
  die Arbeit war echt und gepusht, die Kennungen nicht. Die Ursache ist exakt benennbar und
  deshalb lehrreich: Die sechs richtigen stammten aus Befehlen, deren Ausgabe mit
  `git log --oneline -1` **endete** — sie wurden abgelesen. Die drei falschen stammten aus
  Befehlen, die den Hash **nicht ausgaben** (`git show --stat --format=""`); dort hat das
  Gedächtnis die Lücke gefüllt, ohne dass es sich wie Raten anfühlte.
  **Praktische Folge: Wer eine Kennung nennen will, lässt sie sich vom Befehl ausgeben, der
  sie erzeugt** — `git commit … && git log --oneline -1`. Eine erfundene Kennung ist
  schlimmer als keine: Sie sieht prüfbar aus, und wer sie nachschlägt, findet nichts und
  zweifelt an der *Arbeit* statt an der Kennung.

- **Ein Verweis, den niemand ausführt, ist keiner** (Zielbild-Sitzung, 01.08.2026 — die
  brauchbarste Fassung des Tages). Am 01.08. sind **vier** Belege gerissen: die „15 Module"
  (Zirkel), eine Zusage, die der eigene Text widerlegte, verschobene Zeilenanker, und drei
  erfundene Commit-Kennungen. **Alle vier sahen beim Draufschauen aus wie Belege.** Der
  Unterschied zwischen einem Beleg und einem Verweis ist, dass man den einen **ausführen**
  kann — und `git cat-file -e <kennung>` kostet nichts.
  **Nur muss man ihn richtig zielen, sonst erfindet die Prüfung Leichen.** Beim Anwenden auf
  die eigenen Dokumente lieferte der erste Durchlauf zwei Treffer, **beide falsch**: `20260722`
  war ein Datum aus einem Ordnernamen, das ins Hexadezimal-Muster passte; `ac6ac66` war echt,
  lag aber im Repo `<modell-router>` statt in der Werkbank — geprüft wurde nur die
  Werkbank. Nach der Berichtigung: **null tote Verweise.** Das ist zugleich das dritte Beispiel
  desselben Tages dafür, dass die erste Fassung eines Prüfers lauter ist als die Wirklichkeit
  (→ „Prüfer erst gegen den Bestand halten, bevor man ihm glaubt"). Ein Verweis über
  Repo-Grenzen hinweg braucht das Repo dazu, sonst ist er auch dann unbrauchbar, wenn er lebt.
  **Es gibt zwei Wege zu erfundenen Leichen, und der zweite ist der gefährlichere**
  (Zielbild-Sitzung, 01.08.2026, an ihrem eigenen Lauf über 19 Kennungen in sieben Repos):
  Ein **falsch gebauter** Test meldet massenhaft und fällt sofort auf, weil bekannte
  Kennungen mitsterben. Ein **unvollständiges Repo-Verzeichnis** meldet **wenig** — und sieht
  dadurch glaubwürdig aus. Die Leichen liegen dann ausgerechnet in den Repos, an die niemand
  denkt; zwei davon wären beinahe an einer richtigen Stelle „korrigiert" worden. Deshalb:
  **die Repo-Liste belegen, nicht erinnern.**

### 5.3 Belege — vorhanden ist nicht dasselbe wie tragfähig

- **Beim Prüfen eines Belegs einen Schritt weitergehen — „Beleg vorhanden" ist nicht „Beleg
  trägt"** (ergänzt 01.08.2026; gefunden von der Zielbild-Sitzung, weitergereicht von der
  Marken-Sitzung). Zeigt die belegende Stelle auf das Dokument zurück, aus dem die Behauptung
  stammt, ist sie **kein Beleg, sondern ein Kreis**. **Real passiert:** Der Masterplan
  behauptete ein „Modulares Dashboard (**15 Module**)"; das Versprechen-Register führte den
  Anspruch und belegte ihn mit dem Masterplan; der Masterplan belegte ihn nirgends — die
  Modulnamen existierten nur in einem nicht versionierten Artifact. **Beide Seiten zeigten
  aufeinander, und der Anspruch hat zwei Vollständigkeits-Audits überlebt**, weil er an jeder
  einzelnen Stelle belegt aussah. Frage 5 (Abschnitt 2) deckt das *nicht* ab: Dort ging es
  darum, ob ein Beleg **existiert** — hier existierte er und trug trotzdem nicht.
  **Besonders gefährdet ist die oberste Quellen-Ebene** (Abschnitt 4): Sie wird per Rangfolge
  von allen anderen zitiert, hat aber selbst niemanden über sich, der sie belegt. Was sie
  behauptet, braucht deshalb einen Beleg **außerhalb** der Dokumentenkette — Code, Messung,
  oder eine ausdrückliche Inhaber-Entscheidung.
  **Die praktische Fassung** (Zielbild-Sitzung, 01.08.2026): **Zwei Belege sind nur dann zwei,
  wenn sie nicht voneinander abgeschrieben sind.** Umgekehrt gilt dasselbe und ist der Grund,
  warum sich das Melden zwischen Sitzungen lohnt: Zwei *unabhängig* erhobene Messungen tragen,
  auch wenn jede einzelne unvollständig ist. Am 01.08. hat genau das eine falsche Konvention
  gerettet — eine Sitzung hatte die Regel gemessen, eine andere unabhängig davon ihre
  Fallgruben; erst zusammen ergaben sie eine tragfähige Regel.

### 5.4 Gegenproben und Prüfwerkzeuge

- **Behauptung und Gegenprobe gehören zusammen** (F6). „X ist so" ohne „und das wäre
  anders, wenn Y" ist eine halbe Prüfung.
- **Eine Gegenprobe mit absichtlichem Rest muss ihn nennen** (Fork-Sitzung, 02.08.2026, an
  ihrem eigenen Fall). Wer einen alten Namen aus einem Repo entfernt und die Entfernung mit
  `grep … → keine Treffer` belegt, **danach** aber einen Berichtigungs-Kasten schreibt, der
  den alten Namen absichtlich wieder nennt, hat eine Zahl veröffentlicht, die **im selben
  Commit** falsch geworden ist. Sie war beim Messen wahr — gemessen wurde nur vor dem letzten
  Schreibvorgang. Das ist die kürzeste Alterung, die es gibt, und „beim Schreiben messen"
  schützt nicht davor; es braucht **nach** dem Schreiben. Richtige Form: *„keine Treffer
  außerhalb der Berichtigungs-Kästen (2 Treffer, beide dokumentierend)."*
  **Warum das mehr ist als Genauigkeit:** Ein unbenannter Rest wird vom nächsten Prüfer als
  Fehler gemeldet — und wer ihn dann „behebt", löscht die Berichtigung.

- **Die Gegenprobe muss die Aussage messen, nicht ihre Formulierung** (F6, ergänzt
  01.08.2026 — gemeldet von der Marken-Sitzung an ihrem eigenen Fall). Wer eine **Aussage**
  streicht, sucht danach mit einem Muster, das die **Aussage** trifft — nicht mit den Wörtern,
  die zufällig in der gestrichenen Fassung standen. Sonst misst die Gegenprobe die eigene
  Suchmaske. **Real passiert:** Die Zusage „nichts Wirksames ohne menschliches Go" wurde an
  fünf Stellen gestrichen, Gegenprobe `grep "nichts Wirksames\|menschliches Go"` → kein
  Treffer, gemeldet als erledigt. Dieselbe Zusage stand weiter in §1.1 als **„Wirkung nur mit
  Go"**, markiert als `[IST]` — keine der gesuchten Zeichenketten kommt darin vor. Ein
  Aussage-Muster findet sie sofort:
  ```bash
  grep -rniE '(wirkung|wirksam|unumkehrbar)[^.|]{0,60}(go|freigabe|abnahme|mensch)'
  ```
  **Warum das die gefährlichste Form von F6 ist:** Sie kommt mit einem ausgeführten Befehl
  und einer Null daneben — und sieht dadurch **gründlicher aus als eine Prüfung, die gar nicht
  stattgefunden hat**.

- **Eine Prüfung, deren Bestehen sich als leere Ausgabe zeigt, ist von einer nicht
  ausgeführten Prüfung nicht zu unterscheiden** (F6, ergänzt 01.08.2026 — Marken-Sitzung,
  an ihrem eigenen Fall). **Real passiert:** Eine Commit-Kennung wurde vor dem Weitergeben
  geprüft, mit `git log --oneline -1 <kennung> 2>/dev/null`. Das `2>/dev/null` verschluckte
  das `fatal:`; übrig blieb **eine leere Zeile**, direkt gefolgt von einer `grep`-Ausgabe,
  die den *Inhalt* bestätigte. Die Inhalts-Bestätigung wurde als Kennungs-Bestätigung
  gelesen. **Nachgemessen: Der Rückgabewert war 128** — die Antwort war da, nur nicht
  sichtbar. Der Fehler sitzt also nicht in der Shell, sondern im **Lesen**: Wer die Ausgabe
  ansieht statt des Rückgabewerts, sieht Schweigen und hält es für Erfolg. Deshalb:
  **stderr bei Prüfbefehlen nicht unterdrücken**, und einen Befehl wählen, der bei Erfolg
  **positiv** antwortet (`git log -1 --format='%h %s' <kennung>`).
  **Das gilt für Werkzeuge genauso wie für Menschen** — und dort schwerer, weil es sich
  wiederholt: `eigenbau-ungesichert.js` bildete anfangs *jeden* git-Fehler auf „nicht
  ignoriert", also auf „ist gesichert, alles gut" ab. Aus einem Nicht-Repo aufgerufen meldete
  er „Kein ungesicherter Eigenbau", Rückgabe 0. Behoben: „nicht prüfbar" ist jetzt ein
  **eigener** Ausgang (Rückgabe 2), getrennt von „nichts gefunden" (0) und „etwas gefunden"
  (1). **Ein Prüfwerkzeug braucht drei Antworten, nicht zwei** — wer nur ja/nein kennt, muss
  seinen eigenen Ausfall als eine davon ausgeben, und es wird immer die beruhigende.
  **Der Einzeiler, den hier alle täglich tippen, hat genau diesen Fehler** (Marken-Sitzung,
  01.08.2026, an ihren eigenen acht Gegenproben desselben Tages):
  `grep -rn "…" <datei> || echo "KEIN lebender Treffer"` meldet dieselbe Entwarnung, wenn
  die **Datei gar nicht existiert** — `grep` schreibt nach stderr, gibt nichts aus und endet
  mit 1, also feuert `||`. Nachgemessen, beides. In einer Pipeline ist es schlimmer: Der
  Rückgabewert kommt vom **letzten** Glied, ein Tippfehler im ersten bleibt unsichtbar.
  Robuste Form — erst die Prüfgegenstände feststellen, dann **positiv als Zahl** ausgeben,
  damit „0" und „Datei fehlt" unterscheidbar sind:
  ```bash
  for f in <dateien>; do [ -f "$f" ] || { echo "FEHLT: $f"; exit 2; }; done
  echo "lebende Treffer: $(grep -rniE '<muster>' <dateien> | grep -cvE '<ausnahmen>')"
  ```
  Ihre acht Meldungen waren **trotzdem richtig** — nachgeprüft. Aber richtig, ohne dass die
  Methode das belegt hätte, und das ist der Fall, gegen den diese Regel geschrieben ist.

- **Ein Prüfer ohne bekannt-guten Fall kann nicht zeigen, dass er funktioniert**
  (Zielbild-Sitzung, 01.08.2026). Dort war es Zufall: Der erste Lauf erklärte ihren **eigenen
  Commit von vor einer Stunde** für nicht existent — daran war zu sehen, dass das Werkzeug
  kaputt war und nicht die Doku. **Als Absicht gebaut** heißt: Neben die Messung gehören ein
  bis zwei Fälle, deren Antwort feststeht, und das Werkzeug prüft sie **vor** jeder Messung.
  **Warum das keine Zierde ist:** Eine Erkennung bricht selten symmetrisch. `eigenbau-ungesichert.js`
  hängt an einer Pfad-Abbildung — bricht sie in die eine Richtung, gilt alles als Eigenbau
  (laut, fällt auf); bricht sie in die andere, gilt alles als Fremdmaterial, der Befund lautet
  **„0 Eigenbauten, alles sauber"**, und niemand merkt etwas. Genau dieser Bruch, absichtlich
  herbeigeführt, wird jetzt gefangen: `.claude/rules/ecc/common/testing.md wurde als "eigen"
  eingestuft, erwartet war "fremd"` → Rückgabe 2. **Die stille Richtung ist immer die, die
  entwarnt** — deshalb muss der bekannt-gute Fall sie abdecken, nicht die laute.

## 6. Die zwei Workflows — prüfen und einarbeiten

Die Regeln oben sind als **zwei** Workflows ausführbar (beide im Werkbank-Repo, versioniert;
Aufruf über das Workflow-Werkzeug mit `{scriptPath: "…"}`):

| Workflow | Zweck | Bauart |
|---|---|---|
| `docs/workflows/vollstaendigkeits-audit.js` | **Finden.** Inventur → sechs Matrizen → adversarische Gegenprüfung. | parallel, weil die Matrizen unabhängig sind |
| `docs/workflows/audit-einarbeitung.js` | **Einarbeiten.** Sieben Themen + Nachlese gegen halbe Einarbeitung. | **bewusst sequenziell** — die Funde überlappen quer über die Plan-Dokumente; parallele Agenten würden sich überschreiben |

Die zwei laufen **abwechselnd, bis die Matrizen leer bleiben** — ein einzelner Durchlauf
beweist nichts, weil die Einarbeitung selbst neue Lücken erzeugen kann (G3).

**Wie er arbeitet — das ist der Unterschied zu einem normalen Audit:**

1. **Inventur (parallel):** Er erfasst erst **Akteure** (Menschen-Rollen, Agenten-Arten,
   nicht-menschliche Aufrufer), **Lebenszyklen** (jedes Kern-Objekt × acht Phasen),
   **Fähigkeiten** und **Versprechen** (aus Auftrag und Produktbild).
2. **Matrizen (parallel):** Aus den Inventaren spannt er sechs Matrizen auf und prüft
   **jede leere Zelle als Verdacht** — Akteur × Fläche · Objekt × Phase ·
   Fähigkeit × Governance-Feld · Versprechen × Zuordnung · Entscheidung × drei Gegenproben ·
   Widersprüche und Belege. *Nicht Dokumente lesen und hoffen, dass etwas auffällt.*
3. **Gegenprüfung:** Jeder schwere Fund wird einzeln adversarisch angegriffen — wer eine
   Lücke meldet, die es nicht gibt, kostet so viel wie wer eine übersieht.

Jeder Fund nennt zusätzlich, **welches Fehlermuster F1–F8 ihn erklärt** — damit die
Muster-Liste oben mit der Zeit schärfer wird statt zu verstauben.

**Wann geprüft wird:** vor jeder „bau-bereit"-Aussage · nach jeder größeren Ergänzung ·
vor jeder Übergabe an eine andere Sitzung.

---

## 7. Verankerung im Harness

Die operative Kurzfassung liegt als Regel neben den zehn bestehenden ECC-Regeln und wird
dadurch **in jeder Session dieses Workspace automatisch geladen** (Tree-Walk über `.claude/`):

```
.claude/rules/ecc/common/vollstaendigkeit.md
```

`.claude/` ist per `.gitignore` ausgenommen (Fremd-Klon plus benutzerabhängiger Inhalt).
Damit die Regel einen Neuklon überlebt, ist **genau diese eine Datei** erzwungen versioniert:

```bash
git add -f .claude/rules/ecc/common/vollstaendigkeit.md
```

**Arbeitsteilung der beiden Dateien:** Dieses Dokument trägt die Beweislage und die
Begründung — die Harness-Regel trägt nur das, was beim Arbeiten wirken muss (Sprachregel,
acht Fragen, drei Gegenproben, Quellen-Rangfolge, Werkzeug-Verweise). Wer eine Regel ändert,
ändert **beide**; die Kurzfassung darf nie mehr behaupten als die Langfassung belegt.
