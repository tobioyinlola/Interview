const test = require("node:test");
const assert = require("node:assert/strict");
const { nativeMin, note } = require("../scripts/ui-release");

test("the first interface release can only run on apps from the same build on", () => {
  assert.equal(nativeMin(null, ["frontend/src/a.ts"], 100024), 100024);
});

test("an interface-only change keeps what the last one needed, so older apps keep updating quietly", () => {
  const prev = { version: "0.2.24", native_min: 100024 };
  assert.equal(nativeMin(prev, ["frontend/src/a.ts", "mobile/README.md", "backend/app/x.py"], 100030), 100024);
});

test("a change to the app itself raises the bar to this build", () => {
  const prev = { native_min: 100024 };
  for (const f of [
    "mobile/android/app/src/main/java/com/interviewmeet/app/AppInstallerPlugin.java",
    "mobile/ios/App/App/Info.plist",
    "mobile/package.json",
    "mobile/package-lock.json",
    "mobile/capacitor.config.ts",
  ]) {
    assert.equal(nativeMin(prev, ["frontend/src/a.ts", f], 100030), 100030, f);
  }
});

test("when it cannot tell what changed it is careful", () => {
  assert.equal(nativeMin({ native_min: 100024 }, null, 100030), 100030);
  assert.equal(nativeMin({ native_min: "x" }, [], 100030), 100030);
});

test("the note says which interface it is, what it needs, and which commit made it", () => {
  assert.deepEqual(note("0.2.30", 100030, { native_min: 100024 }, [], "abc"), {
    version: "0.2.30",
    native_min: 100024,
    commit: "abc",
  });
});
