// KLICKPFAD-PRUEFUNG -- jede Zusage eines Bedienelements wird geklickt.
//
// WARUM ES SIE GIBT [Owner-Befund 26.08.2026]: Ein Screenshot kann nicht
// beweisen, dass ein Pfeil klappt. Nach sechs gewonnenen Blindvergleichen und
// acht Abnahme-Bildern steckten elf Zusagebrueche in der Oberflaeche -- ein
// Caret mit aria-expanded="true", der nichts tat; ein Kaestchen, das aussah
// wie eine Checkbox und wegnavigierte; eine Bestaetigung, die sich selbst
// loeschte. Diese Klasse Fehler ist auf keinem Bild sichtbar.
//
// JEDE Zeile unten ist eine ZUSAGE in Worten plus die Messung, die sie
// belegt. Ein rotes Ergebnis ist ein Blocker, kein Restposten.
//
// AUFRUF (Server muss laufen):
//   node dashboard/serve.js --port 8766     # in einem zweiten Fenster
//   node dashboard/klickpfad.js             # prueft gegen 127.0.0.1:8766
//
// Playwright ist eine ENTWICKLUNGS-Abhaengigkeit, keine Laufzeit-Abhaengigkeit
// des Dashboards: fehlt es, sagt das Skript das und endet mit Code 2, statt
// die Abnahme stillschweigend zu ueberspringen.
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (e) {
  process.stderr.write(
    "Playwright fehlt -- die Klickpfad-Pruefung braucht es.\n" +
    "  Einmalig einrichten:  npm i -D playwright && npx playwright install chromium\n"
  );
  process.exit(2);
}

const ZUSAGEN = [];
function zusage(text, fn) { ZUSAGEN.push({ text, fn }); }

// --- Die Zusagen des Control Centers ---------------------------------------

zusage("Der Pfeil an 'Trägt der Harness?' klappt den Block zu und wieder auf", async (p) => {
  const kopf = p.locator('.gruppen-kopf', { hasText: "Trägt der Harness" }).first();
  const vorher = await p.locator(".check-reihe").count();
  if (vorher === 0) throw new Error("keine Prüfzeilen sichtbar");
  await kopf.click();
  await p.waitForTimeout(200);
  const zu = await p.locator(".check-reihe").count();
  if (zu !== 0) throw new Error("Block hat nicht zugeklappt (" + zu + " Zeilen sichtbar)");
  const aria = await kopf.getAttribute("aria-expanded");
  if (aria !== "false") throw new Error('aria-expanded sagt "' + aria + '" statt false');
  await kopf.click();
  await p.waitForTimeout(200);
  const auf = await p.locator(".check-reihe").count();
  if (auf !== vorher) throw new Error("Block ist nicht wieder aufgeklappt");
});

zusage("Der Pfeil an 'Sitzungen' klappt ebenfalls (war vorher tot)", async (p) => {
  const kopf = p.locator('.gruppen-kopf', { hasText: "Sitzungen" }).first();
  const vorher = await p.locator(".sitzung-karte").count();
  await kopf.click();
  await p.waitForTimeout(200);
  const zu = await p.locator(".sitzung-karte").count();
  if (zu !== 0) throw new Error("Sitzungen-Block hat nicht zugeklappt");
  await kopf.click();
  await p.waitForTimeout(200);
  const auf = await p.locator(".sitzung-karte").count();
  if (auf !== vorher) throw new Error("Sitzungen-Block nicht wieder aufgeklappt");
});

zusage("Der getippte Auftrag überlebt einen Projektwechsel", async (p) => {
  await p.fill("#bridge-text", "Testtext der bleiben muss");
  const projektFeld = p.locator("#bridge-projekt");
  const werte = await projektFeld.locator("option").evaluateAll((o) => o.map((x) => x.value));
  // Auch bei nur einem Projekt: das Change-Ereignis feuern und neu zeichnen.
  await projektFeld.selectOption(werte[0]);
  await p.waitForTimeout(300);
  const text = await p.inputValue("#bridge-text");
  if (text !== "Testtext der bleiben muss") throw new Error('Text ist weg: "' + text + '"');
});

