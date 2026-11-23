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

test("only a properly shaped interviewmeet://auth link is accepted", () => {
  const code = "A".repeat(43);
  assert.equal(p.parseAuthLink(`interviewmeet://auth?code=${code}`), `code=${code}`);
  assert.equal(p.parseAuthLink("interviewmeet://auth?error=google_cancelled"), "error=google_cancelled");
  for (const bad of [
    "interviewmeet://auth?code=short",
    "interviewmeet://auth?code=" + "A".repeat(43) + "&next=https://evil.test",
    "interviewmeet://elsewhere?code=" + code,
    "interviewmeet://auth",
    "interviewmeet://auth?error=Bad Value",
    "https://app.example.com/auth?code=" + code,
    "javascript:alert(1)",
    "",
    "nonsense",
  ]) {
    if (bad.includes("&next=")) {
      // extra parameters are dropped, never passed on
      assert.equal(p.parseAuthLink(bad), `code=${code}`);
    } else {
      assert.equal(p.parseAuthLink(bad), null, bad);
    }
  }
});

test("a page may only ask for the app's own Google sign-in address", () => {
  assert.equal(p.isGoogleStartUrl("https://app.example.com/api/auth/google/start?app=1&challenge=x", APP), true);
  assert.equal(p.isGoogleStartUrl("https://app.example.com/api/auth/google/start", APP), false);
  assert.equal(p.isGoogleStartUrl("https://evil.test/api/auth/google/start?app=1", APP), false);
  assert.equal(p.isGoogleStartUrl("https://app.example.com/other?app=1", APP), false);
  assert.equal(p.isGoogleStartUrl("file:///etc/passwd", APP), false);
  assert.equal(p.isGoogleStartUrl("nope", APP), false);
});

test("a link used to start the app is found among its arguments", () => {
  assert.equal(p.linkFromArgv(["app.exe", "interviewmeet://auth?code=x"]), "interviewmeet://auth?code=x");
  assert.equal(p.linkFromArgv(["app.exe", "--flag"]), null);
  assert.equal(p.linkFromArgv(undefined), null);
});
