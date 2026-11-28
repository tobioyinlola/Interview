"use strict";
// The form engine against employer pages served from this machine, driven through the browser's own
// protocol (the same driver the workspace uses). No real application is ever submitted.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { chromium } = require("playwright-core");
const { makeDriver } = require("../src/auto/driver");
const { runJob } = require("../src/auto/engine");
const site = require("./site");

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const doc = (name) => ({ name, b64: PDF.toString("base64"), sha256: crypto.createHash("sha256").update(PDF).digest("hex") });
const VALUES = {
  first_name: "Ada", last_name: "Obi", email: "ada@example.com", phone: "+234 801", linkedin: "https://linkedin.com/in/ada",
  country: "Nigeria", question_1: "I love the product.", work_authorization: "Yes", veteran: "I am not a veteran", consent: "yes",
};

const fs = require("node:fs");
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium";
const SKIP = !fs.existsSync(CHROME) && "no test browser here (set CHROME); the workspace smoke test covers the real app";
if (SKIP) { test("engine tests need a browser", { skip: SKIP }, () => {}); process.exitCode = process.exitCode || 0; }

let browser, server;
test.before(async () => {
  if (SKIP) return;
  server = await site.start();
  browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
});
test.after(async () => { if (SKIP) return; await browser.close(); await server.close(); });

async function open(path) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(server.origin + path);
  const cdp = await ctx.newCDPSession(page);
  const driver = makeDriver((m, p) => cdp.send(m, p), { pace: 20 });
  return { page, driver, close: () => ctx.close() };
}
function run(driver, path, over = {}) {
  const events = [];
  const job = { url: server.origin + path, ats: "greenhouse", values: VALUES, documents: { resume: doc("CV.pdf") }, ...over.job };
  const ctl = { command: null, authorized: 0, asked: [] };
  const done = runJob({
    page: driver, job,
    say: async (kind, data) => { events.push({ kind, ...data }); if (over.onSay) over.onSay(kind, data, ctl); return ctl.command; },
    authorize: async () => { ctl.authorized += 1; return over.deny ? { ok: false, reason: over.deny } : { ok: true }; },
    intervene: async (r) => { ctl.asked.push(r); return over.answer || "skip"; },
    limits: { submitMs: 3000 },
  });
  return { done, events, ctl };
}

test("fills a Greenhouse-style form, uploads the exact CV and ends on the employer's confirmation", { skip: SKIP }, async () => {
  server.received.length = 0;
  const { driver, close, page } = await open("/jobs/1");
  const r = run(driver, "/jobs/1");
  const out = await r.done;
  assert.equal(out.status, "confirmed", out.message);
  assert.match(out.evidence, /Thank you for applying/);
  assert.equal(r.ctl.authorized, 1);
  const got = server.received.at(-1);
  assert.equal(got.first_name, "Ada");
  assert.equal(got.country, "Nigeria");
  assert.equal(got.consent, "on");
  assert.equal(got.resume.filename, "CV.pdf");
  assert.equal(out.documents[0].sha256, doc("x").sha256);
  assert.equal(got.trap, "", "the hidden honeypot is never filled");
  assert.ok(r.events.some((e) => e.kind === "form_discovered"));
  assert.ok(r.events.some((e) => e.kind === "document_uploaded"));
  assert.ok(r.events.some((e) => e.kind === "application_validated"));
  await close(); void page;
});

test("an Ashby-style form drawn by script: button choices, hidden file input", { skip: SKIP }, async () => {
  server.received.length = 0;
  const { driver, close } = await open("/ashby/jobs/1");
  const r = run(driver, "/ashby/jobs/1", { job: { ats: "ashby", values: { name: "Ada Obi", email: "ada@example.com", phone: "+234 801", linkedin: "https://x", years_experience: "Yes", long1: "A hard problem." } } });
  const out = await r.done;
  assert.equal(out.status, "confirmed", out.message);
  const got = server.received.at(-1);
  assert.equal(got.yesno, "Yes");
  assert.equal(got.long1, "A hard problem.");
  assert.equal(got.resume.filename, "CV.pdf");
  await close();
});

test("a required question with no answer is handed back before anything is typed", { skip: SKIP }, async () => {
  const { driver, close, page } = await open("/jobs/1");
  const values = { ...VALUES }; delete values.question_1;
  const r = run(driver, "/jobs/1", { job: { values } });
  const out = await r.done;
  assert.equal(out.status, "needs_input");
  assert.equal(out.need[0].field, "question_1");
  assert.equal(r.ctl.authorized, 0);
  assert.equal(await page.inputValue("#first_name"), "", "nothing was typed");
  await close();
});

test("a sensitive declaration with no stored answer is never guessed", { skip: SKIP }, async () => {
  const { driver, close } = await open("/jobs/clearance");
  const r = run(driver, "/jobs/clearance", { job: { values: { first_name: "Ada", email: "ada@example.com" } } });
  const out = await r.done;
  assert.equal(out.status, "needs_input");
  assert.match(out.need[0].question, /security clearance/i);
  await close();
});

test("a CAPTCHA asks the person; skipping hands it back and nothing is submitted", { skip: SKIP }, async () => {
  server.received.length = 0;
  const { driver, close } = await open("/jobs/captcha");
  const r = run(driver, "/jobs/captcha", { answer: "skip" });
  const out = await r.done;
  assert.equal(out.status, "handed_over");
  assert.equal(r.ctl.asked.length, 1);
  assert.equal(server.received.length, 0);
  await close();
});

