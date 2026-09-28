---
name: ui-bedienbarkeit
description: Vor dem Bau oder Umbau einer Oberflaeche laden. Harter, belegter Regelsatz (12 Regeln mit Zahlen), 15-Punkte-Pruefliste, Messskript und Listenmuster (Filter, Auswahl, Sammelaktionen, Aufklappen, Vorschau, Rueckgaengig), damit eine Seite ohne Anleitung bedienbar ist und das Ergebnis reproduzierbar bleibt. Entstanden 09.09.2026 aus dem Umbau des Accountability-Dashboards.
---

# UI-Bedienbarkeit — erst Regeln, dann bauen, dann messen

Dieser Skill wird VOR dem ersten Strich geladen, nicht danach. Er ersetzt Geschmack durch
Zahlen. Jede Regel hat zwei unabhaengige Belege (Liste unten); "das sieht gut aus" ist kein
Argument, "13 px, 4,5:1, 44 px" sind Argumente.

## Ablauf (in dieser Reihenfolge)

1. **Auftrag in einen Satz:** Wer benutzt die Seite, welche EINE Handlung soll er ohne
   Anleitung schaffen? Steht das nicht im Auftrag, fragen, nicht raten.
2. **Bestand messen:** Vor jedem Umbau die bestehende Seite mit dem Messskript (unten) und der
   Pruefliste durchgehen. Die Zahlen sind der Ausgangspunkt der Meldung an den Owner.
3. **Schriftsystem festlegen:** genau drei Groessen als Tokens (Titel, Text, Kleingedrucktes),
   Hierarchie darueber hinaus nur durch Gewicht, Farbe und Abstand. Keine Grossbuchstaben-
   Etiketten (Eyebrows), keine Mono-Kleinschrift als Dekor.
4. **Seite skizzieren als Liste von Abschnitten:** je Abschnitt Name (2 bis 4 Woerter), die eine
   Handlung, das Ergebnis. Alles Erklaerende wandert in ein aufklappbares "Wie das funktioniert".
   Was keinen Platz in dieser Liste findet, wird gestrichen, nicht versteckt.
5. **Bauen** nach den 12 Regeln; Listen nach den Listenmustern; Zustaende nach Stand einblenden
   (Progressive Disclosure), nicht alles auf einmal.
6. **Messen, nicht ansehen:** Messskript auf jeder Ansicht laufen lassen; Ziel: hoechstens
   3 Groessen + Titel, kein Text unter 12 px, kein Bedienelement unter 24 px, keine Grossbuchstaben,
   unter 30 Woerter bis zur ersten Handlung. Screenshot je Ansicht ansehen, wie ein Nutzer.
7. **Owner klickt live.** Screenshots sind Beleg fuer den Agenten, nicht Abnahme.

## Die 12 Regeln mit Zahl

1. Fliesstext >= 16 px; kein Text unter 12 px (Kleingedrucktes 13 px).
2. Hoechstens drei Schriftgroessen je Ansicht plus eine Titelgroesse.
3. Zeilenlaenge 45 bis 75 Zeichen, nie ueber 80 (max-width 70ch fuer Fliesstext).
4. Klickziele >= 24 x 24 px Pflicht, Knoepfe und Reiter 44 px hoch, >= 8 px Abstand.
5. Kontrast Text 4,5:1; grosse Schrift und Raender von Bedienelementen 3:1 (rechnen, nicht schaetzen).
6. Genau einmal: eine H1 je Seite, eine hervorgehobene Handlung je Abschnitt, keine Aussage zweimal.
7. Erklaertext nur auf Abruf, hoechstens zwei Ebenen tief.
8. Die Haelfte der Woerter streichen, dann nochmal die Haelfte; kein Satz ueber 25 Woerter.
9. Rueckmeldung unter 1 s; ab 10 s Fortschrittsanzeige mit Zahl ("12 von 600").
10. Rueckgaengig statt Bestaetigungsdialog bei umkehrbaren Aktionen; Dialog nur bei Unumkehrbarem.
11. Navigation sichtbar ausgeschrieben, hoechstens vier Reiter, 1 bis 2 Woerter, genau einer aktiv
    mit zwei Aktiv-Merkmalen (Fuellung + aria-current), in Textgroesse und dunkel.