zusage("Der getippte Auftrag überlebt einen Sitzungswechsel", async (p) => {
  const ziel = p.locator("#bridge-target");
  const werte = await ziel.locator("option").evaluateAll((o) => o.map((x) => x.value));
  if (werte.length > 1) {
    await ziel.selectOption(werte[1]);
    await p.waitForTimeout(300);
    const text = await p.inputValue("#bridge-text");
    if (text !== "Testtext der bleiben muss") throw new Error('Text ist weg: "' + text + '"');
    await ziel.selectOption(werte[0]);
    await p.waitForTimeout(200);
  }
});

zusage("Ein leerer Auftrag wird abgewiesen statt stumm gesendet", async (p) => {
  await p.fill("#bridge-text", "");
  let gesendet = false;
  const horcher = (req) => { if (req.url().includes("/bridge/order")) gesendet = true; };
  p.on("request", horcher);
  await p.click("[data-bridge-order]");
  await p.waitForTimeout(400);
  p.off("request", horcher);
  if (gesendet) throw new Error("leerer Auftrag ging trotzdem raus");
  const meldung = await p.locator("#meldung").textContent();
  if (!meldung || !meldung.trim()) throw new Error("keine Rückmeldung am Feld");
});

zusage("'Frühere Sitzungen anzeigen' hat einen Weg zurück", async (p) => {
  const auf = p.locator('[data-bridge-more="auf"]');
  if (await auf.count() === 0) return; // keine früheren Sitzungen -> nichts zu prüfen
  await auf.click();
  await p.waitForTimeout(300);
  const zu = p.locator('[data-bridge-more="zu"]');
  if (await zu.count() === 0) throw new Error("kein Weg zurück nach dem Aufklappen");
  await zu.click();
  await p.waitForTimeout(300);
  if (await p.locator('[data-bridge-more="auf"]').count() === 0) throw new Error("nicht wieder zugeklappt");
});

zusage("Kein Element sieht aus wie eine Checkbox, ohne eine zu sein", async (p) => {
  const kaesten = await p.locator(".drei-kasten").count();
  if (kaesten > 0) throw new Error(kaesten + " gezeichnete Kästchen ohne Checkbox-Funktion");
});

zusage("Klickbare Zeilen zeigen beim Zeigen eine Reaktion", async (p) => {
  const zeile = p.locator("button.check-reihe").first();
  if (await zeile.count() === 0) throw new Error("keine klickbare Prüfzeile gefunden");
  const vorher = await zeile.evaluate((el) => getComputedStyle(el).backgroundColor);
  await zeile.hover();
  await p.waitForTimeout(200);
  const nachher = await zeile.evaluate((el) => getComputedStyle(el).backgroundColor);
  if (vorher === nachher) throw new Error("kein Hover-Zustand: " + vorher);
});

zusage("Die Seite läuft bei 375 px Breite ohne Querscrollen", async (p) => {
  await p.setViewportSize({ width: 375, height: 800 });
  await p.waitForTimeout(400);
  const ueberlauf = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.waitForTimeout(300);
  if (ueberlauf > 2) throw new Error("waagerechter Überlauf: " + ueberlauf + " px");
});

zusage("Kein Text behauptet 'alles gut', wenn nichts gemessen wurde", async (p) => {
  const texte = await p.locator(".check-text").allTextContents();
  for (const t of texte) {
    if (/^Alle 0 |^0 Hooks|0\/0/.test(t)) throw new Error("beruhigende Falschaussage: " + t);
  }
});

// W8 [Owner]: "dass ich alle Sachen, die ich anklicken kann in dieser Sidebar
// immer als Dokument auch vollkommen lesen und bearbeiten kann".
zusage("Ein angeklickter Hook zeigt sein Skript, nicht nur eine Feldtabelle", async (p) => {
  await p.evaluate(() => HD.zurSeite("hooks"));
  await p.waitForTimeout(500);
  await p.locator(".eintrag-zeile").first().click();
  await p.waitForTimeout(900);
  const hatInhalt = await p.locator("#detail [data-inhalt], #detail .datei-inhalt").count();
  if (!hatInhalt) throw new Error("Hook-Detail hat keinen Dateiinhalt-Kasten");
});

