"use strict";
// The workspace panel. It shows what the server says is happening and sends the controls back. All
// text comes from the server or from an employer's page, so it is only ever put in as text.
const $ = (id) => document.getElementById(id);
const set = (id, v) => { $(id).textContent = v == null ? "" : String(v); };
const bridge = window.workspace;
const TONE = { submission_verified: "ok", application_failed: "bad", review_required: "warn", application_paused: "warn",
  application_skipped: "mute", application_cancelled: "mute", run_paused: "mute", run_stopped: "mute" };

function ago(iso) {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return "";
  if (s < 10) return "now";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

function stateOf(v, waiting) {
  if (waiting) return { text: "Waiting for you", cls: "warn" };
  const c = v.current && v.current.stage;
  if (c === "Failed") return { text: "Failed", cls: "bad" };
  if (c === "Done") return { text: "Sent", cls: "ok" };
  return { running: { text: "Running", cls: "running" }, paused: { text: "Paused", cls: "warn" }, stopped: { text: "Stopped", cls: "bad" },
    idle: { text: "Ready", cls: "" }, ended: { text: "Finished", cls: "" } }[v.state] || { text: "Ready", cls: "" };
}

function render(snap) {
  if (!snap) return;
  const v = snap.view;
  const cur = v.current;
  const st = stateOf(v, !!snap.person);
  $("state").className = `pill ${st.cls}`;
  set("stateText", st.text);
  set("who", cur ? `${cur.company || ""}${cur.title ? " · " + cur.title : ""}` : "Waiting for the next application");
  const why = (kinds) => {
    const e = [...v.events].reverse().find((x) => kinds.includes(x.kind));
    return e && e.data && e.data.reason ? e.data.reason : "";
  };
  const reason = cur && cur.stage === "Failed" ? why(["application_failed"]) : cur && cur.stage === "Waiting for you" ? why(["review_required"]) : "";
  // nothing in progress: say why it is quiet (today's limit, nothing ready, the pause between them)
  const ended = !cur || ["Done", "Failed", "Skipped", "Cancelled", "Waiting for you", "Sent? Check it"].includes(cur.stage);
  if (ended && v.waiting && !snap.person) {
    set("who", cur ? `Last: ${cur.company || ""}${cur.title ? " · " + cur.title : ""}` : "Waiting for the next application");
  }
  set("sub", ended && v.waiting && !snap.person ? v.waiting
    : reason || (cur ? cur.stage || "" : v.state === "paused" ? "Paused. Press Resume to carry on." : v.state === "stopped" ? "Stopped. Press Start to carry on." : "It starts the next one by itself."));
  if (ended && v.waiting && !snap.person && /limit/i.test(v.waiting)) {
    $("state").className = "pill warn"; set("stateText", `Today's limit: ${v.used_today} of ${v.daily_limit}`);
  }
  set("idleText", ended && v.waiting ? v.waiting : "The employer's page appears here while an application is carried out, so you can see it fill in.");
  const chips = $("chips"); chips.replaceChildren();
  for (const t of cur ? [cur.ats_label, cur.score != null ? `${Math.round(cur.score * 100)}% fit` : "", cur.cv_version ? `CV ${cur.cv_version}` : ""] : []) {
    if (!t) continue; const s = document.createElement("span"); s.className = "chip"; s.textContent = t; chips.appendChild(s);
  }
  const p = cur ? cur.progress : 0;
  $("prog").style.width = `${p}%`;
  set("stage", cur ? (cur.fields_total ? `${cur.fields_done} of ${cur.fields_total} fields` : cur.stage || "") : "");
  set("pct", cur ? `${p}%` : "");
  set("step", cur && cur.step > 1 ? `Step ${cur.step}` : "");
  $("q").hidden = !(cur && cur.question);
  set("q", cur && cur.question ? `Answering: ${cur.question}` : "");

  const c = v.counters;
  set("c-queued", c.queued); set("c-verified", c.verified); set("c-needs", c.needs_you);
  set("c-failed", c.failed); set("c-skipped", c.skipped); set("c-today", c.verified_today);

  const paused = v.state === "paused" || v.state === "stopped";
  const toggle = $("toggle");
  if (!toggle.classList.contains("busy")) toggle.textContent = v.state === "stopped" || v.state === "idle" ? "Start" : paused ? "Resume" : "Pause";
  toggle.dataset.action = v.state === "stopped" || v.state === "idle" ? "start" : paused ? "resume" : "pause";
  toggle.className = paused || v.state === "idle" ? "p" : "";
  if (!$("stop").classList.contains("busy")) $("stop").disabled = v.state === "stopped" || v.state === "idle" || v.state === "ended";
  if (!$("skip").classList.contains("busy")) {
    $("skip").disabled = !!v.waiting || !cur || ["Done", "Failed", "Skipped", "Cancelled", "Waiting for you", "Sent? Check it"].includes(cur.stage);
  }
  for (const b of document.querySelectorAll("[data-s]")) b.className = b.dataset.s === v.speed ? "on" : "";

  // what each control will do right now, in plain words
  set("hint", v.state === "stopped" ? "Stopped. Press Start to carry on from your queue."
    : v.state === "paused" ? "Paused. Press Resume to carry on."
    : cur && !["Done", "Failed", "Skipped", "Cancelled", "Waiting for you", "Sent? Check it"].includes(cur.stage)
      ? "Skip moves on to the next job. Stop ends this one before Submit. Pause lets it finish first."
      : "Pause holds the queue. Skip works while an application is running.");
  const retry = $("retry");
  if (!retry.classList.contains("busy")) {
    retry.hidden = !(c.failed > 0);
    retry.textContent = `Try failed ones again (${c.failed})`;
  }

  const need = $("need");
  need.style.display = snap.person ? "block" : "none";
  if (snap.person) set("needText", snap.person);

  const log = $("log"); log.replaceChildren();
  const items = v.events.slice(-30).reverse();
  $("logEmpty").style.display = items.length ? "none" : "block";
  for (const e of items) {
    const li = document.createElement("li");
    li.className = TONE[e.kind] || "";
    const dot = document.createElement("span"); dot.className = "dot";
    const x = document.createElement("span"); x.className = "x";
    const detail = e.data && (e.data.label || e.data.reason);
    x.textContent = detail ? `${e.text}: ${detail}` : e.text;
    const t = document.createElement("span"); t.className = "t"; t.textContent = ago(e.at);
    li.append(dot, x, t); log.appendChild(li);
  }
  // the employer's page covers the left side while an application runs; otherwise say what this is
  $("idle").style.display = "flex";
}

let last = null;
async function tick() {
  try { last = await bridge.snapshot(); render(last); } catch { /* offline: try again */ }
}

/** Say what a button did, for a few seconds. */
let msgTimer = null;
function say(id, text, ok) {
  const m = $(id); m.textContent = text; m.className = `msg ${ok ? "ok" : "bad"}`;
  clearTimeout(msgTimer); msgTimer = setTimeout(() => { m.textContent = ""; }, 6000);
}

/** Press a control: show it working, say what happened, refresh the picture. */
async function press(btn, busyText, run, done) {
  if (btn.disabled) return;
  const label = btn.textContent;
  btn.disabled = true; btn.classList.add("busy"); btn.textContent = busyText;
  try {
    const r = await run();
    if (r && r.ok === false) say("msg", r.message, false);
    else if (done) say("msg", done, true);
  } catch { say("msg", "That did not work. Check your connection and try again.", false); }
  btn.classList.remove("busy"); btn.textContent = label; btn.disabled = false;
  await tick();
}

const ACTIONS = {
  pause: ["Pausing…", "Paused. The one running finishes; nothing new starts until you resume."],
  resume: ["Resuming…", "Running again."],
  start: ["Starting…", "Started. The next application begins shortly."],
};
$("toggle").addEventListener("click", (e) => {
  const a = e.currentTarget.dataset.action || "pause";
  press(e.currentTarget, ACTIONS[a][0], () => bridge.control(a), ACTIONS[a][1]);
});
$("skip").addEventListener("click", (e) => press(e.currentTarget, "Skipping…", () => bridge.control("skip"),
  "Skipped. Nothing was sent for it; the next one starts shortly."));
$("stop").addEventListener("click", (e) => press(e.currentTarget, "Stopping…", () => bridge.control("stop"),
  "Stopped. The application was ended before Submit and is back in your queue. Press Start to carry on."));
for (const b of document.querySelectorAll("[data-s]")) {
  b.addEventListener("click", () => press(b, b.textContent, () => bridge.speed(b.dataset.s), `Speed: ${b.textContent}.`));
}
$("retry").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  if (btn.disabled) return;
  const label = btn.textContent;
  btn.disabled = true; btn.classList.add("busy"); btn.textContent = "Trying again…";
  try {
    const r = await bridge.retryFailed();
    if (!r || r.ok === false) say("retryMsg", (r && r.message) || "That did not work. Try again.", false);
    else {
      const x = r.result;
      const parts = [];
      if (x.queued) parts.push(`${x.queued} back in the queue`);
      if (x.need_you) parts.push(`${x.need_you} need an answer from you`);
      if (x.left_alone) parts.push(`${x.left_alone} may already have reached the employer, so left alone`);
      say("retryMsg", parts.length ? parts.join(" · ") + "." : "Nothing to try again.", true);
    }
  } catch { say("retryMsg", "That did not work. Check your connection and try again.", false); }
  btn.classList.remove("busy"); btn.textContent = label; btn.disabled = false;
  await tick();
});
$("cont").addEventListener("click", () => bridge.answer("continue"));
$("leave").addEventListener("click", () => bridge.answer("skip"));
tick();
setInterval(tick, 1500);
