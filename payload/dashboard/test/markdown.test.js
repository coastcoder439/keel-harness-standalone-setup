// Test zu render/markdown.js -- node --test dashboard/test/markdown.test.js
//
// Der erste Block ist der wichtigste: was aus einer Harness-Datei kommt, darf
// NIE als Element im Ergebnis landen. Alles andere ist Umfang aus Abschnitt 5.4.

const test = require("node:test");
const assert = require("node:assert");

const { markdownZuHtml, escapeHtml } = require("../render/markdown.js");

const OHNE = {}; // ohne Optionen: kein Ziel existiert

function mit(dateien, basisPfad) {
  return {
    basisPfad: basisPfad || "",
    dateiExistiert: (p) => dateien.indexOf(p) !== -1,
  };
}

// ---------------------------------------------------------------------------
// Sicherheit
// ---------------------------------------------------------------------------
test("ein script-Tag erscheint als Text, nicht als Element", () => {
  const quelle = [
    "# Kopf mit <script>alert(1)</script>",
    "",
    "Ein Absatz mit <script>alert(2)</script> und <img src=x onerror=alert(3)>.",
    "",
    "```html",
    "<script>alert(4)</script>",
    "```",
    "",
    "Inline: `<script>alert(5)</script>`",
    "",
    "> Im Zitat: <script>alert(6)</script>",
    "",
    "| A | B |",
    "|---|---|",
    "| <script>alert(7)</script> | x |",
  ].join("\n");
  const html = markdownZuHtml(quelle, OHNE);
  assert.ok(!/<script/i.test(html), "offenes script-Tag im Ergebnis");
  assert.ok(!/<\/script/i.test(html), "schliessendes script-Tag im Ergebnis");
  assert.ok(!/<img/i.test(html), "img-Tag im Ergebnis");
  // "onerror" darf als TEXT vorkommen -- verboten ist es nur in einem Tag.
  assert.ok(!/<[a-z][^>]*onerror/i.test(html), "Ereignis-Attribut an einem Element");
  assert.match(html, /&lt;img src=x onerror=alert\(3\)&gt;/, "img nicht als Text sichtbar");
  // Jedes script-Tag der Quelle muss als escapter Text wieder auftauchen --
  // die Zahl wird aus der Quelle gemessen, nicht in den Test geschrieben.
  const erwartet = (quelle.match(/<script>/g) || []).length;
  assert.strictEqual(erwartet, 6, "Pruefstueck veraendert");
  assert.strictEqual((html.match(/&lt;script&gt;/g) || []).length, erwartet, "nicht jedes script-Tag als Text erhalten");
});

test("javascript-Link wird neutralisiert", () => {
  const html = markdownZuHtml("[klick](javascript:alert(1))", OHNE);
  assert.ok(!/javascript:/i.test(html), "javascript-Schema durchgelassen");
  assert.ok(!/<a\b/.test(html), "es entstand ein Anker");
  assert.match(html, /<span class="link-tot" title="[^"]+">klick<\/span>/);
});

test("weitere Schemata und Sprungmarken sind ebenfalls kein Anker", () => {
  for (const ziel of ["data:text/html,<b>x</b>", "vbscript:x", "file:///C:/x", "//boese.example/x", "#abschnitt"]) {
    const html = markdownZuHtml("[a](" + ziel + ")", OHNE);
    assert.ok(!/<a\b/.test(html), "Anker fuer " + ziel);
    assert.match(html, /class="link-tot"/, "keine Markierung fuer " + ziel);
  }
});

test("escapeHtml deckt die fuenf Zeichen ab", () => {
  assert.strictEqual(escapeHtml('<a href="x">&\'</a>'), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  assert.strictEqual(escapeHtml(null), "");
  assert.strictEqual(escapeHtml(0), "0");
});

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------
test("ein Link auf eine existierende Datei wird zu einem dateien-Anker", () => {
  const o = mit(["docs/completeness-check.md"], ".claude/rules/keel/no-oneshot.md");
  const html = markdownZuHtml("Verwandt: [Vollstaendigkeit](../../../docs/completeness-check.md)", o);
  assert.match(html, /<a class="md-link" href="#dateien\/docs\/completeness-check\.md">Vollstaendigkeit<\/a>/);
});

test("Zeilenmarke am Link wird zu :L<n>", () => {
  const o = mit([".claude/settings.json"], "CLAUDE.md");
  const html = markdownZuHtml("[Zeile](.claude/settings.json#L45)", o);
  assert.match(html, /href="#dateien\/\.claude\/settings\.json:L45"/);
});

test("ein Link auf eine fehlende Datei bekommt link-tot", () => {
  const o = mit([], ".claude/rules/keel/no-oneshot.md");
  const html = markdownZuHtml("[fehlt](docs/gibt-es-nicht.md)", o);
  assert.ok(!/<a\b/.test(html), "toter Link wurde ein Anker");
  assert.match(html, /class="link-tot"/);
  assert.match(html, /title="Ziel fehlt im Harness: \.claude\/rules\/keel\/docs\/gibt-es-nicht\.md"/);
});

test("externe http-Links bekommen target und rel", () => {
  const html = markdownZuHtml("[docs](https://docs.claude.com/de/x?a=1&b=2)", OHNE);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /href="https:\/\/docs\.claude\.com\/de\/x\?a=1&amp;b=2"/);
});

