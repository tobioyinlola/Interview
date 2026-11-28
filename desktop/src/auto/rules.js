"use strict";
// What the server's browser engine knows about forms, in JavaScript, so the desktop workspace
// reads and fills a form the same way. Pure functions, no Electron: test/parity.test.js checks them
// against the Python originals (backend/app/autoapply/browserform.py and ats.py) on shared cases.

const MAX_OPTIONS = 80;
const MAX_STEPS = 8;
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

const CANON = [
  ["first_name", /first.?name|given.?name/],
  ["last_name", /last.?name|family.?name|surname/],
  ["email", /e-?mail/],
  ["phone", /phone|mobile|telephone/],
  ["linkedin", /linked.?in/],
  ["github", /github/],
  ["website", /website|portfolio|personal (site|url)/],
  ["current_company", /current (company|employer)|^org$|^employer/],
  ["country", /^country/],
  ["location", /location|^city\b|where are you (based|located)|^address/],
  ["name", /^(legal |full |your )?name$/],
];
const SYSTEM_FIELDS = {
  _systemfield_name: "name",
  _systemfield_email: "email",
  _systemfield_location: "location",
};

function canonical(label, key) {
  const low = String(label || "").toLowerCase().trim();
  const k = String(key || "").toLowerCase();
  if (SYSTEM_FIELDS[k]) return SYSTEM_FIELDS[k];
  if (low.length <= 40) for (const [name, re] of CANON) if (re.test(low)) return name;
  for (const [name, re] of CANON.slice(0, 7)) {
    const m = k.match(re);
    if (k === name || (m && m[0] === k)) return name;
  }
  return key;
}

// Questions forms ask in their own words, under one name each, so one saved answer fits every form.
const QUESTIONS = [
  ["requires_sponsorship", /sponsor/],
  ["work_authorization", /(legally|authori[sz]ed|eligible|right) .*work|work authori[sz]ation|work (in|within) the (us|u\.s\.|united states|uk|country)/],
  ["relocate", /relocat/],
  ["salary_expectation", /(salary|compensation|pay) (expectation|requirement|range)|expected (salary|compensation)|desired (salary|compensation)/],
  ["notice_period", /notice period|how soon can you start|available to start|earliest .*start|start date/],
  ["years_experience", /years of .*experience|how many years/],
  ["how_heard", /how did you (hear|find|learn)|where did you (hear|find|learn)|how .*hear about/],
  ["cover_letter", /cover letter/],
  ["eeo_gender", /\bgender\b/],
  ["eeo_race", /\brace\b|ethnic|hispanic|latino/],
  ["eeo_veteran", /veteran/],
  ["eeo_disability", /disabilit/],
  ["eeo_orientation", /sexual orientation|lgbt/],
  ["eeo_transgender", /transgender/],
];

/** The name a question goes by, when it is one of the usual ones: null otherwise. */
function semantic(label) {
  const low = String(label || "").toLowerCase();
  for (const [name, re] of QUESTIONS) if (re.test(low)) return name;
  return null;
}

// A voluntary self-identification question always has a way to decline; choosing it is honest and
// is what the form offers for exactly this.
const DECLINE = /decline|prefer not|do not wish|don'?t wish|do not want to (answer|say|disclose)|rather not|not to (say|answer|disclose|identify)|choose not|no answer/;
const HEARD = [/job board/, /\bother\b/, /internet|online|search|website/];

/** The option that declines a voluntary question: its index, or null when there is none. */
function declineIndex(options) {
  for (let i = 0; i < options.length; i++) if (DECLINE.test(String(options[i]).toLowerCase())) return i;
  return null;
}

/** How the candidate heard about the job: the app found it on a job board. Never a named person
 *  or a company. */
function heardIndex(options) {
  for (const re of HEARD) {
    for (let i = 0; i < options.length; i++) if (re.test(String(options[i]).toLowerCase())) return i;
  }
  return null;
}

/** Answers the app can give by itself, for the questions it can honestly answer: declining a
 *  voluntary self-identification, and where the job was found. Everything else is the candidate's
 *  (their own saved answer) or is asked of them. Never overrides an answer the candidate has. */
function resolve(controls, values) {
  const out = {};
  for (const c of controls) {
    if (values[c.name] || !c.options.length || c.kind !== "choice") continue;
    let i = null;
    if (c.name.startsWith("eeo_")) i = declineIndex(c.options);
    else if (c.name === "how_heard") i = heardIndex(c.options);
    if (i != null) out[c.name] = c.options[i];
  }
  return out;
}