test("a multi-step form is completed screen by screen", { skip: SKIP }, async () => {
  server.received.length = 0;
  const { driver, close } = await open("/jobs/steps");
  const r = run(driver, "/jobs/steps");
  const out = await r.done;
  assert.equal(out.status, "confirmed", out.message);
  assert.equal(out.steps, 2);
  assert.ok(r.events.some((e) => e.kind === "step_completed"));
  assert.equal(server.received.at(-1).question_1, "I love the product.");
  await close();
});

test("skip pressed mid-form ends it before the submit button", { skip: SKIP }, async () => {
  server.received.length = 0;
  const { driver, close } = await open("/jobs/1");
  const r = run(driver, "/jobs/1", { onSay: (kind, d, ctl) => { if (kind === "field_completed" && d.field === "email") ctl.command = "skip"; } });
  const out = await r.done;
  assert.equal(out.status, "interrupted");
  assert.equal(out.command, "skip");
  assert.equal(r.ctl.authorized, 0);
  assert.equal(server.received.length, 0);
  await close();
});

test("the server's last check can refuse: the submit button is never pressed", { skip: SKIP }, async () => {
  server.received.length = 0;
  const { driver, close } = await open("/jobs/1");
  const r = run(driver, "/jobs/1", { deny: "you stopped the run" });
  const out = await r.done;
  assert.equal(out.status, "interrupted");
  assert.equal(server.received.length, 0);
  await close();
});

test("pressing submit with no confirmation is ambiguous, never success", { skip: SKIP }, async () => {
  const { driver, close } = await open("/jobs/silent");
  const r = run(driver, "/jobs/silent");
  const out = await r.done;
  assert.equal(out.status, "ambiguous");
  await close();
});

test("after the person passes a 'verify you are human' page, the real form is filled in", { skip: SKIP }, async () => {
  server.received.length = 0;
  const { driver, close } = await open("/jobs/interstitial");
  const r = run(driver, "/jobs/1", { answer: "continue" });
  const out = await r.done;
  assert.equal(r.ctl.asked.length, 1, "the person was asked once");
  assert.equal(out.status, "confirmed", out.message);
  assert.equal(server.received.at(-1).first_name, "Ada");
  await close();
});

test("a cursor is drawn on the page and follows the control being filled", { skip: SKIP }, async () => {
  const { driver, close, page } = await open("/jobs/1");
  await driver.type("#first_name", "Ada");
  const at = await page.evaluate(() => ({ has: !!document.getElementById("__im_cursor"), t: document.getElementById("__im_cursor")?.style.transform }));
  assert.equal(at.has, true);
  assert.match(at.t, /translate\(/);
  await close();
});

// ------------------------------------------------------------- a modern Ashby form (from a real run)

const ASHBY_VALUES = {
  name: "Justus Oyinlola", email: "j@example.com", linkedin: "https://linkedin.com/in/j",
  requires_sponsorship: "No",
};

test("a modern Ashby form: custom radios, Yes/No buttons and EEO questions are all answered, then submitted", { skip: SKIP }, async () => {
  server.received.length = 0;
  const { driver, close } = await open("/ashby/modern");
  const r = run(driver, "/ashby/modern", { job: { ats: "ashby", values: ASHBY_VALUES } });
  const out = await r.done;
  assert.equal(out.status, "confirmed", out.message);
  const got = server.received.at(-1);
  assert.equal(got.visa, "No");
  assert.equal(got.gender, "d", "the voluntary self-identification was declined");
  assert.equal(got.veteran, "d");
  assert.equal(got.disability, "d");
  assert.equal(got.hear, "5", "how they heard: Other");
  assert.equal(got.resume.filename, "CV.pdf");
  await close();
});

test("a required question that only the candidate can answer is asked for before anything is pressed", { skip: SKIP }, async () => {
  server.received.length = 0;
  const { driver, close } = await open("/ashby/modern");
  const values = { ...ASHBY_VALUES };
  delete values.requires_sponsorship;
  const r = run(driver, "/ashby/modern", { job: { ats: "ashby", values } });
  const out = await r.done;
  assert.equal(out.status, "needs_input");
  assert.match(out.need[0].question, /visa sponsorship/i);
  assert.equal(r.ctl.authorized, 0, "submit was never pressed");
  await close();
});

test("when the page says something is missing after submit, it is reported as not sent, never as unknown", { skip: SKIP }, async () => {
  server.received.length = 0;
  const { driver, close } = await open("/jobs/invisible");
  const r = run(driver, "/jobs/invisible", { job: { values: { first_name: "Ada", email: "a@b.co" } } });
  const t0 = Date.now();
  const out = await r.done;
  assert.notEqual(out.status, "ambiguous");
  assert.equal(out.status, "failed");
  assert.match(out.message, /did not accept it.*Missing entry/i);
  assert.ok(!out.sent_unknown, "nothing was sent");
  assert.ok(Date.now() - t0 < 6000, "it did not wait out the full confirmation time");
  assert.equal(server.received.length, 0);
  await close();
});

test("'Application submitted' appearing on the page counts as success", { skip: SKIP }, async () => {
  const { driver, close } = await open("/jobs/submitted");
  const out = await run(driver, "/jobs/submitted", { job: { values: { first_name: "Ada", email: "a@b.co" } } }).done;
  assert.equal(out.status, "confirmed", out.message);
  assert.match(out.message, /application submitted/i);
  await close();
});

test("words about what happens after applying, already on the page, are not taken for success", { skip: SKIP }, async () => {
  const { driver, close } = await open("/jobs/submitted?fail=1");
  const out = await run(driver, "/jobs/submitted?fail=1", { job: { values: { first_name: "Ada", email: "a@b.co" } } }).done;
  assert.equal(out.status, "ambiguous", "nothing new appeared: unknown, never success");
  await close();
});
