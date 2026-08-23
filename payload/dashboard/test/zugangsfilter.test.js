// Test zu dashboard/zugangsfilter.js -- Bordmittel, node:test.
//
// DIE MESSLATTE DIESER DATEI
// Ein Filter, der Richtiges unkenntlich macht, wird abgeschaltet und schuetzt
// danach gar nichts. Deshalb stehen hier ZWEI Tabellen nebeneinander: was
// fallen MUSS, und was stehen bleiben MUSS. Eine Verschaerfung ohne ihre
// Gegenprobe zaehlt nicht.
//
// Die Faelle stammen aus einer adversarischen Gegenpruefung am 23.08.2026, die
// sie end-to-end bewiesen hat -- ein echter Bau mit untergeschobenen Zugaengen,
// danach die Suche im Erzeugnis. Ein Fund war als KRITISCH bestaetigt (der
// private Schluessel, von dem nur die Kopfzeile maskiert wurde), vier als hoch.

const test = require("node:test");
const assert = require("node:assert");

const {
  ZUGANGS_MUSTER,
  BLOCK_AUF,
  BLOCK_ZU,
  WERT_FOLGT,
  AUSGEBLENDET,
  MINI_SPERRLISTE,
  textSichern,
  sperrgrund,
} = require("../zugangsfilter.js");

const ZEILENUMBRUCH = String.fromCharCode(10);

// ---------------------------------------------------------------------------
// Export-Vertrag
// ---------------------------------------------------------------------------
test("Export-Vertrag: acht Namen, ZUGANGS_MUSTER als RegExp-Liste ohne g-Flag", () => {
  assert.strictEqual(typeof textSichern, "function");
  assert.strictEqual(typeof sperrgrund, "function");
  assert.strictEqual(AUSGEBLENDET, "[ausgeblendet:zugang]");
  for (const [name, wert] of [["BLOCK_AUF", BLOCK_AUF], ["BLOCK_ZU", BLOCK_ZU], ["WERT_FOLGT", WERT_FOLGT]]) {
    assert.ok(wert instanceof RegExp, name + " ist keine RegExp");
  }
  assert.ok(Array.isArray(ZUGANGS_MUSTER) && Array.isArray(MINI_SPERRLISTE));
  // Keine feste Anzahl: sie braeche bei jeder Verbesserung, ohne etwas ueber
  // das Verhalten zu sagen. Geprueft wird, dass die Liste nicht SCHRUMPFT.
  assert.ok(ZUGANGS_MUSTER.length >= 15, "die Liste ist geschrumpft: " + ZUGANGS_MUSTER.length);
  for (const m of ZUGANGS_MUSTER) {
    assert.ok(m instanceof RegExp, "jedes Muster ist eine RegExp");
    assert.ok(!m.global, "kein g-Flag: lastIndex wuerde test() abwechselnd false liefern lassen");
  }
});

// ---------------------------------------------------------------------------
// sperrgrund -- Riegel 1
// ---------------------------------------------------------------------------
test("die Sperrliste gilt auch dann, wenn git die Datei kennt", () => {
  // Vorher hing sie an !gitVorhanden -- in einem normalen Repo also nie. Eine
  // ungetrackte .env landete damit im Klartext, eine .env.example sogar als
  // getrackte Datei (eine .gitignore nimmt sie mit !.env.example wieder auf).
  assert.strictEqual(sperrgrund(".env", "ungetrackt", true), "sperrliste");
  assert.strictEqual(sperrgrund(".env.example", "getrackt", true), "sperrliste");
  assert.strictEqual(sperrgrund(".claude/settings.local.json", "getrackt", true), "sperrliste");
  assert.strictEqual(sperrgrund("privat.key", "getrackt", true), "sperrliste");
  assert.strictEqual(sperrgrund("cert.pem", "ungetrackt", true), "sperrliste");

  // Gegenprobe: eine gewoehnliche Datei bleibt lesbar.
  assert.strictEqual(sperrgrund("dashboard/index.js", "getrackt", true), null);
  assert.strictEqual(sperrgrund("docs/anleitung.md", "ungetrackt", true), null);

  // Und die git-Sperre gilt weiterhin.
  assert.strictEqual(sperrgrund("beliebig.txt", "ignoriert", true), "ignoriert");
});


test("textSichern normalisiert CRLF und vertraegt Nicht-Strings", () => {
  assert.strictEqual(textSichern("a\r\nb\r\nc").text, "a\nb\nc");
  assert.deepStrictEqual(textSichern(null), { text: "", ausgeblendeteZeilen: [] });
  assert.deepStrictEqual(textSichern(undefined), { text: "", ausgeblendeteZeilen: [] });
  assert.strictEqual(textSichern(42).text, "42");
});


