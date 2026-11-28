"use strict";
// The workspace reads and answers forms with JavaScript ports of the server's Python rules. They
// must never drift: this runs both on the same cases and compares. Skipped when the backend (and
// Python) is not beside this folder, as in a desktop-only checkout.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const rules = require("../src/auto/rules");

const backend = path.join(__dirname, "..", "..", "backend");
const have = fs.existsSync(path.join(backend, "app", "autoapply", "browserform.py"));
// Python with the backend's own dependencies (CI's desktop job has neither): otherwise skipped
const py3 = have && spawnSync("python3", ["-c", "import sys; sys.path.insert(0, sys.argv[1]); import app.autoapply.browserform", backend], { cwd: backend }).status === 0;

const LABELS = [["Email address", "x"], ["First Name*", "first_name"], ["Legal Name", "_systemfield_name"], ["Phone number", "p"],
  ["LinkedIn Profile", "dc91"], ["Country", "c"], ["Current company", "c2"], ["Where are you based?", "w"], ["Why us?", "question_1"],
  ["Website / portfolio", "w2"], ["GitHub", "gh"], ["Surname", "s"], ["", "first_name"], ["", "email"], ["Full name", "n"], ["Employer", "e"]];
const PICKS = [[["Yes", "No"], "yes"], [["Yes", "No"], "N"], [["I am a veteran", "I am not a veteran"], "I am not a veteran"],
  [["United Kingdom", "United States", "Nigeria"], "Nigeria"], [["United Kingdom", "United States"], "United"], [["A"], "b"], [["Yes"], ""],
  [["Male", "Female"], "female"], [["Prefer not to say"], "prefer not to say"]];
const DATES = ["2026-03-05", "05/03/2026", "5-3-2026", "5 March 2026", "March 5, 2026", "5 Mar 2026", "Mar 5, 2026", "soon"];
const QLABELS = ["Will you now or in the future require visa sponsorship?", "Are you legally authorized to work in the US?",
  "Are you willing to relocate?", "What are your salary expectations?", "How soon can you start?", "Years of experience with SQL",
  "How did you hear about this job opportunity?", "Cover Letter", "Gender", "Race / Ethnicity", "Veteran Status", "Disability Status",
  "Sexual orientation", "Are you transgender?", "Why do you want to work here?", "Email", ""];
const OPTION_SETS = [["Male", "Female", "Decline to self-identify"], ["Yes", "No", "I do not want to answer"], ["LinkedIn", "Indeed", "Other"],
  ["LinkedIn", "Employee Referral"], ["Job board", "Other"], ["Company website", "Friend"], ["Yes", "No"], ["Prefer not to say", "A"],
  ["I identify as a protected veteran", "I am not a protected veteran", "I decline to self-identify for protected veteran status"]];
const URLS = ["https://jobs.lever.co/a/1", "https://boards.greenhouse.io/x/jobs/1", "https://jobs.ashbyhq.com/x/1", "https://acme.wd1.myworkdayjobs.com/en/x",
  "https://x.bamboohr.com/careers/1", "https://x.bamboohr.com/about", "https://apply.workable.com/x/j/1", "https://example.com/careers", "https://jobs.eu.lever.co/x"];
const CONF = [["greenhouse", "https://x/confirmation", "", "https://x/apply"], ["generic", "https://x/apply", "Thank you for applying!", "https://x/apply"],
  ["lever", "https://jobs.lever.co/x/thanks", "", "https://jobs.lever.co/x/apply"], ["generic", "https://x/apply", "Working on it", "https://x/apply"],
  ["ashby", "https://x", "Your application was successfully submitted.", "https://x"], ["workable", "https://x", "Thank you", "https://x"],
  ["generic", "https://x", "Application submitted", "https://x"], ["generic", "https://x", "Your application has been submitted!", "https://x"],
  ["generic", "https://x", "Thanks for applying to Acme", "https://x"], ["generic", "https://x", "You've applied", "https://x"],
  ["generic", "https://x", "We got your application", "https://x"], ["generic", "https://x", "Submitted application", "https://x"],
  ["generic", "https://x", "Once your application is submitted you will hear from us", "https://x", "Once your application is submitted you will hear from us"],
  ["generic", "https://x", "Once your application is submitted, wait. Application submitted", "https://x", "Once your application is submitted, wait."]];

