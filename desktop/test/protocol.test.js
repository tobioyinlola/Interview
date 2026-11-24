"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const p = require("../src/protocol");
const policy = require("../src/policy");

const ROOT = path.resolve("/pack/app-dist");

test("an address inside the app maps to its file, and the app's own routes get index.html", () => {
  assert.equal(p.resolveFile("app://interviewmeet/assets/index-abc.js", ROOT), path.join(ROOT, "assets", "index-abc.js"));
  assert.equal(p.resolveFile("app://interviewmeet/", ROOT), path.join(ROOT, "index.html"));
  assert.equal(p.resolveFile("app://interviewmeet/auto-apply/startups", ROOT), path.join(ROOT, "index.html"));
  assert.equal(p.resolveFile("app://interviewmeet/pcm-worklet.js?x=1", ROOT), path.join(ROOT, "pcm-worklet.js"));
});

test("an address can never reach outside the packed files", () => {
  for (const bad of [
    "app://interviewmeet/../secret.txt",
    "app://interviewmeet/%2e%2e/%2e%2e/etc/passwd",
    "app://interviewmeet/assets/..%2f..%2fpackage.json",
    "app://interviewmeet/a%00.js",
    "app://interviewmeet/%E0%A4%A",
  ]) {
    const got = p.resolveFile(bad, ROOT);
    assert.ok(got === null || got.startsWith(ROOT + path.sep), `${bad} -> ${got}`);
  }
  assert.equal(p.resolveFile("app://interviewmeet/%2e%2e/%2e%2e/etc/passwd", ROOT).startsWith(ROOT), true);
});

test("only our own scheme and host are served", () => {
  assert.equal(p.resolveFile("app://elsewhere/index.html", ROOT), null);
  assert.equal(p.resolveFile("https://interviewmeet/index.html", ROOT), null);
  assert.equal(p.resolveFile("not a url", ROOT), null);
});

test("files are sent with the right type", () => {
  assert.match(p.typeOf("a.js"), /javascript/);
  assert.match(p.typeOf("a.css"), /css/);
  assert.match(p.typeOf("font.woff2"), /woff2/);
  assert.equal(p.typeOf("x.bin"), "application/octet-stream");
});

test("the packed app's own address is recognised, and nothing look-alike is", () => {
  const APP = p.ORIGIN;
  assert.equal(policy.originOf("app://interviewmeet/dashboard"), APP);
  assert.equal(policy.navigationDecision("app://interviewmeet/dashboard", APP), "allow");
  assert.equal(policy.navigationDecision("app://interviewmeet.evil.test/x", APP), "deny");
  assert.equal(policy.navigationDecision("app://other/x", APP), "deny");
  assert.equal(policy.navigationDecision("https://example.com/", APP), "external");
  assert.equal(policy.permissionAllowed("media", "app://interviewmeet/session/1", APP), true);
  assert.equal(policy.permissionAllowed("media", "https://example.com/", APP), false);
  assert.equal(policy.captureAllowed("app://interviewmeet/session/new", APP), true);
});
