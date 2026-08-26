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