test("privater Schluessel: der ganze Block faellt, nicht nur die Kopfzeile", () => {
  // DER KRITISCHE FUND. Zeilenweises Maskieren traf die Kopfzeile -- und liess
  // den Rumpf stehen, also den Schluessel selbst.
  const schluessel =
    "-----BEGIN RSA PRIVATE KEY-----" + ZEILENUMBRUCH +
    "MIIEowIBAAKCAQEAx7Zk3mQvT2pLnR8sW4dY6bH1cF9gJ0kM5nP3qR7tU2vX8wZ1" + ZEILENUMBRUCH +
    "aB4cD6eF8gH0iJ2kL4mN6oP8qR0sT2uV4wX6yZ8aB0cD2eF4gH6iJ8kL0mN2oP4q" + ZEILENUMBRUCH +
    "-----END RSA PRIVATE KEY-----";
  const r = textSichern(schluessel);
  assert.ok(!r.text.includes("MIIEowIBAAKCAQEA"), "der Schluesselrumpf steht noch im Klartext");
  assert.ok(!r.text.includes("aB4cD6eF8gH0"), "die zweite Rumpfzeile steht noch im Klartext");
  assert.deepStrictEqual(r.ausgeblendeteZeilen, [1, 2, 3, 4], "alle vier Zeilen des Blocks");

  // Gegenprobe: nach dem END geht es normal weiter, der Block frisst nicht den Rest.
  const danach = textSichern(schluessel + ZEILENUMBRUCH + "ein harmloser Satz danach");
  assert.ok(danach.text.includes("ein harmloser Satz danach"), "der Block hat den Text danach verschluckt");
});


test("Wert in der Folgezeile faellt mit -- und ein Kommentar darunter nicht", () => {
  const yaml = "datenbank:" + ZEILENUMBRUCH + "  password:" + ZEILENUMBRUCH + "    Sommer2026!Regen";
  const r = textSichern(yaml);
  assert.ok(!r.text.includes("Sommer2026!Regen"), "der angekuendigte Wert steht noch da");

  // Gegenprobe: eine Erklaerung unter dem Schluesselwort ist kein Geheimnis.
  const mitKommentar = "password:" + ZEILENUMBRUCH + "  # steht in der Umgebung";
  assert.deepStrictEqual(textSichern(mitKommentar).ausgeblendeteZeilen, [], "der Kommentar wurde maskiert");
});


test("Passwoerter mit Satzzeichen fallen -- die alte Wertklasse brach an jedem davon", () => {
  const faelle = [
    ["DB_PASSWORD=Sommer2026!Regen", "Sommer2026!Regen"],
    ['PASSWORD: "S3cr3t!Passphrase"', "S3cr3t!Passphrase"],
    ['db_password: "Tr0ub4dor&3xxxxxxx"', "Tr0ub4dor&3xxxxxxx"],
    ['"password": "p@ssw0rd-with-more-chars"', "p@ssw0rd-with-more-chars"],
    ['MYSQL_ROOT_PASSWORD: "root#1234567890"', "root#1234567890"],
    ['password: "geheim12"', "geheim12"],
  ];
  for (const [zeile, geheim] of faelle) {
    const r = textSichern(zeile);
    assert.ok(!r.text.includes(geheim), "durchgelassen: " + zeile);
  }
});


test("der Schluesselname darf laenger sein als das Schluesselwort", () => {
  // aws_secret_access_key: nach "secret" folgt "_access_key", nicht der Trenner.
  const r = textSichern("aws_secret_access_key = wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY");
  assert.ok(!r.text.includes("wJalrXUtnFEMIK7MDENG"), "durchgelassen");
  const r2 = textSichern("DB_PASSWORD_PROD=Herbst2026Sturm1");
  assert.ok(!r2.text.includes("Herbst2026Sturm1"), "durchgelassen");
});


test("Gegenprobe: der Filter laesst stehen, was kein Geheimnis ist", () => {
  // Diese Zeilen stammen aus dem eigenen Bestand. Wuerde der Filter sie
  // maskieren, waere die eigene Kostenrechnung unlesbar -- und dieses Vorhaben
  // benutzt "Token" im Sinne von LLM-Token an dreissig Stellen.
  const harmlos = [
    "const apiKey = process.env.OPENAI_API_KEY",
    'token: "--status-ok"',
    "token: kontext.tokenSchaetzungJeSitzung || 0",
    "tokenSchaetzung: Math.round(bytes / 3.6)",
    'tokenJeSitzung: "Token je Sitzung"',
    "eigen.token = zahl(zahlen.rulesToken);",
    "// das Passwort steht in der Umgebung",
    "secretsManagerArn: arn:aws:secretsmanager",
    "api_key: YOUR_KEY_HERE",
    "password: null",
  ];
  for (const zeile of harmlos) {
    assert.deepStrictEqual(textSichern(zeile).ausgeblendeteZeilen, [], "faelschlich maskiert: " + zeile);
  }
});


test("die eigene Maskierung loest keinen Alarm aus", () => {
  // Im JSON-Datensatz steht ein Zeilenumbruch als die zwei Zeichen Backslash
  // und n. Hinter "password:" sah das Muster damit den Text
  // \n[ausgeblendet:zugang] als Wert und schlug an -- der Ausgabe-Waechter
  // brach einen Bau ab, dessen Geheimnis laengst ersetzt war.
  const BS = String.fromCharCode(92);
  const wieImJson = 'inhalt: "datenbank:' + BS + 'n  password:' + BS + 'n[ausgeblendet:zugang]' + BS + 'n"';
  assert.deepStrictEqual(textSichern(wieImJson).ausgeblendeteZeilen, [], "die Maskierung alarmiert sich selbst");
});
