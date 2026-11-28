"use strict";
// Starts the real desktop app, opens the Auto-Apply workspace from the app's own page, and lets it
// carry out two jobs handed out by a mock server: a form on a fixture "employer" site (filled in a
// real visible view and confirmed), and a hostile page that tries to reach the app and the local
// network. No real application is submitted anywhere. Run on Linux with: xvfb-run -a node test/workspace.js
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { _electron: electron } = require("playwright-core");
const site = require("./site");

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const sha = crypto.createHash("sha256").update(PDF).digest("hex");
const VALUES = { first_name: "Ada", last_name: "Obi", email: "ada@example.com", country: "Nigeria", question_1: "I love the product.",
  work_authorization: "Yes", veteran: "I am not a veteran", consent: "yes" };

async function main() {
  const employer = await site.start();
  const host = new URL(employer.origin).host;
  const calls = [];
  const jobs = [
    { attempt_id: "11111111-1111-1111-1111-111111111111", application_id: "a", url: `${employer.origin}/jobs/1`, company: "Acme", title: "PM", ats: "greenhouse", values: VALUES,
      documents: { resume: { name: "CV.pdf", b64: PDF.toString("base64"), sha256: sha } }, cv_version: "v1" },
    { attempt_id: "22222222-2222-2222-2222-222222222222", application_id: "b", url: `${employer.origin}/jobs/probe`, company: "Probe", title: "X", ats: "generic", values: {}, documents: {} },
  ];
  let served = 0;
  const view = { state: "running", speed: "normal", execution_mode: "auto", forms_run_on: "desktop", desktop_open: true, executors: [],
    counters: { queued: 2, verified: 0, verified_today: 0, failed: 0, skipped: 0, needs_you: 0 }, current: null, events: [], last_seq: 0 };
  const api = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
      const p = req.url.replace(/^\/api\/autoapply/, "");
      if (req.method === "GET" && req.url === "/app") { res.setHeader("content-type", "text/html"); return res.end(`<!doctype html><title>app</title><script>
        window.__opened = window.interviewMeetDesktop.openWorkspace({ token: "test-token", base: location.origin });</script>`); }
      calls.push({ p, auth: req.headers.authorization, body });
      res.setHeader("content-type", "application/json");
      if (p === "/run") return res.end(JSON.stringify(view));
      if (p === "/desktop/register") return res.end(JSON.stringify({ stopped: false, forms_here: true }));
      if (p === "/desktop/claim") return res.end(JSON.stringify({ job: served < jobs.length ? jobs[served++] : null }));
      if (p.endsWith("/events")) return res.end(JSON.stringify({ command: null }));
      if (p.endsWith("/dispatch")) return res.end(JSON.stringify({ ok: true }));
      if (p.endsWith("/result")) return res.end(JSON.stringify({ state: "sent" }));
      res.statusCode = 404; res.end("{}");
    });
  });
  await new Promise((r) => api.listen(0, "127.0.0.1", r));
  const apiOrigin = `http://127.0.0.1:${api.address().port}`;

  const app = await electron.launch({
    args: [path.join(__dirname, ".."), "--no-sandbox"],
    env: { ...process.env, NODE_OPTIONS: "", INTERVIEWMEET_URL: apiOrigin, INTERVIEWMEET_DEV_URL: `${apiOrigin}/app`, IM_TEST_HTTP_HOSTS: host },
  });
  app.process().stderr.on("data", (d) => { if (process.env.DEBUG_CALLS) process.stderr.write(d); });
  const failures = [];
  const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { failures.push(name); console.log("FAIL", name, "-", e.message); } };
  try {
    const main = await app.firstWindow();
    await main.waitForFunction(() => window.__opened !== undefined, null, { timeout: 20000 });
    assert.equal(await main.evaluate(() => window.__opened), true, "the app page could open the workspace");
    const results = () => calls.filter((c) => c.p.endsWith("/result"));
    const t0 = Date.now();
    while (results().length < 2 && Date.now() - t0 < (process.env.WAIT_MS ? +process.env.WAIT_MS : 90000)) await new Promise((r) => setTimeout(r, 500));

    if (process.env.DEBUG_CALLS) console.log(calls.map((c) => c.p).join("\n"));
    const [r1, r2] = results();
    check("two results arrived", () => assert.equal(results().length, 2));
    check("the real form was confirmed by the employer's own words", () => {
      assert.equal(r1.body.status, "confirmed");
      assert.match(r1.body.evidence, /Thank you for applying/);
      assert.equal(r1.body.documents[0].sha256, sha);
    });
    check("the employer received the answers and the exact CV", () => {
      const got = employer.received.find((x) => x.first_name === "Ada");
      assert.ok(got, "no submission");
      assert.equal(got.question_1, "I love the product.");
      assert.equal(got.resume.filename, "CV.pdf");
      assert.equal(got.resume.size, PDF.length);
    });
    check("the dispatch check came before the result", () => {
      const order = calls.map((c) => c.p.split("/").pop());
      assert.ok(order.indexOf("dispatch") < order.indexOf("result"));
    });
    check("the token only ever went to the API", () => assert.ok(calls.every((c) => !c.auth || c.auth === "Bearer test-token")));
    check("the hostile page was handed back, not filled in", () => assert.equal(r2.body.status, "needs_input"));
    const probe = employer.received.probe;
    check("the hostile page saw no app, no node, no panel", () => {
      assert.ok(probe, "the page did not report");
      assert.deepEqual([probe.desktop, probe.workspace, probe.req, probe.proc], ["undefined", "undefined", "undefined", "undefined"]);
    });
    check("the hostile page could not reach the local network", () => assert.equal(probe && probe.net, "blocked"));
    check("every application got its own events and a lease renewal", () => assert.ok(calls.some((c) => c.p.endsWith("/events") && c.body.events.length)));
    const wins = app.windows().length;
    check("the workspace window exists beside the app", () => assert.ok(wins >= 2, `windows: ${wins}`));
  } finally {
    await app.close().catch(() => {});
    api.close();
    await employer.close();
  }
  if (failures.length) { console.error("failed:", failures.join(", ")); process.exit(1); }
  console.log("workspace smoke test passed");
}
main().catch((e) => { console.error(e); process.exit(1); });
