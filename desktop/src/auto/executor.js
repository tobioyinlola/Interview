"use strict";
// The desktop's side of the hybrid engine. While the workspace window is open it registers with the
// server, asks for the next application it may carry out, runs it in the visible view, reports
// progress, and ends with exactly what the page showed. The server owns every decision: it hands
// the work out under a lease, re-checks everything before the submit button, and decides what
// counts as a success.
//
// The sign-in token lives only here, in the main process. The employer's page never sees it.
const crypto = require("node:crypto");
const { runJob } = require("./engine");
const guard = require("./guard");

const POLL_MS = 8000; // between asking when there is nothing to do
const REGISTER_MS = 30_000; // the server counts a desktop "open" for 90 seconds after it last checked in
const FLUSH_MS = 700;

function create({ api, workspace, version, platform, name, log = () => {}, guardOpts = {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pollMs = POLL_MS }) {
  const executorId = crypto.randomBytes(12).toString("hex");
  let running = false;
  let lastRegister = 0;
  let status = { state: "idle", current: null };
  const listeners = new Set();
  const emit = (patch) => { status = { ...status, ...patch }; for (const l of listeners) l(status); };

  async function register() {
    const out = await api.post("/autoapply/desktop/register", { executor_id: executorId, name, platform, app_version: version });
    lastRegister = Date.now();
    return out;
  }

  async function one() {
    const { job } = await api.post("/autoapply/desktop/claim", { executor_id: executorId });
    if (!job) return false;
    emit({ state: "working", current: { company: job.company, title: job.title, ats: job.ats } });
    const base = `/autoapply/desktop/attempts/${job.attempt_id}`;
    const queue = [];
    let command = null;
    let lost = false;
    let flushing = null;

    const flush = async () => {
      if (!queue.length) return;
      const events = queue.splice(0, queue.length);
      try {
        const r = await api.post(`${base}/events`, { executor_id: executorId, events });
        command = r.command || command;
      } catch (e) {
        if (e.status === 409) lost = true;
      }
    };
    const say = async (kind, data) => {
      queue.push({ kind, data });
      if (kind === "form_discovered" || queue.length >= 5 || kind === "application_validated") {
        await flush();
      } else if (!flushing) {
        flushing = sleep(FLUSH_MS).then(() => { flushing = null; return flush(); });
      }
      if (lost) return "stop";
      return command;
    };

    let outcome;
    try {
      if (!guard.jobUrlAllowed(job.url, guardOpts)) {
        outcome = { status: "failed", message: "That address is not a public https page." };
      } else {
        await workspace.open(job);
        const page = await workspace.driver();
        outcome = await runJob({
          page, job, say,
          command: () => command,
          authorize: async () => {
            await flush();
            try { return await api.post(`${base}/dispatch`, { executor_id: executorId }); }
            catch (e) { return { ok: false, reason: e.status === 409 ? "stop" : "unavailable" }; }
          },
          intervene: (reason) => workspace.askPerson(reason, () => command),
        });
      }
    } catch (e) {
      outcome = { status: "failed", message: "The workspace could not carry this one out." };
      log("job error", e && e.message);
    } finally {
      await flush();
      await workspace.finish();
    }
    if (!lost) {
      const { released, ...rest } = outcome;
      try { await api.post(`${base}/result`, { executor_id: executorId, ...clean(rest) }); }
      catch (e) { log("result not accepted", e && e.status); }
    }
    emit({ state: "idle", current: null });
    return true;
  }

  async function loop() {
    running = true;
    emit({ state: "idle" });
    while (running) {
      try {
        if (Date.now() - lastRegister > REGISTER_MS) {
          const r = await register();
          if (r.stopped || !r.forms_here) { emit({ state: r.stopped ? "stopped" : "idle" }); await sleep(pollMs); continue; }
        }
        const busy = await one();
        if (!busy) await sleep(pollMs);
      } catch (e) {
        log("executor", e && e.message);
        emit({ state: "offline" });
        await sleep(pollMs * 2);
      }
    }
    emit({ state: "closed" });
  }

  return {
    id: executorId,
    start() { if (!running) void loop(); },
    stop() { running = false; },
    get status() { return status; },
    onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    one, register,
  };
}

function clean(o) {
  const out = {};
  for (const k of ["status", "message", "provider", "evidence", "url", "before_url", "steps", "documents", "need", "command", "sent_unknown"]) {
    if (o[k] !== undefined) out[k] = o[k];
  }
  if (typeof out.command !== "string") delete out.command;
  return out;
}

module.exports = { create, clean };
