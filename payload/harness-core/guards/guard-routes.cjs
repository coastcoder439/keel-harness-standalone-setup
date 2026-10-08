"use strict";

// The allowed way of every block code of every guard (package P6, D17). One table for two readers:
//   - the guards add one line to each denial that points at the entry of the command index,
//     so the agent learns the way from the denial and from the index in the same words;
//   - the command index (command-index.mjs) prints it as "Sperre -> Weg" and checks that every
//     entry it points at exists, so a way the index does not list cannot be named here.
// A code that a guard blocks with and that is missing here fails test/command-index.test.js: that test
// reads the codes out of the guard sources (the same way test/guard-single-source.test.js does for
// docs/guard-scope.md) and demands a row for each one, and the other way round.
//
// A row is [section, entry, way]. Section and entry name an entry of the index ("Abschnitt Git ->
// checkpoint"); the way is the shortest honest sentence for what the agent does instead. The text is
// ASCII only: Codex runs hooks through Windows PowerShell, which re-encodes anything else.

const SECTIONS = Object.freeze({
  read: "Lesen",
  write: "Schreiben",
  test: "Testen",
  git: "Git",
  package: "Paket und Executor",
  publish: "Veroeffentlichen",
  measure: "Messen",
  temp: "Temp-Ordner",
  owner: "Owner",
});

const row = (section, entry, way) => Object.freeze([section, entry, way]);

const FORM = (way) => row(SECTIONS.read, "Befehlsform", way);
const EXEC = (way) => row(SECTIONS.test, "Pruefer und Werkzeuge", way);
const WRITE = (way) => row(SECTIONS.write, "Write/Edit", way);
const BUNDLE = (way) => row(SECTIONS.write, "Buendel und Belege", way);
const OWNER = (entry, way) => row(SECTIONS.owner, entry, way);
const GIT = (entry, way) => row(SECTIONS.git, entry, way);
const BINDING = (way) => row(SECTIONS.package, "Bindung", way);

const O1 = OWNER("O1", "Zerstoerung und Schreiben ausserhalb des Arbeitsbereichs macht nur der Owner; der Agent meldet die Sperre unter Offen:");

