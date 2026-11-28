"use strict";
// Carries one application out in the visible workspace: reads the form, fills it screen by screen
// from the candidate's answers, hands anything it cannot honestly answer back, checks the form,
// asks the server for the final go-ahead, presses submit and waits for the employer's own proof.
//
// It never invents an answer, never gets round a CAPTCHA or a sign-in, and never reports success
// without the confirmation text or address of the employer (the server checks that again).
const crypto = require("node:crypto");
const rules = require("./rules");
const fs = require("node:fs");
const path = require("node:path");

const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const SCAN = read("scan_form.js");
const VALIDATE = read("validate_form.js");

const CLOSED = /no longer (accepting|available|open)|position (has been |is )?(filled|closed)|job (is |has been )?(closed|removed)|this (job|position|role) (is|has been) (closed|filled)|page (you are looking for )?(was )?not found|404/i;
const BLOCK_TITLE = /just a moment|access denied|attention required|are you a robot/i;
const LOGIN = /\b(sign in|log in|create an account) to (apply|continue)\b/i;
const SPAM = /flagged|possible spam|suspicious|unusual activity|automated (request|submission)|are you a (human|robot)/i;
const OPTIONS = "[role=option], [class*=select__option], [id*='-option-']";
const SUBMIT_MS = 40_000;
const ERROR_TEXT = /(is|are) required|required field|missing entry|please (enter|select|choose|fill|provide|complete|answer)|must (be|select|choose)|invalid|cannot be (blank|empty)|can'?t be (blank|empty)|this field/i;

class Stop extends Error {
  constructor(outcome) { super(outcome.message || outcome.status); this.outcome = outcome; }
}
const out = (status, message, extra = {}) => new Stop({ status, message, ...extra });

