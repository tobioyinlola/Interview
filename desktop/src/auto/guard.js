"use strict";
// What an employer's page may reach from the workspace. Pure rules (no Electron) so they are tested
// on any machine; workspace.js applies them to every request the page makes.
const net = require("node:net");
const dns = require("node:dns").promises;

function privateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low === "::1" || low === "::" || low.startsWith("fe80") || low.startsWith("fc") || low.startsWith("fd")) return true;
    const m = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return m ? privateAddress(m[1]) : false;
  }
  return true;
}

/** The address itself, before any lookup: https, a real host name, no sign-in details in it. */
function syntaxAllowed(url, { allowHttpHosts = [] } = {}) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (allowHttpHosts.includes(u.host)) return u.protocol === "http:" || u.protocol === "https:"; // tests only
  if (u.protocol !== "https:") return false;
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) return false;
  if (net.isIP(host.replace(/^\[|\]$/g, ""))) return false;
  if (u.port && u.port !== "443") return false;
  return true;
}

/** Syntax, then what the name really points at: a name that resolves to a private address (a
 *  rebinding trick) is refused too. */
async function allowed(url, opts = {}) {
  if (!syntaxAllowed(url, opts)) return false;
  const u = new URL(url);
  if ((opts.allowHttpHosts || []).includes(u.host)) return true;
  try {
    const lookup = opts.lookup || ((h) => dns.lookup(h, { all: true }));
    const addrs = await lookup(u.hostname);
    return addrs.length > 0 && addrs.every((a) => !privateAddress(a.address));
  } catch {
    return false;
  }
}

/** The address the server may hand the desktop: it must be an https employer page. */
function jobUrlAllowed(url, opts) { return syntaxAllowed(url, opts); }

module.exports = { privateAddress, syntaxAllowed, allowed, jobUrlAllowed };
