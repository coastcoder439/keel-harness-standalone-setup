// OPTISCHE ABNAHME -- schiesst jede Seite in beiden Themes.
//
// WARUM ES SIE GIBT [working-method.md, Owner 25.08.2026: "du hast anscheinend
// keine optische Abnahme gemacht"]: DOM-Text lesen ersetzt das Hinsehen nicht.
// klickpfad.js prueft, ob ein Bedienelement seine Zusage haelt; dieses Skript
// liefert das Bild, gegen das docs/ui-standard.md und docs/ui-standard-werkzeug.md
// geprueft werden.
//
// AUFRUF (Server muss laufen):
//   node dashboard/serve.js --port 8766
//   node dashboard/screenshots.js [seite ...]     # ohne Argument: alle Seiten
//   node dashboard/screenshots.js projekte --oeffnen keel-light
//                                                 # Eintrag waehlen, dann schiessen
//
// Bilder landen in dashboard/.screenshots/<seite>-<theme>.png (nicht versioniert).
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (e) {
  process.stderr.write(
    "Playwright fehlt -- die optische Abnahme braucht es.\n" +
    "  Einmalig einrichten:  npm i -D playwright && npx playwright install chromium\n"
  );
  process.exit(2);
}
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 8766);
const ZIEL = path.join(__dirname, ".screenshots");
const THEMES = ["light", "dark"];

async function main() {
  const argv = process.argv.slice(2);
  const oeffnenAt = argv.indexOf("--oeffnen");
  const oeffnen = oeffnenAt >= 0 ? argv[oeffnenAt + 1] : null;
  const gewuenscht = argv.filter((a, i) => !a.startsWith("-") && i !== oeffnenAt + 1);
  fs.mkdirSync(ZIEL, { recursive: true });
  const browser = await chromium.launch();
  const seite = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await seite.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });

  const alle = await seite.evaluate(() => Object.keys(HD.D.seiten));
  const liste = gewuenscht.length ? gewuenscht.filter((s) => alle.includes(s)) : alle;
  if (gewuenscht.length && liste.length < gewuenscht.length) {
    const fehlt = gewuenscht.filter((s) => !alle.includes(s));
    process.stderr.write(`Unbekannte Seite(n): ${fehlt.join(", ")}\nBekannt: ${alle.join(" ")}\n`);
    process.exitCode = 1;
  }

  const gemacht = [];
  for (const theme of THEMES) {
    await seite.emulateMedia({ colorScheme: theme });
    for (const name of liste) {
      await seite.evaluate((n) => { HD.zurSeite(n); }, name);
      // Live-Sektionen holen ihren Stand erst beim Zeichnen -- ohne diese
      // Wartezeit zeigt das Bild "Laedt ..." statt der Sache selbst.
      await seite.waitForTimeout(oeffnen ? 300 : 900);
      if (oeffnen) {
        const gefunden = await seite.evaluate((suche) => {
          const treffer = HD.seitenEintraege(HD.S.seite).filter((e) => (e.id + " " + e.name).includes(suche))[0];
          if (treffer) HD.oeffnen(treffer.id);
          return treffer ? treffer.id : null;
        }, oeffnen);
        if (!gefunden) process.stderr.write(`Kein Eintrag mit "${oeffnen}" auf ${name}
`);
        await seite.waitForTimeout(900);
      }
      const datei = path.join(ZIEL, `${name}${oeffnen ? "-offen" : ""}-${theme}.png`);
      await seite.screenshot({ path: datei, fullPage: true });
      gemacht.push(path.relative(process.cwd(), datei));
    }
  }
  await browser.close();
  process.stdout.write(`${gemacht.length} Bilder in ${path.relative(process.cwd(), ZIEL)}\n`);
  process.stdout.write(gemacht.join("\n") + "\n");
}

main().catch((e) => { process.stderr.write(String(e && e.stack || e) + "\n"); process.exit(1); });
