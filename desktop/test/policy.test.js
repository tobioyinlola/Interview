"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const p = require("../src/policy");

const APP = "https://app.example.com";

test("the app's own pages stay in the window", () => {
  assert.equal(p.navigationDecision("https://app.example.com/dashboard?x=1", APP), "allow");
});

test("other https sites and mail links open in the normal browser", () => {
  assert.equal(p.navigationDecision("https://accounts.google.com/o/oauth2", APP), "external");
  assert.equal(p.navigationDecision("mailto:hi@example.com", APP), "external");
});

test("look-alike and unsafe addresses are refused", () => {
  for (const u of [
    "https://app.example.com.evil.test/",
    "http://app.example.com/",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "interviewmeet://x",
    "not a url",
    "",
  ]) {
    assert.notEqual(p.navigationDecision(u, APP), "allow", u);
  }
  assert.equal(p.navigationDecision("file:///etc/passwd", APP), "deny");
  assert.equal(p.navigationDecision("javascript:alert(1)", APP), "deny");
});

test("only the app may use the microphone or capture audio", () => {
  assert.equal(p.permissionAllowed("media", "https://app.example.com/live", APP), true);
  assert.equal(p.permissionAllowed("display-capture", "https://app.example.com/", APP), true);
  assert.equal(p.permissionAllowed("media", "https://evil.test/", APP), false);
  assert.equal(p.permissionAllowed("geolocation", "https://app.example.com/", APP), false);
  assert.equal(p.permissionAllowed("notifications", "https://app.example.com/", APP), false);
  assert.equal(p.captureAllowed("https://app.example.com/live", APP), true);
  assert.equal(p.captureAllowed("https://evil.test/", APP), false);
  assert.equal(p.captureAllowed("", APP), false);
});

test("the app address comes from the environment, then the file, then the default", () => {
  const dflt = "https://default.example.com";
  assert.equal(p.resolveAppUrl({ INTERVIEWMEET_URL: "https://a.test" }, { appUrl: "https://b.test" }, dflt), "https://a.test");
  assert.equal(p.resolveAppUrl({}, { appUrl: "https://b.test" }, dflt), "https://b.test");
  assert.equal(p.resolveAppUrl({}, null, dflt), dflt);
});

test("an insecure or broken app address is ignored", () => {
  const dflt = "https://default.example.com";
  assert.equal(p.resolveAppUrl({ INTERVIEWMEET_URL: "http://app.test" }, null, dflt), dflt);
  assert.equal(p.resolveAppUrl({ INTERVIEWMEET_URL: "javascript:1" }, null, dflt), dflt);
  assert.equal(p.resolveAppUrl({ INTERVIEWMEET_URL: "nonsense" }, null, dflt), dflt);
  assert.equal(p.resolveAppUrl({ INTERVIEWMEET_URL: "http://localhost:5173" }, null, dflt), "http://localhost:5173");
});
