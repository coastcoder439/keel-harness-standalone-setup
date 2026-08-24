#!/usr/bin/env node
// VERLAUF -- die letzten Commits ueber alle Repos hinweg.
//
// WARUM EIGENSTAENDIG
// Diese Messung braucht von measure.js nichts ausser der Repo-Liste, und
// measure.js braucht von ihr nichts ausser dem Ergebnis. Sie lag dort nur aus
// Gewohnheit. Herausgeloest am 23.08.2026, als die Sperrklinke auf measure.js
// zuschlug: die Datei soll kleiner werden, nicht bequemer.
//
// Liefert CODES und Rohwerte, keine deutschen Saetze -- die setzt render/data.js.
//
// AUFRUF   const { verlaufMessen } = require("./history"); verlaufMessen(wurzel, repos)

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");


// ---------------------------------------------------------------------------
// VERLAUF — die letzten Commits je Repo, als Zeitleiste.
//
// Beantwortet "was hat sich veraendert" mit Daten statt mit Gefuehl. Bewusst
// ohne Wertung: die Seite zeigt, WAS passiert ist, nicht ob es gut war.
// ---------------------------------------------------------------------------
function verlaufMessen(wurzel, repos, jeRepo = 4) {
  const eintraege = [];
  for (const r of repos) {
    const ordner = r.name === path.basename(wurzel) ? wurzel : path.join(wurzel, r.name);
    if (!fs.existsSync(path.join(ordner, ".git"))) continue;
    const p = spawnSync("git", ["-C", ordner, "log", `-${jeRepo}`, "--date=iso-strict", "--format=%H%x1f%ad%x1f%s%x1f%an"], {
      encoding: "utf8",
      timeout: 10000,
    });
    if (p.status !== 0 || !p.stdout) continue;
    for (const zeile of p.stdout.trim().split("\n")) {
      const [hash, datum, betreff, autor] = zeile.split("");
      if (!hash) continue;
      eintraege.push({ repo: r.name, hash: hash.slice(0, 7), datum, betreff, autor });
    }
  }
  eintraege.sort((a, b) => (a.datum < b.datum ? 1 : -1));
  return {
    status: eintraege.length ? "ok" : "fehlt",
    grund: eintraege.length ? null : "Kein Git-Verlauf lesbar",
    massnahme: eintraege.length ? null : { text: "Ohne Git gibt es keine Historie — ein Repo anlegen.", befehl: "git init" },
    quelle: "git log je Repo",
    eintraege: eintraege.slice(0, 40),
  };
}

module.exports = { verlaufMessen };