function norm(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function pick(options, wanted) {
  const w = norm(wanted);
  if (!w) return null;
  for (let i = 0; i < options.length; i++) if (norm(options[i]) === w) return i;
  for (let i = 0; i < options.length; i++) {
    const n = norm(options[i]);
    if (n && (n.includes(w) || w.includes(n)) && Math.min(n.length, w.length) >= 2) return i;
  }
  return null;
}

function controlsFrom(raw) {
  const out = [];
  for (const c of raw.controls) {
    const label = c.label;
    const ctl = c.ctl;
    const options = c.options.length <= 400 ? c.options.filter(Boolean).slice(0, MAX_OPTIONS) : [];
    const mk = (name, lab, kind, extra = {}) => ({
      name, label: lab, kind, required: !!c.required, selector: c.selector, ctl,
      options: [], multi: false, one: "", itype: "", ...extra,
    });
    if (ctl === "file") {
      const hay = `${label} ${c.key}`;
      const name = /cover/i.test(hay) ? "cover_letter" : /resume|cv|curriculum/i.test(hay) ? "resume" : c.key;
      out.push(mk(name, label || name, "file"));
    } else if (ctl === "single") {
      out.push(mk(c.key, c.one || label, "declaration"));
    } else if (ctl === "buttons") {
      const slug = "q_" + label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
      out.push(mk(semantic(label) || slug, label || slug, "choice", { options }));
    } else if (ctl === "group" || ctl === "select" || ctl === "combo") {
      const std = ctl !== "group" ? canonical(label, c.key) : c.key;
      const name = std === c.key ? semantic(label) || std : std;
      out.push(mk(name, label || c.key, "choice", { options, multi: !!c.multi }));
    } else {
      const std = canonical(label, c.key);
      out.push(mk(std === c.key ? semantic(label) || std : std, label || c.key, "text", { itype: String(c.type || "") }));
    }
  }
  return out;
}

function unanswered(controls, values) {
  const need = [];
  for (const c of controls) {
    if (!c.required || c.kind === "file" || c.kind === "captcha" || values[c.name]) continue;
    const item = {
      kind: c.kind === "declaration" ? "declaration" : "answer",
      field: c.name,
      question: c.label,
      reason: "The form asks this and you have not answered it yet.",
    };
    if (c.options.length) item.options = [...c.options];
    need.push(item);
  }
  return need;
}

function isoDate(value) {
  const v = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const pad = (n) => String(n).padStart(2, "0");
  let m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m = v.match(/^(\d{1,2}) ([A-Za-z]+),? (\d{4})$/);
  if (m) {
    const i = months.findIndex((x) => x === m[2].toLowerCase() || x.slice(0, 3) === m[2].toLowerCase());
    if (i >= 0) return `${m[3]}-${pad(i + 1)}-${pad(m[1])}`;
  }
  m = v.match(/^([A-Za-z]+) (\d{1,2}),? (\d{4})$/);
  if (m) {
    const i = months.findIndex((x) => x === m[1].toLowerCase() || x.slice(0, 3) === m[1].toLowerCase());
    if (i >= 0) return `${m[3]}-${pad(i + 1)}-${pad(m[2])}`;
  }
  return v;
}

// ------------------------------------------------------------------------------------ the ATS

const PROVIDERS = [
  { key: "greenhouse", hosts: ["boards.greenhouse.io", "job-boards.greenhouse.io", "job-boards.eu.greenhouse.io"],
    markers: ["greenhouse.io/embed", "gh_jid", 'id="application_form"'], submit: "#submit_app, button[type=submit]",
    next: "", successUrl: "/confirmation|/thanks", successText: "thank you for applying|your application has been submitted",
    support: "live", defaultOn: true },
  { key: "ashby", hosts: ["jobs.ashbyhq.com"], markers: ["ashby-application-form", "ashbyhq.com"],
    submit: ".ashby-application-form-submit-button", next: "", successUrl: "",
    successText: "application (was )?successfully submitted|thank you for applying", support: "fixture", defaultOn: true },
  { key: "lever", hosts: ["jobs.lever.co", "jobs.eu.lever.co"], markers: ["lever-application-form", "postings-btn", "lever.co"],
    submit: "#btn-submit, button.postings-btn[type=submit], button[data-qa=btn-submit]", next: "", successUrl: "/thanks",
    successText: "application submitted|thanks for applying|we've received your application", support: "fixture", defaultOn: true },
  { key: "smartrecruiters", hosts: ["jobs.smartrecruiters.com", "careers.smartrecruiters.com"], markers: ["smartrecruiters"],
    submit: "button[type=submit]:has-text('Submit'), button:has-text('Submit application')",
    next: "button:has-text('Next'), button:has-text('Continue')", successUrl: "",
    successText: "thank you|application (has been )?(submitted|received)", support: "untested", defaultOn: false },
  { key: "workable", hosts: ["apply.workable.com", "jobs.workable.com"], markers: ["workable.com", 'data-ui="application-form"'],
    submit: "button[data-ui=apply-button], button:has-text('Submit application')",
    next: "button:has-text('Next'), button:has-text('Continue')", successUrl: "",
    successText: "thank you for applying|application (was )?(submitted|received)", support: "untested", defaultOn: false },
  { key: "recruitee", hosts: ["recruitee.com"], markers: ["recruitee"],
    submit: "button:has-text('Send application'), button[type=submit]", next: "", successUrl: "",
    successText: "thank you for (applying|your application)|application (has been )?sent", support: "untested", defaultOn: false },
  { key: "workday", hosts: ["myworkdayjobs.com", "myworkdaysite.com"], markers: ["data-automation-id", "workday", "myworkdayjobs"],
    submit: "button[data-automation-id=bottom-navigation-next-button]", next: "button[data-automation-id=bottom-navigation-next-button]",
    successUrl: "", successText: "", needsAccount: true, support: "untested", defaultOn: false },
  { key: "bamboohr", hosts: ["bamboohr.com"], path: "/(careers|jobs)", markers: ["bamboohr"],
    submit: "button:has-text('Submit Application'), button[type=submit]", next: "", successUrl: "",
    successText: "thank you|application (has been )?(submitted|received)", support: "untested", defaultOn: false },
];
const GENERIC = { key: "generic", hosts: [], markers: [], submit: "", next: "", successUrl: "", successText: "", support: "untested", defaultOn: false };
const BY_KEY = Object.fromEntries([...PROVIDERS, GENERIC].map((p) => [p.key, p]));

const SUCCESS_URL = /\/(confirmation|thank|submitted|success|applied)/i;
const SUCCESS_TEXT = /thank you for (applying|your application|your interest|submitting)|application (has been )?(submitted|received|sent|complete)|we(?:'ve| have) received your application|successfully submitted/i;

function hostMatches(p, url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  const host = u.hostname.toLowerCase();
  if (!p.hosts.some((h) => host === h || host.endsWith("." + h))) return false;
  return !p.path || new RegExp(p.path, "i").test(u.pathname || "");
}

function detect(url, html = "") {
  for (const p of PROVIDERS) if (hostMatches(p, url)) return p;
  if (html) {
    const low = html.toLowerCase();
    for (const p of PROVIDERS) if (p.markers.filter((m) => low.includes(m.toLowerCase())).length >= 2) return p;
  }
  return GENERIC;
}

function confirmation(system, url, text, beforeUrl = "") {
  let m = text.match(SUCCESS_TEXT) || (system.successText ? text.match(new RegExp(system.successText, "i")) : null);
  if (m) return m[0].slice(0, 200);
  if (url !== beforeUrl && (SUCCESS_URL.test(url) || (system.successUrl && new RegExp(system.successUrl, "i").test(url)))) return url.slice(0, 200);
  return null;
}

const GENERIC_SUBMIT = "button[type=submit], input[type=submit], button:has-text('Submit'), button:has-text('Apply')";
const GENERIC_NEXT = "button:has-text('Next'), button:has-text('Continue'), input[type=button][value=Next], [role=button]:has-text('Next')";
const submitSelector = (s) => [s.submit, GENERIC_SUBMIT].filter(Boolean).join(", ");
const nextSelector = (s) => [s.next, GENERIC_NEXT].filter(Boolean).join(", ");

module.exports = {
  MAX_OPTIONS, MAX_STEPS, MAX_DOCUMENT_BYTES, canonical, semantic, declineIndex, heardIndex, resolve, norm, pick, controlsFrom, unanswered, isoDate,
  PROVIDERS, GENERIC, BY_KEY, detect, confirmation, submitSelector, nextSelector,
};