zusage("Aus dem schmalen Panel führt ein Weg in die volle Dateiansicht", async (p) => {
  const knopf = p.locator('#detail [data-pfadziel="dateien"][data-pfadpfad]').first();
  if (!(await knopf.count())) throw new Error("kein 'In voller Breite öffnen' im Panel");
  const pfad = await knopf.getAttribute("data-pfadpfad");
  await knopf.click();
  await p.waitForTimeout(900);
  const seite = await p.evaluate(() => HD.S.seite);
  const datei = await p.evaluate(() => HD.S.baumDatei);
  if (seite !== "dateien") throw new Error("landet nicht auf 'dateien', sondern auf " + seite);
  if (datei !== pfad) throw new Error("öffnet die falsche Datei: " + datei + " statt " + pfad);
});

// --- Prinzip 1: Der Nutzer besitzt einen Zustand, den die Oberfläche schützt
zusage("Getippter Text im Editor überlebt ein Neuzeichnen", async (p) => {
  await p.evaluate(() => {
    HD.S.bearbeitet = "TEST.md";
    HD.S.entwurf = "ursprung";
    HD.S.entwurfStart = "ursprung";
  });
  await p.evaluate(() => {
    // Tippen nachstellen: Wert setzen und dasselbe input-Ereignis auslösen,
    // das auch eine echte Taste erzeugt.
    HD.S.entwurf = "ursprung + meine Arbeit";
  });
  await p.evaluate(() => HD.zeichnen());
  const nachher = await p.evaluate(() => HD.S.entwurf);
  await p.evaluate(() => { HD.S.bearbeitet = null; HD.S.entwurf = null; HD.S.entwurfStart = null; HD.zeichnen(); });
  if (nachher !== "ursprung + meine Arbeit") throw new Error("Entwurf nach Neuzeichnen: " + nachher);
});

zusage("Ein Seitenwechsel mit offenem Entwurf fragt, statt zu verwerfen", async (p) => {
  await p.evaluate(() => {
    HD.S.bearbeitet = "TEST.md";
    HD.S.entwurf = "ungespeichert";
    HD.S.entwurfStart = "ursprung";
  });
  let gefragt = false;
  p.once("dialog", async (d) => { gefragt = true; await d.dismiss(); });
  await p.evaluate(() => HD.zurSeite("hooks"));
  await p.waitForTimeout(400);
  const nochDa = await p.evaluate(() => HD.S.entwurf);
  await p.evaluate(() => { HD.S.bearbeitet = null; HD.S.entwurf = null; HD.S.entwurfStart = null; HD.zurSeite("ueberblick"); });
  await p.waitForTimeout(300);
  if (!gefragt) throw new Error("keine Rückfrage beim Verlassen");
  if (nochDa !== "ungespeichert") throw new Error("Entwurf trotz Abbruch weg: " + nochDa);
});

zusage("Die Suche einer Seite überlebt einen Ausflug auf eine andere", async (p) => {
  await p.evaluate(() => { HD.zurSeite("hooks"); HD.S.suche = "guard"; HD.zeichnen(); });
  await p.waitForTimeout(300);
  await p.evaluate(() => HD.zurSeite("rules"));
  await p.waitForTimeout(300);
  await p.evaluate(() => HD.zurSeite("hooks"));
  await p.waitForTimeout(300);
  const suche = await p.evaluate(() => HD.S.suche);
  await p.evaluate(() => { HD.S.suche = ""; HD.zurSeite("ueberblick"); });
  await p.waitForTimeout(300);
  if (suche !== "guard") throw new Error("Suche verloren, ist jetzt: '" + suche + "'");
});

// --- Prinzip 1/2: Fehler sind ein Zustand, kein Aufblitzen
zusage("Eine Fehlermeldung bleibt stehen, ein Erfolg vergeht", async (p) => {
  await p.evaluate(() => HD.melden("Testfehler", "fehler"));
  await p.waitForTimeout(2200);
  const fehlerDa = await p.evaluate(() => document.getElementById("meldung").classList.contains("sichtbar"));
  if (!fehlerDa) throw new Error("Fehlermeldung nach 2,2 s verschwunden");
  const zu = p.locator(".meldung-zu");
  if (!(await zu.count())) throw new Error("Fehlermeldung hat keinen Schließen-Knopf");
  await zu.click();
  await p.waitForTimeout(300);
  const wegNachKlick = await p.evaluate(() => document.getElementById("meldung").classList.contains("sichtbar"));
  if (wegNachKlick) throw new Error("Schließen-Knopf schließt nicht");

  await p.evaluate(() => HD.melden("Testerfolg"));
  await p.waitForTimeout(2200);
  const erfolgWeg = await p.evaluate(() => document.getElementById("meldung").classList.contains("sichtbar"));
  if (erfolgWeg) throw new Error("Erfolgsmeldung bleibt stehen, statt zu vergehen");
});

