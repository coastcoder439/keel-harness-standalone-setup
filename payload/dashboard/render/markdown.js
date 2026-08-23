// MINI-MARKDOWN -- Schritt 3 von "messen -> Daten -> rendern -> Datei".
//
// DIE WICHTIGSTE EIGENSCHAFT DIESER DATEI
// ZUERST escapen, DANN Markdown anwenden. Der komplette Quelltext geht EINMAL
// durch escapeHtml, bevor irgendein Parser ihn sieht. Danach gibt es im ganzen
// Rohr kein rohes "<" mehr -- ein <script> aus einer Harness-Datei kann also gar
// nicht als Element im Ergebnis landen, egal welchen Weg er durch den Parser
// nimmt. Kein Filter, den man vergessen kann, sondern eine Eigenschaft der
// Reihenfolge.
// Der Preis dafuer: Blockzitate werden auf "&gt;" erkannt statt auf ">", und
// alles, was in ein Attribut geht, wird VORHER entescaped und einmal frisch
// escaped (nie zweimal). Das ist der ganze Preis.
//
// UMFANG (Abschnitt 5.4 der Spezifikation, festgeschrieben)
// Frontmatter abziehen -> Ueberschriften h1-h4 -> Code-Zaeune mit Sprache und
// 4-Leerzeichen-Codebloecke -> Blockzitate (rekursiv) -> Listen ul/ol
// verschachtelt inkl. Aufgabenkaestchen -> Tabellen (GFM-Pipe, Ausrichtung,
// literales \| und Code-Spans beim Zellen-Trennen) -> Trennlinien -> Absaetze.
// Inline: Code, fett, kursiv (_ nur an Wortgrenzen, damit ANTHROPIC_API_KEY
// nicht kursiviert), Links mit Schema-Allowlist. HTML-Kommentare werden als
// gedaempfter Block GEZEIGT, nicht versteckt.
// NICHT gebaut: HTML-Durchreichung, Fussnoten, Referenzlinks, Bilder aus dem
// Netz, Durchstreichen, harte Umbrueche, ~~~-Zaeune.
//
// LINKS -- keiner fuehrt ins Leere
//   intern  Ziel existiert (opts.dateiExistiert)  -> href="#dateien/<pfad>"
//   extern  http(s)                               -> target=_blank rel=noopener noreferrer
//   tot     alles andere (fehlende Datei, fremdes Schema, reine Sprungmarke)
//           -> KEIN Anker, sondern <span class="link-tot" title="...">.
// Reine "#anker"-Links werden bewusst nicht ausgegeben: die Seite selbst routet
// ueber den Hash -- ein solcher Link wuerde die Anwendung wegnavigieren.
//
// FOLGEPFLICHT (A61): die drei deutschen Saetze in TEXTE_STANDARD sind die
// einzigen Labels in dieser Datei und ueber opts.texte ersetzbar. Sobald
// render/data.js seine WORTE-Liste hat, werden sie von dort gereicht.
//
// AUFRUF   const { markdownZuHtml, escapeHtml } = require("./markdown");
//          markdownZuHtml(text, { basisPfad, dateiExistiert })

// ---------------------------------------------------------------------------
// 1. Escapen und Umkehr
// ---------------------------------------------------------------------------
const ESCAPE_PAARE = [
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
  ["'", "&#39;"],
];

function escapeHtml(wert) {
  let s = String(wert == null ? "" : wert);
  for (const paar of ESCAPE_PAARE) s = s.split(paar[0]).join(paar[1]);
  return s;
}

// Nur fuer Pfadpruefung und Attributwerte: der escapte Strom wird kurz
// zurueckgedreht, geprueft, und das Ergebnis geht einmal frisch durch escapeHtml.
function entescapen(wert) {
  return String(wert == null ? "" : wert)
    .split("&lt;").join("<")
    .split("&gt;").join(">")
    .split("&quot;").join('"')
    .split("&#39;").join("'")
    .split("&amp;").join("&");
}

const STEUERZEICHEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const MARKE = "\u0001"; // Platzhalter fuer gesicherte Code-Spans
const TIEFE_MAX = 6; // Schutz gegen Endlosschachtelung (Zitat in Zitat in ...)