async function runJob({ page, job, say, command, authorize, intervene, now = Date.now, limits = {} }) {
  const system = rules.BY_KEY[job.ats] || rules.GENERIC;
  const submitMs = limits.submitMs || SUBMIT_MS;
  const values = job.values || {};
  const documents = [];
  const filled = new Set(); // what was actually put on the form, by name
  let steps = 1;
  let provider = system.key;

  // after each checkpoint the candidate's skip or stop is looked for; never after the submit press
  const checkpoint = async (kind, data = {}) => {
    const c = await say(kind, data);
    if (kind !== "submission_started" && (c === "skip" || c === "stop")) {
      throw out("interrupted", "Interrupted", { command: c });
    }
  };

  try {
    let scan = await page.fnValue(SCAN);
    // a "verify you are human" page: the person passes it, and the real form loads in its place
    if (BLOCK_TITLE.test(scan.title || "")) {
      await person("The employer's site asked for a human check.");
      scan = await afterCheck(page);
    }
    const system0 = rules.detect(job.url);
    let sys = system0.key === "generic" ? rules.detect(job.url, (await page.ev("__im.html()")) || "") : system0;
    provider = sys.key;
    if (!scan.controls.length) {
      throw out("failed", CLOSED.test(scan.text) ? "This job is no longer open." : "No application form was found on that page.", { provider });
    }
    if (LOGIN.test(scan.text) || sys.needsAccount) {
      throw out("handed_over", "The employer asks you to sign in to apply.", { provider });
    }

    const seen = new Set();
    for (;;) {
      if (scan.captcha) {
        await person("The form asks for a human check (CAPTCHA).");
        scan = await afterCheck(page);
      }
      const controls = rules.controlsFrom(scan);
      const digest = crypto.createHash("sha256").update(JSON.stringify(controls.map((c) => [c.name, c.kind, c.required, c.options]))).digest("hex").slice(0, 16);
      if (seen.has(digest)) throw out("failed", "The form did not move on to its next step.", { provider });
      seen.add(digest);
      if (steps === 1) await checkpoint("form_discovered", { fields: controls.length, steps: 1, provider });
      Object.assign(values, rules.resolve(controls, values)); // what can honestly be answered for them
      const need = rules.unanswered(controls, values);
      if (need.length) throw out("needs_input", "The form asks something that has not been answered.", { need, provider });
      for (const c of controls) {
        const done = await fill(page, c, job, values);
        if (!done) continue;
        filled.add(c.name);
        if (done.document) {
          documents.push(done.document);
          await checkpoint("document_uploaded", { name: done.document.name, role: c.name });
        } else {
          await checkpoint("field_completed", { field: c.name, label: c.label, field_kind: c.kind });
        }
      }
      const missing = await page.fnValue(VALIDATE).catch(() => []);
      if (missing.length) throw out("failed", `The form still needs '${missing[0]}', which cannot be filled.`, { provider });
      if (steps < rules.MAX_STEPS && (await wantsNext(page, sys))) {
        await checkpoint("step_completed", { step: steps });
        await goNext(page, sys);
        scan = await page.fnValue(SCAN);
        steps += 1;
        continue;
      }
      break;
    }
    await checkpoint("application_validated", { steps });

    // the server decides, once more, that this application may go
    const go = await authorize();
    if (!go.ok) throw out("interrupted", go.reason || "Not allowed now", { command: go.reason === "stop" ? "stop" : "skip", released: true });
    const beforeState = await page.state().catch(() => ({ url: "", text: "" }));
    const before = beforeState.url || (await page.url());
    try {
      // the system's own submit button when it is on screen; the general rule only otherwise
      const own = sys.submit && (await page.visible(sys.submit)) ? sys.submit : rules.submitSelector(sys);
      await page.click(own, "last");
    } catch {
      throw out("failed", "The form's submit button could not be pressed.", { provider, sent: false });
    }
    // from here the employer may have it: an unclear end is "ambiguous", never a plain failure
    let t0 = now();
    let checked = false;
    for (;;) {
      await page.sleep(500);
      if (now() - t0 >= submitMs) {
        throw out("ambiguous", "The form did not show a confirmation in time.", { provider, steps, documents });
      }
      let st;
      try { st = await page.state(); } catch { continue; }
      const proof = rules.confirmation(sys, st.url, st.text, before, beforeState.text || "");
      if (!proof && st.challenge && !checked) {
        // a picture puzzle came up only on the press (invisible reCAPTCHA unsure of the score):
        // the form is not sent until it is passed. The person does it, then it is waited for again.
        checked = true;
        await person("The form asks for a human check (CAPTCHA) before it sends.");
        t0 = now();
        continue;
      }
      if (proof) return { status: "confirmed", provider, evidence: st.text.slice(0, 3000), url: st.url, before_url: before, steps, documents, message: proof };
      if (SPAM.test(st.text)) throw out("failed", "The employer's site flagged the submission as automated.", { provider, sent_unknown: true });
      // the page says something is missing or wrong and has not moved on: nothing was sent
      const complaint = st.errors.find((e) => ERROR_TEXT.test(e)) || (st.bad ? "A field is marked as wrong." : "");
      if (complaint && st.url === before && now() - t0 >= 1500) {
        const left = await missingNow(page, filled);
        if (left.length) {
          throw out("needs_input", "The form still asks for something that has not been answered.", { need: left, provider, steps });
        }
        throw out("failed", `The form did not accept it: ${complaint.slice(0, 160)}`, { provider, steps, documents });
      }
      if (st.bad && now() - t0 >= 2000) throw out("failed", "The form refused the application as filled in.", { provider, sent_unknown: true });
    }
  } catch (e) {
    if (e instanceof Stop) return { provider, steps, documents, ...e.outcome };
    return { status: "failed", provider, steps, documents, message: "The form could not be carried out here." };
  }

  async function person(reason) {
    // a check only a person can pass: they are looking at the window, so ask them to do it
    const answer = await intervene(reason);
    if (answer !== "continue") throw out(answer === "stop" ? "interrupted" : "handed_over", reason, { command: answer === "stop" ? "stop" : undefined, provider });
  }
}

/** After the person passed a check: the page may reload or move on. Wait for it to settle, then read
 *  the form again (up to ~20 seconds). */
async function afterCheck(page) {
  let scan = null;
  for (let i = 0; i < 40; i++) {
    await page.sleep(500);
    try {
      scan = await page.fnValue(SCAN);
      if (!BLOCK_TITLE.test(scan.title || "") && scan.controls.length) break;
    } catch { /* the page is reloading: look again */ }
  }
  if (!scan) throw out("failed", "The page did not come back after the check.");
  await page.sleep(500);
  return scan;
}

