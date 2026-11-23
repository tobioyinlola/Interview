"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { resolveAppUrl, originOf } = require("./policy");

// Where the app lives. Change it at build time in app-config.json, or when running with the
// INTERVIEWMEET_URL environment variable (handy for a staging site or http://localhost:5173).
const FALLBACK = "https://frontend-dev-2d437f97.up.railway.app";

function load() {
  let file = null;
  try {
    file = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "app-config.json"), "utf8"));
  } catch {
    file = null;
  }
  const appUrl = resolveAppUrl(process.env, file, FALLBACK);
  return { appUrl, appOrigin: originOf(appUrl) };
}

module.exports = { load, FALLBACK };