const ROUTES = Object.freeze({
  "git-intent-guard": {
    inspect: GIT("inspect", "den Git-Stand ueber den Intent inspect lesen, nicht mit -c, --ext-diff oder --output"),
    checkpoint: GIT("checkpoint", "sichern ueber den Intent checkpoint statt git add und git commit"),
    unstage: GIT("unstage", "Index zuruecknehmen ueber den Intent unstage"),
    "discard-working": GIT("discard-working", "Arbeitsbaum verwerfen nur ueber discard-working mit Recovery-Beleg"),
    "revert-checkpoint": GIT("revert-checkpoint", "den letzten eigenen Checkpoint zuruecknehmen ueber revert-checkpoint"),
    "integration-checkpoint": GIT("integration-checkpoint", "zusammenfuehren ueber den Intent integration-checkpoint"),
    "plan-publish": row(SECTIONS.publish, "Projekt aus publishProjects",
      "git push ersetzt plan-publish, dann publish; fuer ein anderes Repo erst Paketabschluss und Owner-OK im Chat"),
    explain: OWNER("O2", "breite Historienumschreibung und nicht rueckholbares Loeschen entscheidet der Owner; der Agent meldet die Sperre unter Offen:"),
    maintain: GIT("Git-Pflege", "nur die Formen der Git-Pflege, direkt und in der Sitzung ohne Bindung an einen Arbeitsschritt; ein gebundener Schritt sichert ueber checkpoint"),
    WAVE_IN_PROGRESS: GIT("Git-Pflege", "warten, bis die Arbeitsagenten zurueck sind und integrate die Welle abgeschlossen hat; dann denselben Befehl erneut"),
  },
  "shell-mutation-guard": {
    ENVIRONMENT_OVERRIDE: FORM("den Befehl ohne Umgebungsvariable davor ausfuehren"),
    DYNAMIC_WRAPPER: FORM("den Befehl direkt ausfuehren, ohne env, xargs oder berechneten Namen"),
    SHELL_WRAPPER: FORM("den Befehl direkt im Bash- oder PowerShell-Werkzeug ausfuehren, ohne bash -c oder cmd /c"),
    UNCLASSIFIED_GIT: GIT("explain", "Git nur ueber harness-core/git/git-intent.mjs"),
    INTERPRETER_EXECUTION: EXEC("deklarierte Pruefer, Tests und Werkzeuge statt eines Interpreters"),
    INLINE_INTERPRETER: EXEC("Code in eine Datei im OWNS schreiben und als Test unter test/ ausfuehren, nie node -e"),
    NODE_PRELOAD: EXEC("node ohne --require, --import oder --loader"),
    NODE_CHECK_FORM: row(SECTIONS.test, "Selbsttest", "node --check mit genau einer Datei"),
    UNDECLARED_TEST: row(SECTIONS.test, "node --test", "Testdateien direkt in test/ mit den freigegebenen Schaltern"),
    NODE_SCRIPT_REQUIRED: EXEC("node mit einem deklarierten Skript"),
    SERVICE_ARGUMENTS: row(SECTIONS.test, "Dashboard-Dienst", "den Dienst nur mit --port <n> und den Sprach-Schaltern starten"),
    UNDECLARED_NODE_SCRIPT: EXEC("deklarierte Pruefer und Werkzeuge; lesend: package-cli doctor, status, lint, list, measure"),
    UNDECLARED_EXECUTABLE: EXEC("ein Befehl aus der Freigabeliste (Lesen, Pruefer, Paketwerkzeuge)"),
    DYNAMIC_EVALUATION: FORM("den Befehl ausgeschrieben angeben, ohne Ersetzung, Erweiterung oder berechneten Namen"),
    POWERSHELL_PARSE: FORM("den Befehl syntaktisch korrekt schreiben oder in einfache Befehle teilen"),
    DIRECT_SHELL_WRITE: WRITE("Dateien mit Write/Edit im OWNS schreiben; im Temp-Ordner der Sitzung darf die Shell schreiben"),
    READ_COMMAND_ESCALATION: row(SECTIONS.read, "Lesebefehle ohne Schalter", "den Lesebefehl ohne schreibende Schalter; awk nur lesend"),
    OUTPUT_REDIRECTION: WRITE("Write/Edit statt > und >>; Ausgabe nur in den Temp-Ordner der Sitzung"),
    PACKAGE_SCRIPT_RUNNER: EXEC("im gebundenen Schritt die deklarierten Pruefer direkt; installieren, bauen und testen mit npm macht die Sitzung ohne Bindung"),
    PROJECT_TOOL_FORM: row(SECTIONS.test, "Projektwerkzeuge", "install/ci mit --ignore-scripts ohne Paketnamen und -g, run <Skript aus package.json>, npx <node_modules/.bin>; --write, --fix, format, codemod nur gebunden (Kleinpaket oder Leaf)"),
    PACKAGE_TOOL_UNBOUND: row(SECTIONS.package, "Paket-Werkzeuge", "package-standard create mit --session der eigenen Sitzung; sonst --root und --package des gebundenen Buendels"),
    PACKAGE_TOOL_OVERRIDE: row(SECTIONS.package, "Paket-Werkzeuge", "das Paketwerkzeug ohne --unlazy aufrufen"),
    FOREIGN_PROCESS: row(SECTIONS.measure, "Prozess beenden", "nur Prozesse beenden, die Dateien dieser Installation ausfuehren; jeden anderen unter Offen: melden"),
    INSTALLER_ARGUMENTS: row(SECTIONS.package, "Installer", "install.mjs mit install, status oder doctor und --target gleich der Installationswurzel"),
    POLICY_INVALID: OWNER("O3", "die Politikdatei .claude/mutation-policy.json repariert nur der Owner; der Agent meldet die Sperre unter Offen:"),
  },
  "danger-guard": {
    "rm mit Wucht auf Heimat oder Wurzel": O1,
    "rm -rf auf die Werkbank-Wurzel": O1,
    "Schreiben oder Loeschen ausserhalb des Arbeitsbereichs": O1,
    "rm -r auf einen Systempfad": O1,
    "Geraete-Schreibzugriff / Dateisystem formatieren": O1,
    "Rechte flaechendeckend aufreissen": O1,
    "Loeschen mit Systemrechten": O1,
    "Destruktives im Interpreter-Umweg (-c/-e)": O1,
  },
  "write-guard": {
    W1: O1,
    W2: OWNER("O4", "Zugangsdaten legt nur der Owner an; sie stehen nie in einer Datei oder einem Befehl im Chat"),
    W3: WRITE("erst das Projekt-Repo anlegen und verifiziert sichern, danach die Ignorier-Zeile schreiben"),
    W4: OWNER("O3", "die Politikdatei .claude/mutation-policy.json aendert nur der Owner; der Agent meldet die Sperre unter Offen:"),
    W5: OWNER("O6", "Harness-Dateien einer Installation aendert nur Release plus Harness-Update nach dem OK des Owners (O6)"),
    GIT_INTERNALS: OWNER("Offen melden", "kein Agentenweg: .git/config und .git/hooks aendert allein der Owner; die Sperre unter Offen: melden"),
    HARNESS_STATE_WRITE: row(SECTIONS.package, "Executor", "Pruefergebnisse entstehen durch gate-check, der Executor-Zustand durch package-executor; nie von Hand schreiben"),
    HOST_TRANSCRIPT_WRITE: OWNER("Offen melden", "kein Agentenweg: das Transkript schreibt allein der Host; eine fremde Bindung nur mit package-bootstrap begin --takeover"),
  },
  "paket-gate": {
    MISSING_SESSION: BINDING("Arbeit ueber den Package-Executor mit gebundener Sitzung (next, start, dispatch)"),
    MISSING_OR_STALE_BINDING: BINDING("die Bindung ueber den Package-Executor (next, start, dispatch) neu setzen"),
    OUTSIDE_REPOSITORY: WRITE("nur im gebundenen Repository schreiben"),
    OUTSIDE_LEAF_OWNS: WRITE("nur im eigenen Leaf-OWNS schreiben; andere Pfade gehoeren ihrem Leaf"),
    BOOTSTRAP_ENDED: BINDING("Leaf-Bindung ueber den Package-Executor; Belege und Berichte schreibt die Planungs- oder Orchestrator-Sitzung"),
    OUTSIDE_BOOTSTRAP_PACKAGE: BUNDLE("nur im eigenen Buendel docs/packages/<packageId>/ schreiben"),
    BOOTSTRAP_FILE: BUNDLE("nur die Buendel-Dateien des Paket-Schemas anlegen"),
    BOOTSTRAP_LINK: BUNDLE("Ziele ohne Link oder Verbindungspunkt schreiben"),
    AMEND_OWNER_IMMUTABLE: BUNDLE("eine neue Anforderung als weitere R-Zeile anhaengen, den Originalauftrag nie aendern"),
    OUTSIDE_AMEND_PACKAGE: BUNDLE("nur im geaenderten Buendel schreiben"),
    AMEND_LINK: BUNDLE("Ziele ohne Link oder Verbindungspunkt schreiben"),
    AMEND_STALE: BUNDLE("die Aenderung neu binden"),
    LEAF_RUNNING: BINDING("warten, bis der Arbeitsagent des Leaf zurueck ist (return, integrate), oder die Aenderung diesem Leaf ueberlassen"),
  },
  "mcp-write-guard": {
    POLICY_INVALID: OWNER("O3", "die Politikdatei .claude/mutation-policy.json repariert nur der Owner; der Agent meldet die Sperre unter Offen:"),
    MCP_WRITE_UNDECLARED: OWNER("O3", "ein schreibendes MCP-Werkzeug braucht die Freigabe des Owners in mcpWriteTools.allow; lesende Werkzeuge sind frei"),
    MCP_SHELL_SURFACE: FORM("das Bash- oder PowerShell-Werkzeug nehmen, nicht ein Terminal ueber MCP"),
    MCP_LOCAL_FILE_UNBOUND: WRITE("lokale Dateien mit Write/Edit schreiben (paket-gate prueft dasselbe Ziel), Produktdateien ueber einen Arbeitsschritt; ausserhalb jedes Repositorys frei"),
    SELF_MOVE: OWNER("Offen melden", "in der eigenen Sitzung im Arbeitsordner bleiben; Arbeit an einem anderen Ort geht ueber einen Arbeitsauftrag"),
  },
  "sessionpost-guard": {
    "Senden abgestellt": row(SECTIONS.write, "Sitzungsnotiz", "den Befund als Notiz in docs/session-notes/<rolle>.md ablegen (/tell-session)"),
  },
  "dod-guard": {
    Abschlussformat: row(SECTIONS.write, "Abschlussmeldung", "die Meldung mit Geprueft gegen: und Offen: beenden"),
  },
  "apply-patch-guard": {
    NOT_APPLY_PATCH: WRITE("apply_patch im gueltigen Format"),
    INVALID_PATCH: WRITE("einen gueltigen, eindeutig zerlegbaren Patch senden"),
    PACKAGE_OWNS: WRITE("nur im eigenen Leaf-OWNS schreiben"),
    WRITE_POLICY: WRITE("es gilt der Weg der jeweiligen W-Regel des write-guard"),
  },
});

