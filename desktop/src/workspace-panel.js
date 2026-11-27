"use strict";
// The workspace panel. It shows what the server says is happening and sends the controls back. All
// text comes from the server or from an employer's page, so it is only ever put in as text.
const $ = (id) => document.getElementById(id);
const set = (id, v) => { $(id).textContent = v == null ? "" : String(v); };
const bridge = window.workspace;

function render(v) {
  if (!v) return;
  const cur = v.view.current;
  set("who", cur ? `${cur.company || ""}${cur.title ? " · " + cur.title : ""}` : "Waiting for the next application");
  const why = (kinds) => {
    const e = [...v.view.events].reverse().find((x) => kinds.includes(x.kind));
    return e && e.data && e.data.reason ? ` (${e.data.reason})` : "";
  };
  const reason = cur && cur.stage === "Failed" ? why(["application_failed"]) : cur && cur.stage === "Waiting for you" ? why(["review_required"]) : "";
  set("stage", cur ? `${cur.stage || ""}${reason}${cur.ats_label ? " · " + cur.ats_label : ""}` : v.view.state === "paused" ? "Paused" : v.view.state === "stopped" ? "Stopped" : "");
  $("prog").style.width = `${cur ? cur.progress : 0}%`;
  set("q", cur && cur.question ? `Question: ${cur.question}` : "");
  set("meta", cur ? [cur.score != null ? `Match ${Math.round(cur.score * 100)}%` : "", cur.cv_version ? `CV ${cur.cv_version}` : "", `Step ${cur.step}`].filter(Boolean).join(" · ") : "");
  const c = v.view.counters;
  set("c-queued", c.queued); set("c-verified", c.verified); set("c-needs", c.needs_you);
  set("c-failed", c.failed); set("c-skipped", c.skipped); set("c-today", c.verified_today);
  $("speed").value = v.view.speed;
  $("pause").disabled = v.view.state === "paused" || v.view.state === "stopped";
  $("resume").disabled = v.view.state === "running" || v.view.state === "idle";
  $("skip").disabled = !cur || ["Done", "Failed", "Skipped"].includes(cur.stage);
  const log = $("log"); log.replaceChildren();
  for (const e of v.view.events.slice(-30).reverse()) {
    const li = document.createElement("li");
    li.textContent = `${e.text}${e.data && (e.data.label || e.data.reason) ? ": " + (e.data.label || e.data.reason) : ""}`;
    log.appendChild(li);
  }
  const need = $("need");
  need.style.display = v.person ? "block" : "none";
  if (v.person) set("needText", v.person);
}

async function tick() {
  try { render(await bridge.snapshot()); } catch { /* offline: try again */ }
}
for (const [id, action] of [["pause", "pause"], ["resume", "resume"], ["skip", "skip"], ["stop", "stop"]]) {
  $(id).addEventListener("click", async () => { await bridge.control(action); tick(); });
}
$("speed").addEventListener("change", async (e) => { await bridge.speed(e.target.value); tick(); });
$("cont").addEventListener("click", () => bridge.answer("continue"));
$("leave").addEventListener("click", () => bridge.answer("skip"));
tick();
setInterval(tick, 1500);
