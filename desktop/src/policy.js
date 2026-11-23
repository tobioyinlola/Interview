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

const SCHEME = "interviewmeet";

/** What the system browser hands back after Google sign-in: interviewmeet://auth?code=... (or
 *  ?error=...). Returns just the safe query to pass on to the app's own page, or null. Anything that
 *  is not exactly that shape is ignored, so another program cannot steer the app with a crafted link. */
function parseAuthLink(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== `${SCHEME}:` || u.hostname !== "auth") return null;
  const code = u.searchParams.get("code");
  const error = u.searchParams.get("error");
  if (code && /^[A-Za-z0-9_-]{20,200}$/.test(code)) return `code=${code}`;
  if (error && /^[a-z_]{1,40}$/.test(error)) return `error=${error}`;
  return null;
}

/** The address of the app's own Google sign-in start. Only this may be opened in the browser on the
 *  page's request, so a page cannot ask the shell to open arbitrary addresses. */
function isGoogleStartUrl(url, appOrigin) {
  try {
    const u = new URL(url);
    return (
      u.origin === appOrigin &&
      u.pathname === "/api/auth/google/start" &&
      u.searchParams.get("app") === "1"
    );
  } catch {
    return false;
  }
}

/** A deep link found among a program's start-up arguments (Windows and Linux hand it over there). */
function linkFromArgv(argv) {
  return (argv || []).find((a) => typeof a === "string" && a.startsWith(`${SCHEME}://`)) || null;
}

module.exports = {
  SCHEME,
  parseAuthLink,
  isGoogleStartUrl,
  linkFromArgv,
  originOf,
  isAppUrl,
  navigationDecision,
  permissionAllowed,
  captureAllowed,
  resolveAppUrl,
};
