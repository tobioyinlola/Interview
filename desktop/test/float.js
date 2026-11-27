"use strict";
// Launches the real desktop app and checks the floating answer panel's window: the page can open
// it, fill it, and it stays on top; no other window can be opened this way.
// Run: `xvfb-run -a node test/float.js` on Linux, `node test/float.js` on Windows/Mac.
const http = require("node:http");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

const PAGE = `<!doctype html><title>float</title><body>app</body>`;

async function main() {
  const srv = http.createServer((_q, r) => {
    r.setHeader("content-type", "text/html");
    r.end(PAGE);
  });
  await new Promise((r) => srv.listen(5198, "127.0.0.1", r));
  const env = { ...process.env, NODE_OPTIONS: "", INTERVIEWMEET_URL: "http://localhost:5198", INTERVIEWMEET_DEV_URL: "http://localhost:5198" };
  const app = await electron.launch({ args: [path.join(__dirname, ".."), "--no-sandbox"], env });
  const failures = [];
  const check = (name, ok, detail) => {
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
    if (!ok) failures.push(name);
  };
  try {
    const w = await app.firstWindow();
    await w.waitForLoadState("domcontentloaded");
    // Why the old panel never appeared here: Electron has the picture-in-picture API but cannot open
    // that window ("Internal error: no window"), so the app opens its own small window instead.
    const r = await w.evaluate(() => {
      const f = window.open("", "im-float", "popup,width=420,height=560");
      if (!f) return { opened: false };
      f.document.title = "Question and answer";
      f.document.body.innerHTML = "<p id='x'>hello</p>";
      return { opened: true, text: f.document.getElementById("x").textContent, sameOrigin: f.origin === window.origin };
    });
    check("the page can open the answer panel's window", r.opened === true);
    check("it can fill that window with its own content", r.text === "hello", String(r.text));
    check("the window belongs to the app (same origin)", r.sameOrigin === true);

    const wins = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((b) => ({ onTop: b.isAlwaysOnTop(), width: b.getBounds().width, protectedFromCapture: b.isContentProtected ? b.isContentProtected() : false, title: b.getTitle() })),
    );
    check("there are two windows", wins.length === 2, JSON.stringify(wins));
    const small = wins.find((x) => x.onTop);
    check("the small one stays on top of other windows", !!small);
    check("it is not hidden from screen capture", small && small.protectedFromCapture !== true);

    const other = await w.evaluate(() => window.open("", "something-else", "popup") === null);
    check("an empty window with any other name is refused", other === true);
    // asking for the panel's window again with an address must not take it anywhere
    await w.evaluate(() => { window.open("https://evil.example/", "im-float"); });
    await new Promise((r) => setTimeout(r, 500));
    const urls = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter((b) => b.isAlwaysOnTop()).map((b) => b.webContents.getURL()),
    );
    check("the panel's window cannot be sent to another site", urls.length === 1 && urls[0] === "about:blank", JSON.stringify(urls));
    const count = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    check("no extra windows appeared", count === 2, String(count));
  } finally {
    await app.close().catch(() => undefined);
    srv.close();
  }
  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log("\nthe floating answer panel works in the desktop app");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
