"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const g = require("../src/auto/guard");

test("only public https pages are reachable", async () => {
  for (const bad of ["http://jobs.lever.co/x", "https://localhost/x", "https://127.0.0.1/x", "https://[::1]/x",
    "https://10.0.0.5/x", "https://user:pw@jobs.lever.co/x", "https://jobs.lever.co:8443/x", "file:///etc/passwd",
    "javascript:alert(1)", "https://intranet.internal/x", "data:text/html,hi", "not a url"]) {
    assert.equal(g.syntaxAllowed(bad), false, bad);
  }
  assert.equal(g.syntaxAllowed("https://jobs.lever.co/acme/1"), true);
  assert.equal(g.syntaxAllowed("https://boards.greenhouse.io/x/jobs/1?gh_jid=1"), true);
});

test("a name that resolves to a private address is refused", async () => {
  const lookup = async (h) => (h === "evil.example" ? [{ address: "10.1.2.3" }] : [{ address: "93.184.216.34" }]);
  assert.equal(await g.allowed("https://evil.example/apply", { lookup }), false);
  assert.equal(await g.allowed("https://good.example/apply", { lookup }), true);
  assert.equal(await g.allowed("https://nowhere.example/", { lookup: async () => { throw new Error("nx"); } }), false);
});

test("private ranges", () => {
  for (const ip of ["10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "127.0.0.1", "100.64.0.1", "fe80::1", "::ffff:10.0.0.1"]) assert.equal(g.privateAddress(ip), true, ip);
  for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"]) assert.equal(g.privateAddress(ip), false, ip);
});
