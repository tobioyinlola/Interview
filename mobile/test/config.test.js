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

test("only the app's own address stays in the app, and it must be https", () => {
  const c = read("capacitor.config.ts");
  assert.match(c, /allowNavigation: \[url\.hostname\]/);
  assert.match(c, /must be https/);
});

test("Android does not allow plain http and asks for no risky permissions", () => {
  const m = read("android/app/src/main/AndroidManifest.xml");
  assert.doesNotMatch(m, /usesCleartextTraffic="true"/);
  assert.doesNotMatch(m, /READ_SMS|READ_CONTACTS|ACCESS_FINE_LOCATION|CAMERA|READ_EXTERNAL_STORAGE/);
});

test("there is an offline page to show when the site cannot be reached", () => {
  assert.match(read("www/index.html"), /Try again/);
});
