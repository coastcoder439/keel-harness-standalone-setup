#!/usr/bin/env node
"use strict";

// SessionStart: startet das installierte Dashboard, falls es nicht läuft (harness-core/dashboard/ensure-dashboard.mjs).
// Endet immer binnen 3 s mit Exitcode 0 und blockiert nie den Sitzungsstart.
const path = require("node:path");
const { pathToFileURL } = require("node:url");

setTimeout(() => process.exit(0), 2500).unref();
import(pathToFileURL(path.join(__dirname, "..", "harness-core", "dashboard", "ensure-dashboard.mjs")).href)
  .then((module) => module.main())
  .catch((error) => { process.stderr.write("dashboard-ensure: " + (error && error.message || error) + "\n"); process.exitCode = 0; });