// Ein verbotenes Ziel wird NIRGENDS ausgegeben -- auch nicht als Text im title.
// Sonst stuende "javascript:" in der fertigen HTML, und die Abnahme A60 sucht
// genau diese Zeichenfolge: eine harmlose Fundstelle wuerde die Pruefung, die
// echte Funde finden soll, dauerhaft entwerten.
const TEXTE_STANDARD = {
  zielFehlt: "Ziel fehlt im Harness: ",
  schemaVerboten: "Link-Schema nicht erlaubt -- Ziel entfernt",
  ankerOhneDatei: "Sprungmarke ohne Datei -- kein Ziel im Harness",
};

function optionen(opts) {
  const o = opts || {};
  const texte = {};
  for (const k of Object.keys(TEXTE_STANDARD)) texte[k] = TEXTE_STANDARD[k];
  for (const k of Object.keys(o.texte || {})) texte[k] = o.texte[k];
  return {
    basisPfad: posixPfad(o.basisPfad || ""),
    dateiExistiert: typeof o.dateiExistiert === "function" ? o.dateiExistiert : null,
    texte,
  };
}

// ---------------------------------------------------------------------------
// 2. Pfade -- immer POSIX, nie Backslash
// ---------------------------------------------------------------------------
function posixPfad(pfad) {
  return String(pfad == null ? "" : pfad).split("\\").join("/");
}

function ordnerVon(pfad) {
  const i = pfad.lastIndexOf("/");
  return i < 0 ? "" : pfad.slice(0, i);
}

function pfadZusammen(basisOrdner, ziel) {
  const start = ziel.charAt(0) === "/" ? ziel.slice(1) : basisOrdner ? basisOrdner + "/" + ziel : ziel;
  const raus = [];
  for (const teil of start.split("/")) {
    if (teil === "" || teil === ".") continue;
    if (teil === "..") {
      raus.pop();
      continue;
    }
    raus.push(teil);
  }
  return raus.join("/");
}

// Ein werfender Rueckruf darf das Rendern nicht abbrechen. Der Fehler bleibt
// sichtbar: das Ziel gilt als nicht vorhanden und der Link wird als tot markiert.
function existiert(o, pfad) {
  if (!o.dateiExistiert) return false;
  try {
    return !!o.dateiExistiert(pfad);
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 3. Link-Ziele (Schema-Allowlist)
// ---------------------------------------------------------------------------
const RE_SCHEMA = /^([A-Za-z][A-Za-z0-9+.-]*):/;

function zielAufloesen(rohZiel, o) {
  const ziel = entescapen(String(rohZiel == null ? "" : rohZiel).trim());
  if (!ziel) return { art: "tot", titel: o.texte.zielFehlt + "(leer)" };
  const m = RE_SCHEMA.exec(ziel);
  if (m) {
    const schema = m[1].toLowerCase();
    if (schema === "http" || schema === "https") return { art: "extern", href: ziel };
    if (schema === "mailto") return { art: "mail", href: ziel };
    return { art: "tot", titel: o.texte.schemaVerboten };
  }
  if (ziel.slice(0, 2) === "//") return { art: "tot", titel: o.texte.schemaVerboten };
  if (ziel.charAt(0) === "#") return { art: "tot", titel: o.texte.ankerOhneDatei };
  return dateiZiel(ziel, o);
}

function dateiZiel(ziel, o) {
  const raute = ziel.indexOf("#");
  const pfadTeil = raute === -1 ? ziel : ziel.slice(0, raute);
  const anker = raute === -1 ? "" : ziel.slice(raute + 1);
  const aufgeloest = pfadZusammen(ordnerVon(o.basisPfad), posixPfad(pfadTeil));
  if (aufgeloest && existiert(o, aufgeloest)) {
    return { art: "intern", href: "#dateien/" + aufgeloest + zeilenAnker(anker) };
  }
  return { art: "tot", titel: o.texte.zielFehlt + (aufgeloest || pfadTeil) };
}

function zeilenAnker(anker) {
  const m = /^L(\d{1,7})$/.exec(String(anker || ""));
  return m ? ":L" + m[1] : "";
}

function linkHtml(beschriftung, ziel, o) {
  const text = beschriftung === "" ? escapeHtml(entescapen(ziel)) : beschriftung;
  const z = zielAufloesen(ziel, o);
  if (z.art === "extern") {
    return (
      '<a class="md-link md-link-extern" href="' +
      escapeHtml(z.href) +
      '" target="_blank" rel="noopener noreferrer">' +
      text +
      "</a>"
    );
  }
  if (z.art === "intern" || z.art === "mail") {
    return '<a class="md-link" href="' + escapeHtml(z.href) + '">' + text + "</a>";
  }
  return '<span class="link-tot" title="' + escapeHtml(z.titel) + '">' + text + "</span>";
}

// ---------------------------------------------------------------------------
// 4. Inline: Code-Spans zuerst sichern, dann Links, fett, kursiv
// ---------------------------------------------------------------------------
const WORT = "0-9A-Za-z\\u00C0-\\u024F";
const RE_LINK = /\[([^\]\n]*)\]\(([^)\s]*)\)/g;
const RE_FETT_STERN = /\*\*([^*][\s\S]*?)\*\*/g;
const RE_FETT_UNTER = new RegExp("(^|[^" + WORT + "_])__(?!_)([\\s\\S]+?)__(?![" + WORT + "_])", "g");
const RE_KURSIV_STERN = /\*([^*\s][^*]*?)\*/g;
const RE_KURSIV_UNTER = new RegExp("(^|[^" + WORT + "_])_(?![\\s_])([^_]+?)_(?![" + WORT + "_])", "g");
const RE_MARKE = new RegExp(MARKE + "(\\d+)" + MARKE, "g");