test("Anfuehrungszeichen im Ziel brechen das Attribut nicht auf", () => {
  const html = markdownZuHtml('[x](https://a.example/"onmouseover="alert(1))', OHNE);
  assert.ok(!/onmouseover="alert/.test(html), "Attribut aufgebrochen");
  assert.match(html, /&quot;/);
});

// ---------------------------------------------------------------------------
// Bloecke
// ---------------------------------------------------------------------------
test("verschachtelte Liste korrekt", () => {
  const html = markdownZuHtml(["- a", "  - b1", "  - b2", "- c"].join("\n"), OHNE);
  assert.strictEqual(
    html,
    '<ul class="md-liste"><li>a<ul class="md-liste"><li>b1</li><li>b2</li></ul></li><li>c</li></ul>'
  );
});

test("geordnete Liste und Aufgabenkaestchen", () => {
  const ol = markdownZuHtml(["1. eins", "2. zwei"].join("\n"), OHNE);
  assert.match(ol, /^<ol class="md-liste"><li>eins<\/li><li>zwei<\/li><\/ol>$/);
  const kasten = markdownZuHtml(["- [ ] offen", "- [x] erledigt"].join("\n"), OHNE);
  assert.match(kasten, /<span class="md-kasten">&#9744;<\/span> offen/);
  assert.match(kasten, /<span class="md-kasten md-kasten-an">&#9745;<\/span> erledigt/);
});

test("Tabelle mit 3 Spalten korrekt", () => {
  const html = markdownZuHtml(
    ["| Werkzeug | Wann | Was es tut |", "|---|:-:|--:|", "| `git-guard.js` | vor git | meldet |"].join("\n"),
    OHNE
  );
  assert.match(html, /<table class="md-tabelle">/);
  assert.strictEqual((html.match(/<th[ >]/g) || []).length, 3, "nicht drei Kopfzellen");
  assert.strictEqual((html.match(/<td[ >]/g) || []).length, 3, "nicht drei Koerperzellen");
  assert.match(html, /<th style="text-align:center">Wann<\/th>/);
  assert.match(html, /<th style="text-align:right">Was es tut<\/th>/);
  assert.match(html, /<td><code class="md-code-inline">git-guard\.js<\/code><\/td>/);
  assert.match(html, /overflow-x:auto/);
});

test("Zellen-Trennung achtet auf Code-Spans und literales Pipe", () => {
  const html = markdownZuHtml(["| A | B |", "|---|---|", "| `a \\| b` | c \\| d |"].join("\n"), OHNE);
  assert.strictEqual((html.match(/<td/g) || []).length, 2, "an einem geschuetzten Pipe getrennt");
  assert.match(html, /c \| d/);
});

test("Code-Zaun mit Sprache", () => {
  const html = markdownZuHtml(["```js", "const a = 1 < 2 && 3;", "```"].join("\n"), OHNE);
  assert.match(html, /<pre class="md-code" style="overflow-x:auto" data-sprache="js">/);
  assert.match(html, /<code class="sprache-js">const a = 1 &lt; 2 &amp;&amp; 3;<\/code>/);
  const ohne = markdownZuHtml(["```", "roh", "```"].join("\n"), OHNE);
  assert.match(ohne, /<pre class="md-code" style="overflow-x:auto"><code>roh<\/code><\/pre>/);
});

test("im Code-Zaun wird kein Markdown angewandt", () => {
  const html = markdownZuHtml(["```", "- kein Punkt", "# keine Ueberschrift", "**nicht fett**", "```"].join("\n"), OHNE);
  assert.ok(!/<li>/.test(html) && !/<h1/.test(html) && !/<strong>/.test(html), "Markdown im Code-Zaun angewandt");
});

test("Inline-Code mit spitzen Klammern und Ampersand bleibt escaped", () => {
  const html = markdownZuHtml("Platzhalter `<WORKSPACE>` und `a & b <c>` sowie `**nicht fett**`.", OHNE);
  assert.match(html, /<code class="md-code-inline">&lt;WORKSPACE&gt;<\/code>/);
  assert.match(html, /<code class="md-code-inline">a &amp; b &lt;c&gt;<\/code>/);
  assert.match(html, /<code class="md-code-inline">\*\*nicht fett\*\*<\/code>/);
  assert.ok(!/<strong>/.test(html), "Markdown im Inline-Code angewandt");
});

test("Ueberschriften h1 bis h4, keine h5", () => {
  const html = markdownZuHtml(["# a", "## b", "### c", "#### d", "##### e"].join("\n\n"), OHNE);
  assert.match(html, /<h1 class="md-h1">a<\/h1>/);
  assert.match(html, /<h2 class="md-h2">b<\/h2>/);
  assert.match(html, /<h3 class="md-h3">c<\/h3>/);
  assert.match(html, /<h4 class="md-h4">d<\/h4>/);
  assert.ok(!/<h5/.test(html), "h5 gebaut");
  assert.match(html, /<p class="md-absatz">##### e<\/p>/);
});

test("Blockzitat laeuft rekursiv durch den Blockparser", () => {
  const html = markdownZuHtml(["> **Anlass:** dies und das", "> - ein Punkt", "> - noch einer"].join("\n"), OHNE);
  assert.match(html, /<blockquote class="md-zitat">/);
  assert.match(html, /<strong>Anlass:<\/strong>/);
  assert.strictEqual((html.match(/<li>/g) || []).length, 2, "Liste im Zitat fehlt");
});

test("Frontmatter wird abgezogen, die Setext-Falle faellt weg", () => {
  const html = markdownZuHtml(["---", "name: save-work", "description: sichert", "---", "", "Text"].join("\n"), OHNE);
  assert.ok(!/save-work/.test(html), "Frontmatter im Ergebnis");
  assert.ok(!/<hr/.test(html), "Frontmatter wurde zur Trennlinie");
  assert.strictEqual(html, '<p class="md-absatz">Text</p>');
});

test("Trennlinie und 4-Leerzeichen-Codeblock", () => {
  assert.match(markdownZuHtml("---", OHNE), /<hr class="md-trenner">/);
  assert.match(markdownZuHtml("***", OHNE), /<hr class="md-trenner">/);
  const code = markdownZuHtml(["Ablauf:", "", "    messen -> Daten -> rendern", "    -> Datei"].join("\n"), OHNE);
  assert.match(code, /<pre class="md-code" style="overflow-x:auto"><code>messen -&gt; Daten -&gt; rendern\n-&gt; Datei<\/code><\/pre>/);
});

// ---------------------------------------------------------------------------
// Inline-Feinheiten
// ---------------------------------------------------------------------------
test("fett und kursiv, aber Wort_Wort bleibt unberuehrt", () => {
  const html = markdownZuHtml("**fett** und *kursiv* und _auch kursiv_ neben ANTHROPIC_API_KEY und a_b_c.", OHNE);
  assert.match(html, /<strong>fett<\/strong>/);
  assert.match(html, /<em>kursiv<\/em>/);
  assert.match(html, /<em>auch kursiv<\/em>/);
  assert.match(html, /ANTHROPIC_API_KEY/);
  assert.match(html, /a_b_c/);
  assert.strictEqual((html.match(/<em>/g) || []).length, 2, "zu viele kursive Stellen");
});

test("CRLF und LF ergeben dasselbe Ergebnis", () => {
  const quelle = ["# Kopf", "", "- a", "  - b", "", "> zitat", "", "| x | y |", "|---|---|", "| 1 | 2 |"];
  const lf = markdownZuHtml(quelle.join("\n"), OHNE);
  const crlf = markdownZuHtml(quelle.join("\r\n"), OHNE);
  assert.strictEqual(crlf, lf);
});

test("HTML-Kommentar wird gezeigt, nicht versteckt und nicht ausgefuehrt", () => {
  const html = markdownZuHtml(["<!-- WERKBANK-ZUSATZ", "zwei Zeilen <script>x</script>", "-->"].join("\n"), OHNE);
  assert.match(html, /<div class="md-kommentar">/);
  assert.match(html, /WERKBANK-ZUSATZ/);
  assert.ok(!/<script/i.test(html));
});

test("leere und kaputte Eingaben liefern einen leeren String statt einer Ausnahme", () => {
  assert.strictEqual(markdownZuHtml("", OHNE), "");
  assert.strictEqual(markdownZuHtml(null, OHNE), "");
  assert.strictEqual(markdownZuHtml(undefined), "");
  assert.strictEqual(markdownZuHtml("   \n\n   ", OHNE), "");
  assert.match(markdownZuHtml("```js\nunbeendet", OHNE), /<pre class="md-code"/);
});

test("ein werfender dateiExistiert-Rueckruf bricht das Rendern nicht ab", () => {
  const html = markdownZuHtml("[x](docs/a.md)", {
    basisPfad: "CLAUDE.md",
    dateiExistiert: () => {
      throw new Error("kaputt");
    },
  });
  assert.match(html, /class="link-tot"/);
});