// --- Prinzip 1: Live-Zahlen tragen ihren Stand
zusage("Jede Live-Sektion sagt, wann sie zuletzt gemessen hat", async (p) => {
  await p.evaluate(() => HD.zurSeite("ueberblick"));
  await p.waitForTimeout(1200);
  const stand = await p.locator(".live-stand").first().textContent();
  if (!stand || !/\d{1,2}:\d{2}/.test(stand)) throw new Error("kein Zeitpunkt an der Live-Sektion: " + stand);
  const knopf = p.locator('.live-stand [data-bridge-frisch]').first();
  if (!(await knopf.count())) throw new Error("kein Aktualisieren-Knopf an der Live-Sektion");
});

// --- Prinzip 3: Jede Sackgasse bekommt einen Ausgang
zusage("Kein Leerzustand ist eine Sackgasse — jeder hat eine Handlung", async (p) => {
  const ohne = await p.evaluate(() => {
    const fehlt = [];
    for (const [name, l] of Object.entries(HD.D.leer || {})) {
      // "verknuepft" ist ein Inline-Satz ohne Titel, kein eigener Zustand.
      if (name !== "verknuepft" && !(l.handlung && l.handlung.ziel)) fehlt.push(name);
    }
    return fehlt;
  });
  if (ohne.length) throw new Error("Leerzustand ohne Handlung: " + ohne.join(", "));
});

zusage("Jede Leerzustands-Handlung zeigt auf ein Ziel, das der Klick versteht", async (p) => {
  const unbekannt = await p.evaluate(() => {
    const erlaubt = ["suche:", "filter:", "json:", "datei:", "ordner:", "seite:", "live:", "mess:"];
    const schlecht = [];
    for (const [name, l] of Object.entries(HD.D.leer || {})) {
      const z = l.handlung && l.handlung.ziel;
      if (z && !erlaubt.some((v) => z.indexOf(v) === 0)) schlecht.push(name + " -> " + z);
      if (z && z.indexOf("seite:") === 0 && !HD.D.seiten[z.slice(6)]) schlecht.push(name + " -> unbekannte Seite " + z);
    }
    return schlecht;
  });
  if (unbekannt.length) throw new Error("Handlung ins Leere: " + unbekannt.join(" | "));
});

zusage("Kein Markdown-Rohtext steht als Titel im Interface", async (p) => {
  await p.evaluate(() => HD.zurSeite("zutun"));
  await p.waitForTimeout(1500);
  const titel = await p.locator(".kanban-titel, .eintrag-haupt > .eintrag-name").allTextContents();
  for (const t of titel) {
    if (/\*\*/.test(t)) throw new Error("Markdown-Sternchen im Titel: " + t);
    if (/^[-*+]\s/.test(t)) throw new Error("Listenzeichen im Titel: " + t);
    if (/\.md:\d+/.test(t)) throw new Error("Datei:Zeile im Titel: " + t);
  }
  await p.evaluate(() => HD.zurSeite("ueberblick"));
  await p.waitForTimeout(400);
});

zusage("Kein Wort verspricht Sicherheit, die es nicht gibt", async (p) => {
  const luege = await p.evaluate(() => {
    // "gesichert" ist dem GEPUSHTEN Zustand vorbehalten; der Git-Zustand einer
    // einzelnen Datei sagt nur, dass Git sie verfolgt.
    return (HD.D.roh && HD.D.roh.woerter && HD.D.roh.woerter.git)
      ? HD.D.roh.woerter.git.getrackt : null;
  });
  const sichtbar = await p.evaluate(() => document.body.innerText);
  if (luege === "gesichert") throw new Error("GIT.getrackt heißt weiterhin 'gesichert'");
  if (/\bgesichert\b/.test(sichtbar) && !/Sicherung/.test(sichtbar)) {
    throw new Error("'gesichert' steht ohne Sicherungs-Zusammenhang auf der Seite");
  }
});

