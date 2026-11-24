"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { resolveAppUrl, originOf } = require("./policy");
const { ORIGIN } = require("./protocol");

// The website and API. Change it at build time in app-config.json, or when running with the
// INTERVIEWMEET_URL environment variable (handy for a staging site). The interface itself is inside
// the app; this is only where Google sign-in starts and where the API lives.
const FALLBACK = "https://frontend-dev-2d437f97.up.railway.app";

function load() {
  let file = null;
  try {
    file = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "app-config.json"), "utf8"));
  } catch {
    file = null;
  }
  const siteUrl = resolveAppUrl(process.env, file, FALLBACK);
  // For developing the interface: INTERVIEWMEET_DEV_URL (for example http://localhost:5173) loads
  // that address instead of the packed copy.
  const dev = process.env.INTERVIEWMEET_DEV_URL
    ? resolveAppUrl({ INTERVIEWMEET_URL: process.env.INTERVIEWMEET_DEV_URL }, null, null)
    : null;
  const appUrl = dev || `${ORIGIN}/`;
  return {
    siteUrl,
    siteOrigin: originOf(siteUrl),
    appUrl,
    appOrigin: originOf(appUrl),
    packed: !dev,
  };
}

module.exports = { load, FALLBACK };