test("the JavaScript rules give the same answers as the Python ones", { skip: (!have && "backend not present") || (!py3 && "backend not importable here") }, () => {
  const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(backend)})
from app.autoapply import browserform as b, ats
d = json.load(sys.stdin)
print(json.dumps({
  "canonical": [b.canonical(l, k) for l, k in d["labels"]],
  "pick": [b.pick(o, w) for o, w in d["picks"]],
  "date": [b._iso_date(x) for x in d["dates"]],
  "detect": [ats.detect(u).key for u in d["urls"]],
  "semantic": [b.semantic(l) for l in d["qlabels"]],
  "decline": [b.decline_index(o) for o in d["options"]],
  "heard": [b.heard_index(o) for o in d["options"]],
  "conf": [ats.confirmation(ats.BY_KEY[c[0]], c[1], c[2], c[3], c[4] if len(c) > 4 else "") for c in d["conf"]],
  "enabled": sorted(ats.enabled("")),
  "submit": {k: b._submit_selector(ats.BY_KEY[k]) for k in ats.BY_KEY},
  "next": {k: b._next_selector(ats.BY_KEY[k]) for k in ats.BY_KEY},
  "support": {k: [p.support, p.default_on, p.needs_account] for k, p in ats.BY_KEY.items()},
}))`;
  const r = spawnSync("python3", ["-c", py], { input: JSON.stringify({ qlabels: QLABELS, options: OPTION_SETS, labels: LABELS, picks: PICKS, dates: DATES, urls: URLS, conf: CONF }), encoding: "utf8", cwd: backend });
  assert.equal(r.status, 0, r.stderr);
  const want = JSON.parse(r.stdout);
  assert.deepEqual(LABELS.map(([l, k]) => rules.canonical(l, k)), want.canonical);
  assert.deepEqual(PICKS.map(([o, w]) => rules.pick(o, w)), want.pick);
  assert.deepEqual(DATES.map((x) => rules.isoDate(x)), want.date);
  assert.deepEqual(QLABELS.map((l) => rules.semantic(l)), want.semantic);
  assert.deepEqual(OPTION_SETS.map((o) => rules.declineIndex(o)), want.decline);
  assert.deepEqual(OPTION_SETS.map((o) => rules.heardIndex(o)), want.heard);
  assert.deepEqual(URLS.map((u) => rules.detect(u).key), want.detect);
  assert.deepEqual(CONF.map(([k, u, t, bu, bt]) => rules.confirmation(rules.BY_KEY[k], u, t, bu, bt || "")), want.conf);
  assert.deepEqual(rules.PROVIDERS.filter((p) => p.defaultOn).map((p) => p.key).sort(), want.enabled);
  for (const k of Object.keys(want.submit)) {
    assert.equal(rules.submitSelector(rules.BY_KEY[k]), want.submit[k], `submit ${k}`);
    assert.equal(rules.nextSelector(rules.BY_KEY[k]), want.next[k], `next ${k}`);
  }
  for (const [k, [support, on, acct]] of Object.entries(want.support)) {
    const p = rules.BY_KEY[k];
    assert.deepEqual([p.support, !!p.defaultOn, !!p.needsAccount], [support, on, acct], k);
  }
});

test("the scan and validation scripts are the server's own, byte for byte", { skip: !have && "backend not present" }, () => {
  for (const f of ["scan_form.js", "validate_form.js"]) {
    assert.equal(
      fs.readFileSync(path.join(__dirname, "..", "src", "auto", f), "utf8"),
      fs.readFileSync(path.join(backend, "app", "autoapply", f), "utf8"),
      `${f} drifted from the backend copy`,
    );
  }
});