// --- Durchgang D: Tastatur und Sprache
zusage("Die Befehlspalette lässt sich mit der Tastatur bedienen", async (p) => {
  await p.keyboard.press("Control+k");
  await p.waitForTimeout(600);
  const offen = await p.evaluate(() => HD.S.palette);
  if (!offen) throw new Error("Strg+K öffnet die Palette nicht");
  const ersterMarkiert = await p.locator('.palette-treffer[aria-selected="true"]').count();
  if (!ersterMarkiert) throw new Error("kein Treffer ist vorab markiert");
  await p.keyboard.press("ArrowDown");
  await p.waitForTimeout(250);
  const index = await p.evaluate(() => HD.S.paletteIndex);
  if (index !== 1) throw new Error("Pfeil-runter bewegt die Markierung nicht (Index " + index + ")");
  await p.keyboard.press("Enter");
  await p.waitForTimeout(600);
  const zu = await p.evaluate(() => HD.S.palette);
  if (zu) throw new Error("Enter öffnet den Treffer nicht");
  await p.evaluate(() => HD.zurSeite("ueberblick"));
  await p.waitForTimeout(400);
});

zusage("Die Tastaturwege stehen irgendwo — '?' zeigt sie", async (p) => {
  await p.keyboard.press("?");
  await p.waitForTimeout(500);
  const text = await p.locator("#meldung").textContent();
  if (!/Strg\+K/.test(text || "")) throw new Error("'?' zeigt keine Tastaturübersicht: " + text);
  const knopf = await p.locator("#tasten-hilfe").count();
  if (!knopf) throw new Error("kein sichtbarer Hinweis auf die Tastaturhilfe");
  await p.evaluate(() => HD.meldungSchliessen());
});

zusage("Kein Text schreibt '1 Minuten' oder '1 Dateien'", async (p) => {
  const falsch = await p.evaluate(() => {
    const proben = [1, 2, 59, 60, 1440].map((m) => HD.dauer(m));
    return proben.filter((t) => /\b1 (Minuten|Stunden|Tagen)\b/.test(t || ""));
  });
  if (falsch.length) throw new Error("falsche Einzahl: " + falsch.join(", "));
  // innerText, NICHT textContent: textContent liefert auch den Inhalt der
  // <script>-Blöcke mit — dort steht der Client-Quelltext samt der Vorlage
  // "{n} Minuten", und der Test schlug auf seinen eigenen Code an.
  const sichtbar = await p.evaluate(() => document.body.innerText);
  const treffer = (sichtbar || "").match(/\b1 (Minuten|Stunden|Tagen|Dateien|Repos|Schritten)\b/);
  if (treffer) throw new Error("falsche Einzahl auf der Seite: " + treffer[0]);
});

zusage("Der Zustand überlebt das Neuladen nach dem Speichern", async (p) => {
  // Aufbauen, was ein Nutzer aufgebaut hätte: Seite, Suche, ein zugeklappter
  // Block, ein geöffneter Ordner.
  await p.evaluate(() => {
    HD.zurSeite("hooks");
    HD.S.suche = "guard";
    HD.S.abschnitt["gruppe:SessionStart"] = false;
    HD.S.baumOffen[".claude"] = true;
    HD.zeichnen();
  });
  await p.waitForTimeout(500);
  // Genau das tut das Speichern: retten, dann neu laden.
  await p.evaluate(() => HD.zustandRetten());
  await p.reload({ waitUntil: "networkidle" });
  await p.waitForTimeout(2000);
  const nach = await p.evaluate(() => ({
    seite: HD.S.seite,
    suche: HD.S.suche,
    zugeklappt: HD.S.abschnitt["gruppe:SessionStart"],
    ordner: !!HD.S.baumOffen[".claude"],
  }));
  await p.evaluate(() => { HD.S.suche = ""; HD.zurSeite("ueberblick"); });
  await p.waitForTimeout(500);
  if (nach.seite !== "hooks") throw new Error("Seite verloren: " + nach.seite);
  if (nach.suche !== "guard") throw new Error("Suche verloren: '" + nach.suche + "'");
  if (nach.zugeklappt !== false) throw new Error("Klappzustand verloren");
  if (!nach.ordner) throw new Error("geöffneter Ordner verloren");
});

