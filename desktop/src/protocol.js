"use strict";
// The app carries its own copy of the interface (the web app, built for the apps) and serves it from
// app://interviewmeet. It opens instantly and works with no internet; only the API calls need a
// connection. Plain file reads (asar-aware) with a strict path check, and a fallback to index.html
// for the app's own routes, like a web server would do.
const fs = require("node:fs");
const path = require("node:path");

const SCHEME = "app";
const HOST = "interviewmeet";
const ORIGIN = `${SCHEME}://${HOST}`;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json",
};

/** Which file in `root` an address asks for, or null if it tries to leave `root`. Addresses with no
 *  file extension are the app's own routes and get index.html. */
function resolveFile(url, root) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== `${SCHEME}:` || u.host !== HOST) return null;
  let rel;
  try {
    rel = decodeURIComponent(u.pathname);
  } catch {
    return null;
  }
  if (rel.includes("\0")) return null;
  const file = path.resolve(root, "." + path.posix.normalize("/" + rel));
  const inside = file === root || file.startsWith(root + path.sep);
  if (!inside) return null;
  return path.extname(file) ? file : path.join(root, "index.html");
}

function typeOf(file) {
  return TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
}

/** Must run before the app is ready. */
function registerScheme(protocol) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
}

/** Serve `root` at app://interviewmeet. */
function serve(protocol, root) {
  const base = path.resolve(root);
  protocol.handle(SCHEME, async (request) => {
    const file = resolveFile(request.url, base);
    if (!file) return new Response("Not found", { status: 404 });
    try {
      const body = await fs.promises.readFile(file);
      return new Response(body, { headers: { "content-type": typeOf(file) } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

module.exports = { SCHEME, HOST, ORIGIN, resolveFile, typeOf, registerScheme, serve };
