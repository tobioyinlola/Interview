"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

test("the app id is the same in the config, Android and iOS", () => {
  const id = "com.interviewmeet.app";
  assert.match(read("capacitor.config.ts"), new RegExp(`appId: "${id}"`));
  assert.match(read("android/app/build.gradle"), new RegExp(`applicationId "${id}"`));
  assert.match(read("ios/App/App.xcodeproj/project.pbxproj"), new RegExp(`PRODUCT_BUNDLE_IDENTIFIER = ${id.replace(/\./g, "\\.")}`));
});

test("the app carries its own interface instead of loading a website", () => {
  const c = read("capacitor.config.ts");
  assert.match(c, /webDir: "www"/);
  assert.doesNotMatch(c, /server:\s*{[^}]*\burl:/); // no remote address to load
  assert.match(c, /androidScheme: "https"/);
  assert.match(c, /cleartext: false/);
});

test("the interface build only accepts an https site (or localhost)", () => {
  const b = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "build-app-ui.js"), "utf8");
  assert.match(b, /must be https/);
  assert.match(read("package.json"), /"build:web": "node \.\.\/scripts\/build-app-ui\.js www"/);
});

test("the sign-in token and the opening hand-off use plugins that are installed", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.dependencies["@capacitor/preferences"]);
  assert.ok(pkg.dependencies["@capacitor/splash-screen"]);
});

test("Android does not allow plain http and asks for no risky permissions", () => {
  const m = read("android/app/src/main/AndroidManifest.xml");
  assert.doesNotMatch(m, /usesCleartextTraffic="true"/);
  assert.doesNotMatch(m, /READ_SMS|READ_CONTACTS|ACCESS_FINE_LOCATION|CAMERA|READ_EXTERNAL_STORAGE/);
});

test("both phone apps can be opened by interviewmeet:// (the hand-back after Google sign-in)", () => {
  assert.match(read("android/app/src/main/AndroidManifest.xml"), /android:scheme="interviewmeet" android:host="auth"/);
  assert.match(read("android/app/src/main/AndroidManifest.xml"), /android.intent.category.BROWSABLE/);
  assert.match(read("ios/App/App/Info.plist"), /<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>interviewmeet<\/string>/);
});

test("the browser and app plugins the sign-in uses are installed", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.dependencies["@capacitor/browser"]);
  assert.ok(pkg.dependencies["@capacitor/app"]);
});