/** After the page complained: read the form again and name what is required and was never filled in. */
async function missingNow(page, filled) {
  let scan;
  try { scan = await page.fnValue(SCAN); } catch { return []; }
  const controls = rules.controlsFrom(scan);
  return controls
    .filter((c) => c.required && c.kind !== "captcha" && !filled.has(c.name) && c.kind !== "file")
    .map((c) => ({ kind: c.kind === "declaration" ? "declaration" : "answer", field: c.name, question: c.label,
      reason: "The form asked for this and it could not be filled in.", ...(c.options.length ? { options: c.options } : {}) }));
}

async function wantsNext(page, sys) {
  if (await page.visible(rules.submitSelector(sys))) return false;
  return page.visible(rules.nextSelector(sys));
}

async function goNext(page, sys) {
  const before = (await page.state()).len;
  try { await page.click(rules.nextSelector(sys), "first"); }
  catch { throw out("failed", "The form's next step could not be opened."); }
  for (let i = 0; i < 20; i++) {
    await page.sleep(300);
    try { if ((await page.state()).len !== before) break; } catch { /* navigating */ }
  }
  await page.sleep(500);
}

async function fill(page, c, job, values) {
  if (c.kind === "file") {
    const doc = c.name === "resume" || c.name === "cv" ? job.documents && job.documents.resume
      : c.name === "cover_letter" ? job.documents && job.documents.cover_letter : null;
    if (!doc) return null;
    const bytes = Buffer.from(doc.b64, "base64");
    if (bytes.length > rules.MAX_DOCUMENT_BYTES) throw out("failed", `'${doc.name}' is too large to upload.`);
    const sha = crypto.createHash("sha256").update(bytes).digest("hex");
    if (doc.sha256 && doc.sha256 !== sha) throw out("failed", "A document did not match what the server prepared.");
    try { await page.setFile(c.selector, doc.name, bytes); }
    catch { throw out("failed", `'${c.label}' could not be filled in.`); }
    return { document: { name: doc.name, bytes: bytes.length, sha256: sha } };
  }
  const value = values[c.name];
  if (value == null || value === "") return null;
  const bad = () => out("failed", `'${c.label}' has no choice matching your answer.`);
  try {
    if (c.ctl === "text") {
      let v = String(value);
      if (c.itype === "date") { await page.setDate(c.selector, rules.isoDate(v)); return {}; }
      if (c.itype === "number") v = v.replace(/[^0-9.\-]/g, "");
      await page.type(c.selector, v);
    } else if (c.ctl === "select") {
      const i = rules.pick(c.options, value);
      if (i == null) throw bad();
      await page.select(c.selector, c.options[i]);
    } else if (c.ctl === "combo") {
      await chooseInCombo(page, c, String(value), bad);
    } else if (c.ctl === "single") {
      if (["yes", "true", "agree", "i agree", "accept", "i accept", "1"].includes(rules.norm(value))) {
        if (!(await page.call("checked", c.selector, 0))) await page.click(c.selector, "first").catch(() => page.clickScript(c.selector, 0));
      }
    } else if (c.ctl === "buttons") {
      const i = rules.pick(c.options, value);
      if (i == null) throw bad();
      await page.click(c.selector, "first", c.options[i]);
    } else if (c.ctl === "group") {
      const wanted = c.multi ? String(value).split(";").map((s) => s.trim()) : [String(value)];
      for (const w of wanted) {
        const i = rules.pick(c.options, w);
        if (i == null) throw bad();
        if (!(await page.call("checked", c.selector, i))) {
          await page.click(c.selector, i).catch(() => page.clickScript(c.selector, i));
        }
      }
    }
  } catch (e) {
    if (e instanceof Stop) throw e;
    throw out("failed", `'${c.label}' could not be filled in.`);
  }
  return {};
}

async function chooseInCombo(page, c, value, bad) {
  await page.click(c.selector, "first");
  await page.type(c.selector, value.slice(0, 60));
  await page.sleep(500);
  const texts = await page.call("optionTexts", OPTIONS);
  const i = rules.pick(texts, value);
  if (i == null) { await page.press("Escape"); throw bad(); }
  await page.click(OPTIONS, i);
}

module.exports = { runJob, CLOSED, LOGIN, SPAM };
