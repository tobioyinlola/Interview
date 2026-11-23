"use strict";
// Pure rules about what the desktop window may open or capture. No Electron here, so they are
// unit-tested on any machine.

/** The origin (scheme + host + port) of a URL, or null when it is not a URL. */
function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Is this address part of the app itself? */
function isAppUrl(url, appOrigin) {
  const o = originOf(url);
  return o !== null && o === appOrigin;
}

/** What to do with a link or navigation:
 *  - "allow": stay in the app window (it is the app's own address)
 *  - "external": open in the person's normal browser (https and mail links only)
 *  - "deny": do nothing (file:, javascript:, custom schemes, malformed) */
function navigationDecision(url, appOrigin) {
  if (isAppUrl(url, appOrigin)) return "allow";
  try {
    const u = new URL(url);
    if (u.protocol === "https:" || u.protocol === "mailto:") return "external";
  } catch {
    /* fall through */
  }
  return "deny";
}

const ALLOWED_PERMISSIONS = new Set(["media", "display-capture", "clipboard-sanitized-write"]);

/** Only the app's own pages may use the microphone or capture audio. */
function permissionAllowed(permission, requestUrl, appOrigin) {
  return ALLOWED_PERMISSIONS.has(permission) && isAppUrl(requestUrl, appOrigin);
}

/** A frame may start a screen/audio capture only when it belongs to the app. */
function captureAllowed(frameUrl, appOrigin) {
  return isAppUrl(frameUrl, appOrigin);
}

/** The app address from the environment or a config file; always https unless it is localhost. */
function resolveAppUrl(env, fileConfig, fallback) {
  const raw = (env && env.INTERVIEWMEET_URL) || (fileConfig && fileConfig.appUrl) || fallback;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return fallback;
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return fallback;
  return u.origin + (u.pathname === "/" ? "" : u.pathname);
}

module.exports = {
  originOf,
  isAppUrl,
  navigationDecision,
  permissionAllowed,
  captureAllowed,
  resolveAppUrl,
};
