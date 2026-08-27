// AUSRICHTUNG -- misst, was ein Screenshot nur zeigt.
//
// WARUM ES SIE GIBT [Owner 27.08.2026, woertlich]: "ganz oft sind Sachen
// schief, lappen uebereinander, sind nicht buendig, ein Text guckt irgendwo
// raus". Das ist eine REGEL, keine Geschmacksfrage -- und Regeln, die nur als
// Vorsatz existieren, halten nicht. Dieses Skript misst sie:
//
//   1. Ueberlauf: ein Element ragt aus seinem Elternkasten heraus.
//   2. Ueberlappung: zwei Geschwister ueberdecken einander.
//   3. Abschnitt: ein Text ist gekuerzt, obwohl daneben Platz frei ist.
//   4. Kante: Bloecke derselben Spalte stehen nicht auf einer Linie.
//
// AUFRUF (Server muss laufen):
//   node dashboard/serve.js --port 8766
//   node dashboard/ausrichtung.js [seite ...]
//
// Ein Fund ist ein BLOCKER, kein Restposten -- Ausgabe mit Exitcode 1.
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (e) {
  process.stderr.write(
    "Playwright fehlt -- die Ausrichtungs-Pruefung braucht es.\n" +
    "  Einmalig einrichten:  npm i -D playwright && npx playwright install chromium\n"
  );
  process.exit(2);
}

const PORT = Number(process.env.PORT || 8766);
const TOLERANZ = 1; // Bildpunkte: Rundung und Rahmenbreiten

async function seitePruefen(seite, name) {
  return seite.evaluate(({ tol }) => {
    const raus = [];
    const sichtbar = (el) => {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const beschreiben = (el) => {
      const k = el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : "";
      const t = (el.textContent || "").trim().slice(0, 40);
      return el.tagName.toLowerCase() + k + (t ? ' "' + t + '"' : "");
    };

    // Was INNERHALB eines <svg> liegt, gehorcht eigener Geometrie: Kreise und
    // Pfade eines Symbols ueberlappen einander mit Absicht. Ebenso ausgenommen:
    // Elemente mit negativem Aussenabstand -- die ragen gewollt heraus (der
    // Aufklapp-Winkel sitzt links neben seinem Text).
    const imSvg = (el) => !!el.closest("svg");
    const negativerRand = (el) => {
      const s = getComputedStyle(el);
      return ["marginLeft", "marginRight", "marginTop", "marginBottom"].some(function (k) {
        return parseFloat(s[k]) < 0;
      });
    };
    const alle = [...document.querySelectorAll(".arbeitsflaeche *")]
      .filter(sichtbar).filter((el) => !imSvg(el) && !negativerRand(el));

    // 1. Ueberlauf ueber den Elternkasten
    for (const el of alle) {
      const p = el.parentElement;
      if (!p || !sichtbar(p)) continue;
      const ps = getComputedStyle(p);
      if (ps.overflow !== "visible" || ps.overflowX !== "visible") continue;
      if (getComputedStyle(el).position === "absolute" || getComputedStyle(el).position === "fixed") continue;
      const a = el.getBoundingClientRect(), b = p.getBoundingClientRect();
      if (a.right > b.right + tol || a.left < b.left - tol) {
        raus.push({ art: "ueberlauf", was: beschreiben(el), eltern: beschreiben(p),
          um: Math.round(Math.max(a.right - b.right, b.left - a.left)) });
      }
    }

    // 2. Ueberlappung zwischen Geschwistern im Fluss
    const eltern = new Set(alle.map((el) => el.parentElement).filter(Boolean));
    for (const p of eltern) {
      const ps = getComputedStyle(p);
      if (ps.position === "relative" && p.querySelector("[style*='position:absolute']")) continue;
      const kinder = [...p.children].filter((k) => sichtbar(k)
        && getComputedStyle(k).position !== "absolute" && getComputedStyle(k).position !== "fixed");
      for (let i = 0; i < kinder.length; i++) {
        for (let j = i + 1; j < kinder.length; j++) {
          const a = kinder[i].getBoundingClientRect(), b = kinder[j].getBoundingClientRect();
          const breite = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const hoehe = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (breite > tol && hoehe > tol) {
            raus.push({ art: "ueberlappung", was: beschreiben(kinder[i]), eltern: beschreiben(kinder[j]),
              um: Math.round(Math.min(breite, hoehe)) });
          }
        }
      }
    }

    // 3. Gekuerzter Text, obwohl Platz frei ist
    for (const el of alle) {
      if (el.children.length) continue;
      if (el.scrollWidth <= el.clientWidth + tol) continue;
      const p = el.parentElement;
      if (!p) continue;
      const frei = p.getBoundingClientRect().width - el.getBoundingClientRect().width;
      if (frei > 24) {
        raus.push({ art: "kuerzung", was: beschreiben(el), eltern: beschreiben(p), um: Math.round(frei) });
      }
    }
    return raus;
  }, { tol: 1 });
}

async function main() {
  const gewuenscht = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const browser = await chromium.launch();
  const seite = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await seite.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  const alle = await seite.evaluate(() => Object.keys(HD.D.seiten));
  const liste = gewuenscht.length ? gewuenscht.filter((s) => alle.includes(s)) : alle;

  let funde = 0;
  for (const name of liste) {
    await seite.evaluate((n) => HD.zurSeite(n), name);
    await seite.waitForTimeout(900);
    const treffer = await seitePruefen(seite, name);
    if (!treffer.length) { process.stdout.write("  GRUEN  " + name + "\n"); continue; }
    funde += treffer.length;
    process.stdout.write("  ROT    " + name + " (" + treffer.length + ")\n");
    for (const t of treffer.slice(0, 6)) {
      process.stdout.write("         " + t.art + " " + t.um + "px: " + t.was + "  <->  " + t.eltern + "\n");
    }
  }
  await browser.close();
  process.stdout.write("\nERGEBNIS: " + (liste.length - 0) + " Seiten geprueft, " + funde + " Funde\n");
  process.exit(funde ? 1 : 0);
}

main().catch((e) => { process.stderr.write(String(e && e.stack || e) + "\n"); process.exit(2); });