12. Listen ab ~15 Eintraegen brauchen Suche und Filter; Sammelaktionen ueber eine Auswahl-Leiste, die
    erst ab einem gewaehlten Eintrag erscheint und die Zahl nennt ("2 von 89 ausgewaehlt").

## Listenmuster (aus Inbox Zero, Gmail, Clean Email; Belege unten)

- Zeile: Kaestchen, Name fett, Meta klein (Adresse, Anzahl, Prozent gelesen, Link), rechts EIN Knopf
  "Aendern", darunter eine Zeile, was passieren wird. Details klappen in der Zeile auf, kein Modal.
- Filter als sichtbare Knoepfe mit Zaehlern ("Alle 89", "Abmelden 48"); ein Suchfeld daneben.
- "Alle N auswaehlen" ueber der Liste; Sammelleiste (dunkel, klebend) nur bei Auswahl, mit denselben
  Handlungen wie in der Zeile plus "Auswahl aufheben".
- Vorschau vor Ausfuehrung als Tabelle mit Zahlen; ein Knopf "Jetzt ..." mit einer Bestaetigung nur,
  wenn Tausende Objekte bewegt werden; danach ein sichtbarer Knopf "Rueckgaengig machen".
- Lange Listen: 60 Zeilen, dann "Alle N anzeigen". Fortschritt bei langen Laeufen mit Zahl.
- Was weggelassen wird: Tabellen mit sechs Spalten, Statuskaesten, die den Kopf wiederholen,
  Erklaerabsaetze vor dem ersten Knopf, Kaesten in Kaesten.

## Pruefliste (15 Fragen, fuenf Minuten)

1. Sind alle Hauptbereiche als ausgeschriebene Beschriftungen ohne Klick sichtbar?
2. Hoechstens vier verschiedene Schriftgroessen auf dem Bildschirm?
3. Kleinster Text >= 12 px, Fliesstext >= 16 px?
4. Laengste Textzeile <= 80 Zeichen?
5. Weniger als 30 Woerter bis zur ersten anklickbaren Handlung?
6. Steht jede Aussage genau einmal (Titel, Untertitel, Kartenkopf verschieden)?
7. Je Abschnitt genau eine hervorgehobene primaere Handlung?
8. Genau eine H1 je Seite?
9. Kontrast Text 4,5:1 und Raender 3:1 gerechnet?
10. Jedes Klickziel >= 24 x 24 px mit >= 8 px Abstand?
11. Jede Aktion binnen 1 s Rueckmeldung, ab 10 s Fortschritt mit Zahl?
12. Jede umkehrbare Aktion mit Rueckgaengig statt Bestaetigungsdialog?
13. Nennt jede Fehlermeldung Problem und Loesung in Klartext?
14. Zeigt jeder leere Zustand einen Satz und genau eine Handlung?
15. Heisst dieselbe Sache ueberall gleich?

## Messskript (Browser-Konsole oder javascript_tool, Wurzel anpassen)

```js
const root = document.querySelector('.aa'); // Wurzel der Ansicht
const vis = (e) => e.checkVisibility();
const textEls = [...root.querySelectorAll('*')].filter(e => vis(e) && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
const sizes = new Map(); for (const e of textEls) { const s = parseFloat(getComputedStyle(e).fontSize); sizes.set(s, (sizes.get(s) || 0) + 1); }
const targets = [...root.querySelectorAll('button, input, select')].filter(vis);
const small = targets.filter(e => { const b = e.getBoundingClientRect(); return b.height < 24 || b.width < 24; }).length;
const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT); let words = 0, node;
while ((node = walker.nextNode())) { if (node.nodeType === 1 && ['BUTTON', 'A'].includes(node.tagName) && vis(node)) break; if (node.nodeType === 3 && vis(node.parentElement)) words += node.textContent.trim().split(/\s+/).filter(Boolean).length; }
// Felder: ihr Wert ist kein Textknoten -- Schrift des Feldwerts und Kontrast des Feldrands (gegen Feldfuellung und Umgebung) eigens.
const rgb = (v) => { const m = v.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
const lum = ({ r, g, b }) => [r, g, b].map(v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
const fill = (e) => { for (let el = e; el; el = el.parentElement) { const c = rgb(getComputedStyle(el).backgroundColor); if (c && c.a > 0.5) return c; } return { r: 255, g: 255, b: 255 }; };
const fields = [...root.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea')].filter(vis).map(e => { const st = getComputedStyle(e); const line = rgb(st.borderTopColor); const width = parseFloat(st.borderTopWidth); return { field: e.getAttribute('aria-label') || e.name || e.placeholder || e.tagName.toLowerCase(), valuePx: parseFloat(st.fontSize), border: width > 0 && line ? Math.round(Math.min(ratio(line, fill(e)), ratio(line, fill(e.parentElement))) * 100) / 100 : 0 }; });
({ sizes: [...sizes.entries()].sort((a, b) => a[0] - b[0]), h1: root.querySelectorAll('h1').length, wordsBeforeFirstAction: words, smallControls: small, uppercase: textEls.filter(e => getComputedStyle(e).textTransform === 'uppercase').length,
   fieldValuePx: [...new Set(fields.map(f => f.valuePx))].sort((a, b) => a - b), fieldTextBelow12: fields.filter(f => f.valuePx < 12).length, fieldBorderBelow3: fields.filter(f => f.border < 3).map(f => `${f.field}: ${f.border}`) });
```