function inlineHtml(text, o) {
  const koffer = [];
  let s = codeSpansSichern(String(text == null ? "" : text), koffer);
  s = s.replace(RE_LINK, function (ganz, beschriftung, ziel) {
    return linkHtml(beschriftung, ziel, o);
  });
  s = s.replace(RE_FETT_STERN, "<strong>$1</strong>");
  s = s.replace(RE_FETT_UNTER, "$1<strong>$2</strong>");
  s = s.replace(RE_KURSIV_STERN, "<em>$1</em>");
  s = s.replace(RE_KURSIV_UNTER, "$1<em>$2</em>");
  return codeSpansZurueck(s, koffer);
}

// Schliessende Backtick-Folge von GENAU derselben Laenge suchen.
function zaunEndeSuchen(text, von, laenge) {
  let k = von;
  while (k < text.length) {
    if (text.charAt(k) !== "`") {
      k++;
      continue;
    }
    let m = 0;
    while (text.charAt(k + m) === "`") m++;
    if (m === laenge) return k;
    k += m;
  }
  return -1;
}

function codeSpansSichern(text, koffer) {
  let aus = "";
  let i = 0;
  while (i < text.length) {
    if (text.charAt(i) !== "`") {
      aus += text.charAt(i);
      i++;
      continue;
    }
    let n = 0;
    while (text.charAt(i + n) === "`") n++;
    const zu = zaunEndeSuchen(text, i + n, n);
    if (zu === -1) {
      aus += text.substr(i, n);
      i += n;
      continue;
    }
    koffer.push(text.slice(i + n, zu));
    aus += MARKE + (koffer.length - 1) + MARKE;
    i = zu + n;
  }
  return aus;
}

function codeSpansZurueck(text, koffer) {
  return text.replace(RE_MARKE, function (ganz, nummer) {
    const inhalt = koffer[Number(nummer)];
    return '<code class="md-code-inline">' + randSpaceWeg(inhalt == null ? "" : inhalt) + "</code>";
  });
}

function randSpaceWeg(s) {
  if (s.length > 1 && s.charAt(0) === " " && s.charAt(s.length - 1) === " " && s.trim() !== "") {
    return s.slice(1, -1);
  }
  return s;
}