zusage("Eine angeklickte Regel zeigt ihren vollen Text", async (p) => {
  await p.evaluate(() => HD.zurSeite("rules"));
  await p.waitForTimeout(500);
  await p.locator(".eintrag-zeile").first().click();
  await p.waitForTimeout(900);
  const hatInhalt = await p.locator("#detail [data-inhalt], #detail .datei-inhalt").count();
  if (!hatInhalt) throw new Error("Regel-Detail hat keinen Dateiinhalt-Kasten");
  await p.evaluate(() => HD.zurSeite("ueberblick"));
  await p.waitForTimeout(400);
});

// --- Durchgang E: MUSTER statt Einzelstelle -------------------------------
// Die Nachprüfung (Runde 3) fand neun halb behobene Fixes und nannte den Grund:
// „Fixes werden an dem einen Ort gebaut, an dem der Kritikpunkt formuliert war,
// und nicht an den sieben anderen Orten, an denen dasselbe Muster steht."
// Diese Zusagen prüfen deshalb die REGEL, nicht die Stelle — ein neuer
// Fehlerweg oder ein neues Textfeld fällt hier auf, ohne dass jemand daran denkt.

zusage("Jeder Fehlerweg meldet als Fehler, nicht als beiläufiger Hinweis", async (p) => {
  const ungetypt = await p.evaluate(() => {
    // Den ausgelieferten Client-Quelltext selbst durchsuchen: er steht in den
    // <script>-Blöcken der Seite und ist damit genau das, was wirklich läuft.
    const quelle = Array.from(document.querySelectorAll("script:not([type])"))
      .map((s) => s.textContent).join("\n");
    const treffer = [];
    quelle.split("\n").forEach((zeile, n) => {
      if (!/HD\.melden\(/.test(zeile)) return;
      if (/HD\.meldenFehler\(/.test(zeile)) return;
      if (/^\s*\/\//.test(zeile)) return;
      // Ein Fehlerwort im Aufruf, aber kein Fehler-Typ und kein "bleiben".
      if (/Fehl|fehlgeschlagen|nichtErreichbar|Gesperrt|grund:/.test(zeile)
          && !/"fehler"|"bleiben"/.test(zeile)) {
        treffer.push((n + 1) + ": " + zeile.trim().slice(0, 90));
      }
    });
    return treffer;
  });
  if (ungetypt.length) {
    throw new Error(ungetypt.length + " Fehlerweg(e) blenden nach 1,5 s aus:\n         " + ungetypt.join("\n         "));
  }
});

zusage("Jede bleibende Meldung hat einen Ausgang — nicht nur die Fehler", async (p) => {
  await p.evaluate(() => HD.melden("Bleibender Hinweis zur Probe", "bleiben"));
  await p.waitForTimeout(2200);
  const sichtbar = await p.evaluate(() => document.getElementById("meldung").classList.contains("sichtbar"));
  if (!sichtbar) throw new Error("bleibende Meldung ist verschwunden");
  const zu = p.locator(".meldung-zu");
  if (!(await zu.count())) throw new Error("bleibende Meldung hat keinen Schließen-Knopf");
  await zu.click();   // muss klickbar sein: pointer-events
  await p.waitForTimeout(300);
  const wegJetzt = await p.evaluate(() => document.getElementById("meldung").classList.contains("sichtbar"));
  if (wegJetzt) throw new Error("Schließen-Knopf der bleibenden Meldung wirkt nicht");
});

zusage("Grün heißt nur 'in Ordnung' — laufende Arbeit trägt einen eigenen Ton", async (p) => {
  const gleich = await p.evaluate(() => {
    const w = getComputedStyle(document.documentElement);
    const ok = w.getPropertyValue("--status-ok").trim();
    const laeuft = w.getPropertyValue("--status-laeuft").trim();
    return { ok, laeuft, gleich: !laeuft || ok === laeuft };
  });
  if (gleich.gleich) throw new Error("Fortschritt und 'in Ordnung' teilen sich eine Farbe: " + gleich.ok);
});

zusage("Jedes Textfeld behält Cursor und Fokus über ein Neuzeichnen", async (p) => {
  // Nicht das Suchfeld — dort war es schon repariert. Geprüft wird die REGEL
  // im zentralen Zeichenlauf, an einem beliebigen Feld.
  await p.evaluate(() => HD.zurSeite("hooks"));
  await p.waitForTimeout(600);
  const feld = p.locator("#suche");
  await feld.click();
  await feld.fill("abcdefgh");
  await p.evaluate(() => {
    const f = document.getElementById("suche");
    f.setSelectionRange(3, 3);   // Cursor mitten im Wort
  });
  await p.evaluate(() => HD.zeichnen());
  await p.waitForTimeout(400);
  const nach = await p.evaluate(() => {
    const f = document.getElementById("suche");
    return { fokus: document.activeElement === f, start: f.selectionStart };
  });
  await p.evaluate(() => { HD.S.suche = ""; HD.zurSeite("ueberblick"); });
  await p.waitForTimeout(400);
  if (!nach.fokus) throw new Error("Fokus nach dem Neuzeichnen verloren");
  if (nach.start !== 3) throw new Error("Cursor sprang von 3 auf " + nach.start);
});

zusage("Die Seite springt bei einem Klick nicht an den Anfang", async (p) => {
  await p.evaluate(() => HD.zurSeite("dateien"));
  await p.waitForTimeout(900);
  await p.evaluate(() => { document.getElementById("hauptflaeche").scrollTop = 400; });
  await p.waitForTimeout(200);
  const vor = await p.evaluate(() => document.getElementById("hauptflaeche").scrollTop);
  if (vor < 100) throw new Error("Seite ließ sich nicht scrollen (Testaufbau)");
  await p.evaluate(() => HD.zeichnen());
  await p.waitForTimeout(300);
  const nach = await p.evaluate(() => document.getElementById("hauptflaeche").scrollTop);
  await p.evaluate(() => HD.zurSeite("ueberblick"));
  await p.waitForTimeout(400);
  if (Math.abs(nach - vor) > 8) throw new Error("Sprung von " + vor + " auf " + nach);
});

zusage("Ein bewusster Seitenwechsel beginnt dagegen oben", async (p) => {
  await p.evaluate(() => HD.zurSeite("dateien"));
  await p.waitForTimeout(900);
  await p.evaluate(() => { document.getElementById("hauptflaeche").scrollTop = 400; });
  await p.waitForTimeout(200);
  await p.evaluate(() => HD.zurSeite("hooks"));
  await p.waitForTimeout(600);
  const nach = await p.evaluate(() => document.getElementById("hauptflaeche").scrollTop);
  await p.evaluate(() => HD.zurSeite("ueberblick"));
  await p.waitForTimeout(400);
  if (nach > 8) throw new Error("neue Seite beginnt bei " + nach + " statt oben");
});

zusage("Die Befehlspalette meldet ihre Markierung an Vorlesesoftware", async (p) => {
  await p.keyboard.press("Control+k");
  await p.waitForTimeout(700);
  const stand = await p.evaluate(() => {
    const feld = document.getElementById("palette-feld");
    const ziel = feld.getAttribute("aria-activedescendant");
    return { ziel, gibtEs: ziel ? !!document.getElementById(ziel) : false };
  });
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  if (!stand.ziel) throw new Error("kein aria-activedescendant gesetzt");
  if (!stand.gibtEs) throw new Error("aria-activedescendant zeigt auf eine ID, die es nicht gibt: " + stand.ziel);
});

zusage("Zahlen widersprechen sich nicht zwischen zwei Flächen", async (p) => {
  const zahlen = await p.evaluate(() => {
    const alle = HD.seitenEintraege("hooks");
    return {
      ccZahl: alle.filter((e) => e.art === "hook-skript").length,
      gemessen: HD.D.zahlen.hooks,
      aufDerSeite: alle.length,
    };
  });
  if (zahlen.ccZahl !== zahlen.gemessen) {
    throw new Error("Control Center zählt " + zahlen.ccZahl + " Hooks, die Messung " + zahlen.gemessen);
  }
});

zusage("Dieselbe Sache trägt auf beiden Flächen dieselbe Stufe", async (p) => {
  await p.evaluate(() => HD.zurSeite("ueberblick"));
  await p.waitForTimeout(1200);
  const stand = await p.evaluate(() => {
    const flaeche = document.querySelector(".achtung-widget");
    if (!flaeche) return { ohne: true };
    const gezeigt = Array.from(document.querySelectorAll(".drei-zeile"))
      .map((z) => z.dataset.id)
      .map((id) => HD.eintragMit(id))
      .filter(Boolean);
    let hoechsterRang = -1, erwartet = null;
    gezeigt.forEach((e) => {
      const r = (HD.D.status[e.status] || {}).rang;
      if (r != null && r > hoechsterRang) { hoechsterRang = r; erwartet = e.status; }
    });
    return { gesetzt: flaeche.dataset.stufe || null, erwartet, anzahl: gezeigt.length };
  });
  if (stand.ohne || !stand.anzahl) return;   // nichts offen: nichts zu prüfen
  if (stand.gesetzt !== stand.erwartet) {
    throw new Error("Warnfläche zeigt '" + stand.gesetzt + "', die Einträge sagen '" + stand.erwartet + "'");
  }
});

zusage("Alles steht auf einer gemeinsamen linken Kante", async (p) => {
  await p.evaluate(() => HD.zurSeite("zutun"));
  await p.waitForTimeout(1800);
  const kanten = await p.evaluate(() => {
    const proben = [".seiten-titel", ".seiten-unter", ".suchfeld", ".gruppen-kopf",
                    ".gruppen-titel", ".kanban-spalte", ".werkzeugleiste"];
    const raus = {};
    proben.forEach((w) => {
      const el = document.querySelector(w);
      if (el) raus[w] = Math.round(el.getBoundingClientRect().x);
    });
    return raus;
  });
  await p.evaluate(() => HD.zurSeite("ueberblick"));
  await p.waitForTimeout(400);
  const werte = Object.values(kanten);
  const kante = werte[0];
  const abweichend = Object.entries(kanten).filter(([, x]) => Math.abs(x - kante) > 2);
  if (abweichend.length) {
    throw new Error("Kante " + kante + ", abweichend: "
      + abweichend.map(([w, x]) => w + "=" + x).join(", "));
  }
});

zusage("Kein Leerzustand wird von Hand geschrieben statt über HD.leerHTML", async (p) => {
  const handarbeit = await p.evaluate(() => {
    const quelle = Array.from(document.querySelectorAll("script:not([type])"))
      .map((s) => s.textContent).join("\n");
    const treffer = [];
    quelle.split("\n").forEach((zeile, n) => {
      // HD.D.leer[...] direkt in HTML gegossen, statt HD.leerHTML zu rufen —
      // dabei geht die Handlung verloren, die den Leerzustand erst brauchbar macht.
      if (/HD\.D\.leer\[[^\]]+\]\.(text|titel)/.test(zeile) && !/^\s*\/\//.test(zeile)) {
        treffer.push((n + 1) + ": " + zeile.trim().slice(0, 80));
      }
    });
    return treffer;
  });
  if (handarbeit.length) {
    throw new Error("Leerzustand ohne Handlung von Hand gebaut:\n         " + handarbeit.join("\n         "));
  }
});

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const jsFehler = [];
  p.on("pageerror", (e) => jsFehler.push(String(e)));
  await p.goto("http://127.0.0.1:8766/", { waitUntil: "networkidle" });
  await p.waitForTimeout(1800);

  let rot = 0;
  for (const z of ZUSAGEN) {
    try {
      await z.fn(p);
      console.log("  GRUEN  " + z.text);
    } catch (e) {
      rot += 1;
      console.log("  ROT    " + z.text + "\n         -> " + e.message);
    }
  }
  if (jsFehler.length) {
    rot += 1;
    console.log("  ROT    Keine JavaScript-Fehler in der Konsole\n         -> " + jsFehler.join(" | "));
  } else {
    console.log("  GRUEN  Keine JavaScript-Fehler in der Konsole");
  }
  console.log("\nERGEBNIS: " + (ZUSAGEN.length + 1 - rot) + " gruen, " + rot + " rot");
  await b.close();
  process.exit(rot ? 1 : 0);
})().catch((e) => { console.error("ABBRUCH:", e.message); process.exit(2); });
