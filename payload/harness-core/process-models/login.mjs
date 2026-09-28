// Abo-Erkennung „installiert und angemeldet“ ohne Modellaufruf (design/process-models.md Punkt 5).
//
// Angemeldet heißt: `claude auth status` liefert JSON mit loggedIn: true, bzw. `codex login status`
// endet mit Code 0 und meldet „Logged in“. Zeitlimit 5 s je Befehl, Ergebnis 5 Minuten
// zwischengespeichert. Konto-Angaben (E-Mail, Organisation) werden weder gespeichert noch
// zurückgegeben. Der Aufrufweg eines Prozesses liest nur den Zwischenspeicher und startet nie
// selbst eine CLI.

import childProcess from "node:child_process";

export const LOGIN_CACHE_MS = 5 * 60 * 1000;
export const LOGIN_TIMEOUT_MS = 5_000;
const ARGS = { claude: ["auth", "status"], codex: ["login", "status"] };
const cache = new Map();

function run(executable, args, { spawn, timeoutMs }) {
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    let child;
    const finish = (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => { try { child?.kill(); } catch { /* gone */ } finish({ code: null, output, timedOut: true }); }, timeoutMs);
    try {
      child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      finish({ code: null, output: "", error });
      return;
    }
    const collect = (chunk) => { if (output.length < 16_384) output += String(chunk); };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.on("error", (error) => finish({ code: null, output, error }));
    child.on("close", (code) => finish({ code, output }));
  });
}

/** Wertet die Ausgabe der Statusbefehle aus; nur true/false/null, keine Konto-Angaben. */
export function parseLoginStatus(provider, { code, output, timedOut, error }) {
  const label = provider === "claude" ? "Claude" : "Codex";
  if (timedOut) return { signedIn: null, reason: `Anmeldung bei ${label} konnte nicht geprüft werden (Zeitlimit)` };
  if (error) return { signedIn: null, reason: `Anmeldung bei ${label} konnte nicht geprüft werden` };
  if (provider === "claude") {
    try {
      const value = JSON.parse(String(output).trim());
      if (value && typeof value === "object" && typeof value.loggedIn === "boolean") return value.loggedIn ? { signedIn: true } : { signedIn: false, reason: `Bei ${label} nicht angemeldet` };
    } catch { /* keine JSON-Ausgabe */ }
    return code === 0 ? { signedIn: null, reason: `Anmeldung bei ${label} konnte nicht gelesen werden` } : { signedIn: false, reason: `Bei ${label} nicht angemeldet` };
  }
  if (code === 0 && /logged in/iu.test(String(output)) && !/not logged in/iu.test(String(output))) return { signedIn: true };
  return { signedIn: false, reason: `Bei ${label} nicht angemeldet` };
}

/**
 * Erkennt, ob die CLI eines Anbieters installiert und angemeldet ist. `executable` ist der vom
 * Aufrufer gefundene Pfad (oder leer = nicht installiert).
 */
export async function detectProviderLogin(provider, executable, { spawn = (...args) => childProcess.spawn(...args), timeoutMs = LOGIN_TIMEOUT_MS, now = Date.now(), fresh = false } = {}) {
  const label = provider === "claude" ? "Claude" : "Codex";
  if (!executable) return { installed: false, signedIn: false, reason: `${label} CLI nicht installiert` };
  const cached = cache.get(provider);
  if (!fresh && cached && cached.executable === executable && now - cached.at < LOGIN_CACHE_MS) return cached.result;
  const result = { installed: true, ...parseLoginStatus(provider, await run(executable, ARGS[provider], { spawn, timeoutMs })) };
  cache.set(provider, { at: now, executable, result });
  return result;
}

/** Nur der Zwischenspeicher; nie ein CLI-Start. undefined, wenn noch nicht oder nicht mehr bekannt. */
export function cachedProviderLogin(provider, { now = Date.now() } = {}) {
  const cached = cache.get(provider);
  return cached && now - cached.at < LOGIN_CACHE_MS ? cached.result : undefined;
}

export function forgetProviderLogins() {
  cache.clear();
}