// ---------------------------------------------------------------------------
// 5. Blockerkennung -- alle Muster arbeiten auf ESCAPTEN Zeilen
// ---------------------------------------------------------------------------
const RE_ZAUN_AUF = /^\s{0,3}(`{3,})\s*([A-Za-z0-9_+#.-]{0,20})\s*$/;
const RE_ZAUN_ZU = /^\s{0,3}`{3,}\s*$/;
const RE_KOMMENTAR_AUF = /^\s{0,3}&lt;!--/;
const RE_KOMMENTAR_ZU = /--&gt;/;
const RE_ZITAT = /^\s{0,3}&gt;\s?/;
const RE_UEBERSCHRIFT = /^\s{0,3}(#{1,4})\s+(.*?)\s*#*\s*$/;
const RE_TRENN = /^\s{0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const RE_PUNKT = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const RE_EINZUG = /^(?: {4}|\t)/;
const RE_KASTEN = /^\[([ xX])\]\s+/;

function istTrennzelle(zelle) {
  return /^:?-{1,}:?$/.test(zelle.trim());
}

function istTabellenKopf(zeilen, i) {
  const kopf = zeilen[i];
  const trenn = zeilen[i + 1];
  if (!kopf || kopf.indexOf("|") === -1) return false;
  if (trenn == null || trenn.indexOf("-") === -1) return false;
  const k = zellenTeilen(kopf);
  const t = zellenTeilen(trenn);
  return t.length > 0 && t.length === k.length && t.every(istTrennzelle);
}

function istBlockStart(zeilen, i) {
  const z = zeilen[i];
  if (RE_ZAUN_AUF.test(z) || RE_KOMMENTAR_AUF.test(z) || RE_ZITAT.test(z)) return true;
  if (RE_UEBERSCHRIFT.test(z) || RE_TRENN.test(z) || RE_PUNKT.test(z)) return true;
  return istTabellenKopf(zeilen, i);
}

// ---------------------------------------------------------------------------
// 6. Die Leser. Jeder gibt den unveraenderten Index zurueck, wenn er nicht
//    zustaendig ist -- sonst schiebt er sein HTML nach "aus" und meldet, wie
//    weit er gelesen hat.
// ---------------------------------------------------------------------------
function codeBlockHtml(inhalt, sprache) {
  const marke = sprache ? ' data-sprache="' + sprache + '"' : "";
  const klasse = sprache ? ' class="sprache-' + sprache.toLowerCase().replace(/[^a-z0-9]+/g, "-") + '"' : "";
  return '<pre class="md-code" style="overflow-x:auto"' + marke + "><code" + klasse + ">" + inhalt + "</code></pre>";
}

function zaunLesen(zeilen, i, aus) {
  const m = RE_ZAUN_AUF.exec(zeilen[i]);
  if (!m) return i;
  const stueck = [];
  let j = i + 1;
  while (j < zeilen.length && !RE_ZAUN_ZU.test(zeilen[j])) {
    stueck.push(zeilen[j]);
    j++;
  }
  aus.push(codeBlockHtml(stueck.join("\n"), m[2] || ""));
  return j < zeilen.length ? j + 1 : j;
}

function codeEinzugLesen(zeilen, i, aus) {
  if (!RE_EINZUG.test(zeilen[i])) return i;
  const stueck = [];
  let j = i;
  while (j < zeilen.length && (RE_EINZUG.test(zeilen[j]) || !zeilen[j].trim())) {
    stueck.push(zeilen[j].replace(/^(?: {4}|\t)/, ""));
    j++;
  }
  while (stueck.length && !stueck[stueck.length - 1].trim()) {
    stueck.pop();
    j--;
  }
  aus.push(codeBlockHtml(stueck.join("\n"), ""));
  return j;
}

function kommentarLesen(zeilen, i, aus) {
  if (!RE_KOMMENTAR_AUF.test(zeilen[i])) return i;
  const stueck = [];
  let j = i;
  while (j < zeilen.length) {
    stueck.push(zeilen[j]);
    const fertig = RE_KOMMENTAR_ZU.test(zeilen[j]);
    j++;
    if (fertig) break;
  }
  const innen = stueck.join("\n").replace(/^\s*&lt;!--/, "").replace(/--&gt;\s*$/, "").trim();
  aus.push('<div class="md-kommentar"><pre style="overflow-x:auto">' + innen + "</pre></div>");
  return j;
}

function zitatLesen(zeilen, i, aus, o, tiefe) {
  if (!RE_ZITAT.test(zeilen[i])) return i;
  const innen = [];
  let j = i;
  while (j < zeilen.length && RE_ZITAT.test(zeilen[j])) {
    innen.push(zeilen[j].replace(RE_ZITAT, ""));
    j++;
  }
  aus.push('<blockquote class="md-zitat">' + bloeckeHtml(innen, o, tiefe + 1) + "</blockquote>");
  return j;
}

function ueberschriftLesen(zeilen, i, aus, o) {
  const m = RE_UEBERSCHRIFT.exec(zeilen[i]);
  if (!m) return i;
  const stufe = m[1].length;
  aus.push("<h" + stufe + ' class="md-h' + stufe + '">' + inlineHtml(m[2], o) + "</h" + stufe + ">");
  return i + 1;
}

function trennlinieLesen(zeilen, i, aus) {
  if (!RE_TRENN.test(zeilen[i])) return i;
  aus.push('<hr class="md-trenner">');
  return i + 1;
}

// ---------------------------------------------------------------------------
// 7. Tabellen (GFM-Pipe)
// ---------------------------------------------------------------------------
function zellenTeilen(zeile) {
  const s = String(zeile);
  const zellen = [];
  let akt = "";
  let zaun = 0;
  let i = 0;
  while (i < s.length) {
    const c = s.charAt(i);
    if (c === "\\" && s.charAt(i + 1) === "|") {
      akt += "|";
      i += 2;
      continue;
    }
    if (c === "`") {
      let n = 0;
      while (s.charAt(i + n) === "`") n++;
      zaun = zaun === 0 ? n : zaun === n ? 0 : zaun;
      akt += s.substr(i, n);
      i += n;
      continue;
    }
    if (c === "|" && zaun === 0) {
      zellen.push(akt);
      akt = "";
      i++;
      continue;
    }
    akt += c;
    i++;
  }
  zellen.push(akt);
  const rand = s.trim();
  if (rand.charAt(0) === "|") zellen.shift();
  if (zellen.length && rand.charAt(rand.length - 1) === "|") zellen.pop();
  return zellen.map(function (z) {
    return z.trim();
  });
}

function ausrichtung(zelle) {
  const t = zelle.trim();
  const links = t.charAt(0) === ":";
  const rechts = t.charAt(t.length - 1) === ":";
  if (links && rechts) return "center";
  if (rechts) return "right";
  if (links) return "left";
  return "";
}

function stilAusrichtung(a) {
  return a ? ' style="text-align:' + a + '"' : "";
}

function tabellenZeile(zellen, spalten, richtungen, tag, o) {
  const stuecke = [];
  for (let n = 0; n < spalten; n++) {
    const inhalt = zellen[n] == null ? "" : zellen[n];
    stuecke.push("<" + tag + stilAusrichtung(richtungen[n]) + ">" + inlineHtml(inhalt, o) + "</" + tag + ">");
  }
  return "<tr>" + stuecke.join("") + "</tr>";
}

function tabelleLesen(zeilen, i, aus, o) {
  if (!istTabellenKopf(zeilen, i)) return i;
  const kopf = zellenTeilen(zeilen[i]);
  const richtungen = zellenTeilen(zeilen[i + 1]).map(ausrichtung);
  const koerper = [];
  let j = i + 2;
  while (j < zeilen.length && zeilen[j].trim() && zeilen[j].indexOf("|") !== -1) {
    koerper.push(zellenTeilen(zeilen[j]));
    j++;
  }
  const zeilenHtml = koerper.map(function (r) {
    return tabellenZeile(r, kopf.length, richtungen, "td", o);
  });
  aus.push(
    '<div class="md-tabelle-huelle" style="overflow-x:auto"><table class="md-tabelle"><thead>' +
      tabellenZeile(kopf, kopf.length, richtungen, "th", o) +
      "</thead><tbody>" +
      zeilenHtml.join("") +
      "</tbody></table></div>"
  );
  return j;
}

// ---------------------------------------------------------------------------
// 8. Listen (ul/ol, verschachtelt, mit Aufgabenkaestchen)
// ---------------------------------------------------------------------------
function naechsteNichtLeer(zeilen, von) {
  for (let i = von; i < zeilen.length; i++) {
    if (zeilen[i].trim()) return i;
  }
  return -1;
}

function punktHtml(punkt, o) {
  const kasten = RE_KASTEN.exec(punkt.text);
  let vorn = "";
  let text = punkt.text;
  if (kasten) {
    const an = kasten[1].toLowerCase() === "x";
    vorn = '<span class="md-kasten' + (an ? " md-kasten-an" : "") + '">' + (an ? "&#9745;" : "&#9744;") + "</span> ";
    text = punkt.text.slice(kasten[0].length);
  }
  return vorn + inlineHtml(text, o) + punkt.kinder.join("");
}

function listeHtml(punkte, geordnet, o) {
  const tag = geordnet ? "ol" : "ul";
  const stuecke = punkte.map(function (p) {
    return "<li>" + punktHtml(p, o) + "</li>";
  });
  return "<" + tag + ' class="md-liste">' + stuecke.join("") + "</" + tag + ">";
}

function listeBauen(zeilen, start, einzug, o, tiefe) {
  const geordnet = /\d/.test(RE_PUNKT.exec(zeilen[start])[2]);
  const punkte = [];
  let i = start;
  while (i < zeilen.length) {
    if (!zeilen[i].trim()) {
      const weiter = naechsteNichtLeer(zeilen, i + 1);
      const m = weiter === -1 ? null : RE_PUNKT.exec(zeilen[weiter]);
      if (!m || m[1].length < einzug) break;
      i = weiter;
      continue;
    }
    const m = RE_PUNKT.exec(zeilen[i]);
    if (m) {
      const ind = m[1].length;
      if (ind < einzug) break;
      if (ind >= einzug + 2 && punkte.length && tiefe < TIEFE_MAX) {
        const unter = listeBauen(zeilen, i, ind, o, tiefe + 1);
        punkte[punkte.length - 1].kinder.push(unter.html);
        i = unter.ende;
        continue;
      }
      punkte.push({ text: m[3], kinder: [] });
      i++;
      continue;
    }
    if (punkte.length && zeilen[i].search(/\S/) >= einzug + 2) {
      punkte[punkte.length - 1].text += "\n" + zeilen[i].trim();
      i++;
      continue;
    }
    break;
  }
  return { html: listeHtml(punkte, geordnet, o), ende: i };
}

function listeLesen(zeilen, i, aus, o, tiefe) {
  const m = RE_PUNKT.exec(zeilen[i]);
  if (!m || m[1].length > 3) return i;
  const ergebnis = listeBauen(zeilen, i, m[1].length, o, tiefe);
  aus.push(ergebnis.html);
  return ergebnis.ende;
}

// ---------------------------------------------------------------------------
// 9. Absatz und der Blockparser selbst
// ---------------------------------------------------------------------------
function absatzLesen(zeilen, i, aus, o) {
  const stueck = [];
  let j = i;
  while (j < zeilen.length && zeilen[j].trim()) {
    if (j > i && istBlockStart(zeilen, j)) break;
    stueck.push(zeilen[j].trim());
    j++;
  }
  if (!stueck.length) return i + 1; // Sicherung: der Index muss immer wachsen
  aus.push('<p class="md-absatz">' + inlineHtml(stueck.join("\n"), o) + "</p>");
  return j;
}

function bloeckeHtml(zeilen, o, tiefe) {
  const aus = [];
  let i = 0;
  let n = 0;
  while (i < zeilen.length) {
    if (!zeilen[i].trim()) {
      i++;
      continue;
    }
    if ((n = zaunLesen(zeilen, i, aus)) > i) { i = n; continue; }
    if ((n = kommentarLesen(zeilen, i, aus)) > i) { i = n; continue; }
    if (tiefe < TIEFE_MAX && (n = zitatLesen(zeilen, i, aus, o, tiefe)) > i) { i = n; continue; }
    if ((n = ueberschriftLesen(zeilen, i, aus, o)) > i) { i = n; continue; }
    if ((n = trennlinieLesen(zeilen, i, aus)) > i) { i = n; continue; }
    if ((n = tabelleLesen(zeilen, i, aus, o)) > i) { i = n; continue; }
    if ((n = listeLesen(zeilen, i, aus, o, tiefe)) > i) { i = n; continue; }
    if ((n = codeEinzugLesen(zeilen, i, aus)) > i) { i = n; continue; }
    i = absatzLesen(zeilen, i, aus, o);
  }
  return aus.join("\n");
}

// ---------------------------------------------------------------------------
// 10. Einstieg
// ---------------------------------------------------------------------------
function frontmatterAbziehen(zeilen) {
  if (!zeilen.length || zeilen[0].trim() !== "---") return zeilen;
  for (let i = 1; i < zeilen.length; i++) {
    if (zeilen[i].trim() === "---") return zeilen.slice(i + 1);
  }
  return zeilen;
}

// Fuehrende Tabulatoren zu vier Leerzeichen: Einrueckung ist hier eine Zahl
// (Listentiefe, Codeblock), und ein Tabulator waere sonst eine 1.
function tabsWeiten(zeile) {
  const m = /^[ \t]+/.exec(zeile);
  if (!m) return zeile;
  return m[0].split("\t").join("    ") + zeile.slice(m[0].length);
}

function markdownZuHtml(text, opts) {
  const o = optionen(opts);
  const roh = String(text == null ? "" : text).replace(STEUERZEICHEN, "");
  const zeilen = escapeHtml(roh).split(/\r\n?|\n/).map(tabsWeiten);
  return bloeckeHtml(frontmatterAbziehen(zeilen), o, 0);
}

const AUSSEN = { markdownZuHtml, escapeHtml };

if (typeof module !== "undefined" && module.exports) module.exports = AUSSEN;
if (typeof window !== "undefined") {
  window.HD = window.HD || {};
  window.HD.markdown = AUSSEN;
}
