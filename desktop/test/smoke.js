"use strict";
// Launches the real app (not just the rules) and checks what the web page can and cannot do.
// Run by CI on Windows; also works locally: `node test/smoke.js` (use xvfb-run on Linux).
// Pass an installed/unpacked exe with SMOKE_EXE to test the packaged app instead of the source.
const http = require("node:http");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

const PAGE = `<!doctype html><title>smoke</title><a id="ext" href="https://example.com/" target="_blank">x</a><script>
window.__r = {};
(async () => {
  __r.bridge = window.interviewMeetDesktop ? JSON.parse(JSON.stringify(window.interviewMeetDesktop)) : null;
  __r.ua = navigator.userAgent.includes("InterviewMeetDesktop/");
  __r.noNode = typeof require === "undefined" && typeof process === "undefined";
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: true });
    __r.capture = { video: s.getVideoTracks().length, audio: s.getAudioTracks().length };
    s.getTracks().forEach((t) => t.stop());
  } catch (e) { __r.capture = { error: e.name }; }
  __r.done = true;
})();
</script>`;

async function main() {
  const srv = http.createServer((_q, r) => {
    r.setHeader("content-type", "text/html");
    r.end(PAGE);
  });
  await new Promise((r) => srv.listen(5199, "127.0.0.1", r));
  const env = { ...process.env, NODE_OPTIONS: "", INTERVIEWMEET_URL: "http://localhost:5199" };
  const launch = process.env.SMOKE_EXE
    ? { executablePath: process.env.SMOKE_EXE, args: ["--no-sandbox"], env }
    : { args: [path.join(__dirname, ".."), "--no-sandbox"], env };
  const app = await electron.launch(launch);
  const failures = [];
  try {
    const w = await app.firstWindow();
    await w.waitForFunction(() => window.__r && window.__r.done, null, { timeout: 30000 });
    const r = await w.evaluate(() => window.__r);
    console.log("page saw:", JSON.stringify(r));
    if (!r.bridge || r.bridge.isDesktop !== true) failures.push("desktop bridge missing");
    if (!r.ua) failures.push("user agent not tagged");
    if (!r.noNode) failures.push("the page can reach Node");
    // Audio capture needs a sound device. A CI machine may have none, so this is reported, not required.
    if (!r.capture || r.capture.error) console.log("note: capture did not return audio here:", JSON.stringify(r.capture));
    await w.evaluate(() => { location.href = "https://example.com/"; });
    await new Promise((res) => setTimeout(res, 2000));
    if (!w.url().startsWith("http://localhost:5199")) failures.push("window left the app: " + w.url());
  } finally {
    await app.close();
    srv.close();
  }
  if (failures.length) {
    console.error("SMOKE FAILED:", failures.join("; "));
    process.exit(1);
  }
  console.log("smoke ok");
}
main().catch((e) => {
  console.error("SMOKE ERROR", e.message);
  process.exit(1);
});
