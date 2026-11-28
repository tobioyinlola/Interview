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
  toggle.textContent = v.state === "stopped" || v.state === "idle" ? "Start" : paused ? "Resume" : "Pause";
  toggle.dataset.action = v.state === "stopped" || v.state === "idle" ? "start" : paused ? "resume" : "pause";
  toggle.className = paused || v.state === "idle" ? "p" : "";
  $("stop").disabled = v.state === "stopped" || v.state === "idle" || v.state === "ended";
  $("skip").disabled = !cur || ["Done", "Failed", "Skipped", "Cancelled"].includes(cur.stage);
  for (const b of document.querySelectorAll("[data-s]")) b.className = b.dataset.s === v.speed ? "on" : "";

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

async function tick() {
  try { render(await bridge.snapshot()); } catch { /* offline: try again */ }
}
$("toggle").addEventListener("click", async (e) => { await bridge.control(e.currentTarget.dataset.action || "pause"); tick(); });
$("skip").addEventListener("click", async () => { await bridge.control("skip"); tick(); });
$("stop").addEventListener("click", async () => { await bridge.control("stop"); tick(); });
for (const b of document.querySelectorAll("[data-s]")) b.addEventListener("click", async () => { await bridge.speed(b.dataset.s); tick(); });
$("cont").addEventListener("click", () => bridge.answer("continue"));
$("leave").addEventListener("click", () => bridge.answer("skip"));
tick();
setInterval(tick, 1500);