Feldwerte zaehlen zu den Schriftgroessen der Ansicht (`fieldValuePx` zu `sizes` legen); ein Feldrand ohne Rahmen (`border: 0`)
braucht eine andere Kante mit 3:1 (Fuellung gegen Umgebung), sonst ist er ein Befund.

Kontrast rechnen (WCAG-Formel, Python): Luminanz je Kanal `c/12.92` bzw. `((c+0.055)/1.055)^2.4`,
`L = 0.2126 R + 0.7152 G + 0.0722 B`, Verhaeltnis `(L1+0.05)/(L2+0.05)`. Beispiel aus dem Bau:
`#70736a` auf `#f1eee6` = 4,16 (durchgefallen), `#5f625a` = 5,36 (bestanden).

## Was als Quelltext-Test erzwungen wird

Ein Test liest die Stylesheet- und Komponentendateien: alle `font-size` nur aus den drei Tokens,
kein `text-transform:uppercase`, Reiter in Textgroesse und dunkel, keine Eyebrow-Klasse, genau eine
H1, je Ansicht ein `details` fuer Erklaerungen, alte Ueberschriften-Texte verboten. Vorlage:
`test-harness/dashboard/test/accountability-ui-rules.test.ts`.

## Belege (je Regel zwei; Volltext in docs/packages/new-harness-dashboard-ux/evidence/)

- NN/g: Principles of Visual Design (2 bis 3 Schriftgroessen), Progressive Disclosure (max. 2 Ebenen),
  Confirmation Dialog und User Control (Undo), Response Times (0,1 s / 1 s / 10 s), Hamburger-Studien
  (versteckte Navigation -20 % Auffindbarkeit), Tabs Used Right, Dropdown List (~15 Eintraege),
  Bulk Actions, Empty State, Aesthetic Minimalist Design, Vague Prototyping (KI-Fehler).
- WCAG 2.2: 1.4.3 (4,5:1), 1.4.11 (3:1), 1.4.8 (80 Zeichen), 2.5.8 (24 px), 2.5.5 (44 px).
- GOV.UK Design System: Type Scale (19/16 px), Button (eine primaere Handlung), Error Message,
  Service Manual (25 Woerter je Satz). HMRC Page Heading (eine H1).
- Apple design/tips (44 pt), Android Accessibility (48 dp), Material 3 Tabs (hoechstens vier).
- Atlassian Typography (16 px / 12 px), Primer Responsive (24/44 px), Blankslate (eine Handlung),
  shopify.dev Index Table (Suche, Filter, Sammelaktionen).
- Krug, Don't Make Me Think, Kap. 5 (Haelfte der Woerter). Laws of UX (Doherty 400 ms).
- Inbox Zero (github.com/elie222/inbox-zero, bulk-unsubscribe): 4 Spalten, Sammelleiste nur bei
  Auswahl mit "N of M selected", Vorschau vor Ausfuehrung, "X of N completed". Gmail-Hilfe: Undo
  5 bis 30 s, "Abos verwalten".

Nicht belegt (nicht behaupten): "hoechstens drei Schriftgroessen" als Norm (NN/g sagt 2 bis 3,
GOV.UK und Material nennen keine Hoechstzahl); "16 px Mindest-Fliesstext" nur in Sekundaerquellen.