const LOOKUP = "node harness-core/guards/command-index.mjs --section ";

// The guards whose decisions another guard passes on: the Codex patch guard hands a target to paket-gate and
// write-guard and returns their code unchanged, so a code it does not own is looked up there.
const PASSES_ON = Object.freeze({ "apply-patch-guard": ["paket-gate", "write-guard"] });

// { section, entry, way } of a block code, or null.
function route(guard, code) {
  const name = String(guard || "").replace(/^.*[\\/]/u, "").replace(/\.c?js$/u, "");
  for (const owner of [name, ...(PASSES_ON[name] || [])]) {
    const table = ROUTES[owner];
    const found = table && Object.hasOwn(table, String(code)) ? table[String(code)] : null;
    if (found) return { section: found[0], entry: found[1], way: found[2] };
  }
  return null;
}

// The line a denial carries: where to look in the command index and the way itself. A code without a row
// still points at the whole index, so a denial never ends without a way to look it up.
function referenceLine(guard, code) {
  const found = route(guard, code);
  if (!found) return "Weg: siehe Befehlsindex (node harness-core/guards/command-index.mjs --full), Abschnitt Sperren";
  return "Weg: siehe Befehlsindex, Abschnitt " + found.section + " -> " + found.entry + " - " + found.way +
    ". Nachschlagen: " + LOOKUP + JSON.stringify(found.section);
}

module.exports = { ROUTES, SECTIONS, referenceLine, route };
