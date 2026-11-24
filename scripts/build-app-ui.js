"use strict";
// Builds the web interface in "app" mode and puts it inside an installed app (the phone app's www/
// folder or the desktop app's app-dist/ folder). The apps carry their own copy of the interface so
// they open instantly and work with no internet; only calls to the API need a connection.
//
//   node scripts/build-app-ui.js <folder>        (run from mobile/ or desktop/, or give a full path)
//
// INTERVIEWMEET_URL is the site the API is reached through (the web server forwards /api to it). It
// must be https, except for localhost while developing.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const FALLBACK = "https://frontend-dev-2d437f97.up.railway.app";
const target = path.resolve(process.cwd(), process.argv[2] || "");
if (!process.argv[2]) throw new Error("Usage: build-app-ui.js <folder>");

const raw = process.env.INTERVIEWMEET_URL || FALLBACK;
const url = new URL(raw);
const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
  throw new Error("INTERVIEWMEET_URL must be https");
}

const frontend = path.join(__dirname, "..", "frontend");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
execFileSync(npm, ["run", "build:app"], {
  cwd: frontend,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, VITE_API_BASE_URL: url.origin },
});

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(path.join(frontend, "dist-app"), target, { recursive: true });
console.log(`The app interface (API at ${url.origin}) is in ${target}`);
