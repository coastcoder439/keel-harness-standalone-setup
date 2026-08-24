// KLEINE HELFER der Anzeige -- von data.js und views.js gemeinsam benutzt.
//
// Sie stehen hier, weil beide sie brauchen und keiner sie besitzt. Eine Kopie
// in jedem waere zwei Staende.

const W = require("./labels.js");
const { UI, ART_BESCHREIBUNG, DATEITYP, DATEITYP_ALLGEMEIN, QUELLE, fuellen } = W;

// Letzter Ausweg (A6): eine Aussage ueber die ART der Datei, wenn es weder eine
// eigene Beschreibung noch eine bekannte Rolle gibt. Nie null, wenn eine Endung
// da ist -- eine .yaml-Datendatei ohne Kopfkommentar bekommt "YAML-Datei …"
// statt einer leeren Zeile.
function typBeschreibung(ext) {
  if (!ext) return null;
  const e = String(ext).toLowerCase();
  const text = DATEITYP[e] || fuellen(DATEITYP_ALLGEMEIN, { ext: e });
  return { text, quelle: QUELLE.typ, beleg: null };
}

// ---------------------------------------------------------------------------
// Kleine Helfer
// ---------------------------------------------------------------------------

// Ein Feld fuer die Eigenschaften-Tabelle. wert===null wird NICHT gezeigt --
// eine leere Zeile mit einem Strich ist keine Auskunft, sondern Fuellmaterial.
function feld(label, wert, extra) {
  if (wert === null || wert === undefined || wert === "") return null;
  return Object.assign({ label, wert: String(wert) }, extra || {});
}

const felderVon = (...liste) => liste.flat().filter(Boolean);

// Sprache eines Dateiinhalts fuer die Code-Ansicht.
function spracheVon(ext) {
  const k = { js: "JavaScript", json: "JSON", md: "Markdown", txt: "Text",
              html: "HTML", css: "CSS", sh: "Shell", yml: "YAML", yaml: "YAML" };
  return k[String(ext || "").toLowerCase()] || (ext ? String(ext).toUpperCase() : "Text");
}

// Beschreibung in einen anzeigbaren Block. Fuer Dateien ohne eigene Quelle
// greift der Rollensatz -- sonst stuende bei settings.json, der zentralsten
// Datei des Harness, "keine Beschreibung".
function beschreibungVon(b, rolle, ext) {
  if (!b) {
    const ausRolle = ART_BESCHREIBUNG[rolle];
    if (ausRolle) return { text: ausRolle, quelle: QUELLE.rolle, beleg: null };
    return typBeschreibung(ext) || { text: null, quelle: null, beleg: null };
  }
  if (b.text) {
    return { text: b.text, quelle: QUELLE[b.quelle] || b.quelle || null, beleg: b.beleg || null };
  }
  const ausRolle = ART_BESCHREIBUNG[b.rolle || rolle];
  if (ausRolle) return { text: ausRolle, quelle: QUELLE.rolle, beleg: null };
  return typBeschreibung(ext) || { text: null, quelle: null, beleg: null };
}

// Inhalt einer Datei fuer die Anzeige -- mit ehrlichem Grund, wenn er fehlt.
function inhaltVon(d) {
  const i = d.inhalt;
  if (!i) return null;
  if (i.gesperrt) {
    const grund = i.gesperrt === "ignoriert" ? UI.inhaltGesperrtIgnoriert
                : i.gesperrt === "binaer" ? UI.inhaltGesperrtBinaer
                : i.gesperrt;
    return { gesperrt: true, grund, text: null, zeilen: d.zeilen || null, sprache: spracheVon(d.ext) };
  }
  // SERVER-ZUERST (D1): kein Rumpf im Datensatz -- text bleibt null, serve.js
  // liefert ihn auf Klick. Nur Auskuenfte ueber die Datei bleiben hier.
  return {
    gesperrt: false,
    text: null,
    sprache: spracheVon(i.sprache || d.ext),
    ext: d.ext || null,
    zeilen: d.zeilen || null,
    ausgeblendeteZeilen: i.ausgeblendeteZeilen || [],
  };
}

module.exports = { feld, felderVon, spracheVon, beschreibungVon, inhaltVon };
