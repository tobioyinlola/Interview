"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { create } = require("../src/auto/executor");

function fakeApi(job) {
  const calls = [];
  const api = {
    calls,
    async post(path, body) {
      calls.push({ path, body });
      if (path.endsWith("/register")) return { stopped: false, forms_here: true };
      if (path.endsWith("/claim")) return { job: calls.filter((c) => c.path.endsWith("/claim")).length === 1 ? job : null };
      if (path.endsWith("/events")) return { command: null };
      if (path.endsWith("/dispatch")) return { ok: true };
      if (path.endsWith("/result")) return { state: "sent" };
      throw new Error(path);
    },
  };
  return api;
}
const JOB = { attempt_id: "a1", url: "https://jobs.lever.co/x/1", company: "Acme", title: "PM", ats: "lever", values: {}, documents: {} };

test("a claimed job is opened in the workspace, reported, and its result sent once", async () => {
  const api = fakeApi(JOB);
  const opened = [];
  const workspace = {
    open: async (j) => opened.push(j.url), finish: async () => {}, askPerson: async () => "skip",
    driver: async () => ({ fnValue: async () => ({ controls: [], text: "This job is no longer open.", title: "", captcha: false }), ev: async () => "" }),
  };
  const ex = create({ api, workspace, version: "1", platform: "linux", name: "t", sleep: async () => {} });
  await ex.register();
  assert.equal(await ex.one(), true);
  const result = api.calls.find((c) => c.path.endsWith("/result"));
  assert.equal(result.body.status, "failed");
  assert.match(result.body.message, /no longer open/);
  assert.deepEqual(opened, [JOB.url]);
  assert.equal(api.calls.filter((c) => c.path.endsWith("/result")).length, 1);
  assert.equal(await ex.one(), false, "nothing more to do");
});

test("an address that is not a public https page is never opened", async () => {
  const api = fakeApi({ ...JOB, url: "http://169.254.169.254/latest" });
  const workspace = { open: async () => { throw new Error("must not open"); }, finish: async () => {}, askPerson: async () => "skip", driver: async () => ({}) };
  const ex = create({ api, workspace, version: "1", platform: "linux", name: "t", sleep: async () => {} });
  await ex.one();
  const result = api.calls.find((c) => c.path.endsWith("/result"));
  assert.equal(result.body.status, "failed");
});

test("when the server says the attempt is no longer ours, no result is sent", async () => {
  const api = fakeApi(JOB);
  const orig = api.post.bind(api);
  api.post = async (p, b) => { if (p.endsWith("/events")) { const e = new Error("gone"); e.status = 409; throw e; } return orig(p, b); };
  const workspace = {
    open: async () => {}, finish: async () => {}, askPerson: async () => "skip",
    driver: async () => ({ fnValue: async () => ({ controls: [{ ctl: "text", type: "text", key: "x", selector: "#x", label: "X", required: false, options: [], multi: false, one: "" }], text: "", title: "", captcha: false }), ev: async () => "", state: async () => ({}), visible: async () => false, url: async () => "" }),
  };
  const ex = create({ api, workspace, version: "1", platform: "linux", name: "t", sleep: async () => {} });
  await ex.one();
  assert.equal(api.calls.filter((c) => c.path.endsWith("/result")).length, 0);
});
