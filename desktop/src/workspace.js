"use strict";
// The visible automation workspace: one window with the employer's page on the left, where the
// candidate watches the form fill, and the control panel on the right.
//
// The employer's page is untrusted. It is shown in its own view with a throw-away in-memory
// session, no preload script, a sandbox, no permissions, no pop-ups, and only public https
// addresses reachable. It cannot see the panel, the app, the sign-in token or any Electron API.
// The automation drives it from outside through the browser's debugging protocol, in an isolated
// JavaScript world the page cannot reach.
const crypto = require("node:crypto");
const path = require("node:path");
const { createApi } = require("./auto/apiClient");
const { makeDriver } = require("./auto/driver");
const executorLib = require("./auto/executor");
const guard = require("./auto/guard");

const PANEL_W = 360;
const LOAD_MS = 30_000;
const PERSON_MS = 10 * 60_000; // how long a check waits for the person before being handed back

function create({ electron, appVersion, log = () => {}, guardOpts = {} }) {
  const { BrowserWindow, WebContentsView, session, ipcMain } = electron;
  let win = null;
  let view = null;
  let api = null;
  let exec = null;
  let drv = null;
  let person = null; // { reason, resolve }
  let ready = false;

  // ------------------------------------------------------------------ the employer's view
  function makeView() {
    const partition = `im-employer-${crypto.randomBytes(8).toString("hex")}`; // no "persist:": memory only
    const ses = session.fromPartition(partition);
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    const known = new Map();
    ses.webRequest.onBeforeRequest(async (details, cb) => {
      try {
        const u = new URL(details.url);
        if (["data:", "blob:", "about:", "devtools:"].includes(u.protocol)) return cb({ cancel: u.protocol === "devtools:" });
        const asHttps = details.url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
        const key = u.protocol + u.host;
        if (!known.has(key)) known.set(key, guard.allowed(asHttps, guardOpts));
        cb({ cancel: !(await known.get(key)) });
      } catch { cb({ cancel: true }); }
    });
    const v = new WebContentsView({
      webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
        allowRunningInsecureContent: false, javascript: true, spellcheck: false, backgroundThrottling: false },
    });
    const wc = v.webContents;
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    const keepOnPublicHttps = (event, url) => { if (!guard.syntaxAllowed(url, guardOpts)) event.preventDefault(); };
    wc.on("will-navigate", keepOnPublicHttps);
    wc.on("will-redirect", keepOnPublicHttps);
    wc.on("will-attach-webview", (e) => e.preventDefault());
    wc.on("render-process-gone", () => log("employer view crashed"));
    return { v, ses, partition };
  }

  function layout() {
    if (!win || win.isDestroyed()) return;
    const [w, h] = win.getContentSize();
    if (view) view.v.setBounds({ x: 0, y: 0, width: Math.max(200, w - PANEL_W), height: h });
  }

  async function loadJob(url) {
    const wc = view.v.webContents;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The page did not load in time.")), LOAD_MS);
      wc.once("did-fail-load", (_e, code, desc, _u, isMain) => { if (isMain) { clearTimeout(timer); reject(new Error(desc)); } });
      wc.once("did-finish-load", () => { clearTimeout(timer); resolve(); });
      wc.loadURL(url).catch(() => {});
    });
    // forms drawn by script finish filling in a moment after the page loads
    for (let i = 0; i < 30; i++) {
      const has = await wc.executeJavaScript("!!document.querySelector('input, select, textarea')", true).catch(() => false);
      if (has) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  const workspaceApi = {
    async open(job) {
      log("open requested");
      await workspaceApi.finish();
      view = makeView();
      log("view made");
      win.contentView.addChildView(view.v);
      layout();
      const wc = view.v.webContents;
      await wc.loadURL("about:blank"); // the debugger needs a loaded page to attach to
      wc.debugger.attach("1.3");
      log("debugger attached");
      await wc.debugger.sendCommand("Page.enable");
      log("page enabled");
      drv = makeDriver((m, p) => wc.debugger.sendCommand(m, p));
      log("opening", job.url);
      await loadJob(job.url);
      drv.invalidate();
      log("opened");
    },
    async driver() { return drv; },
    askPerson(reason, getCommand) {
      return new Promise((resolve) => {
        const done = (what) => { clearInterval(watch); clearTimeout(limit); person = null; resolve(what); };
        person = { reason, resolve: done };
        const watch = setInterval(() => { const c = getCommand(); if (c === "stop") done("stop"); else if (c === "skip") done("skip"); }, 1000);
        const limit = setTimeout(() => done("skip"), PERSON_MS);
        if (win && !win.isDestroyed()) { win.show(); win.focus(); }
      });
    },
    async finish() {
      if (person) person.resolve("skip");
      if (drv) { drv.close(); drv = null; }
      if (view) {
        const { v, ses } = view;
        view = null;
        try { v.webContents.debugger.detach(); } catch { /* not attached */ }
        try { if (win && !win.isDestroyed()) win.contentView.removeChildView(v); } catch { /* gone */ }
        try { await ses.clearStorageData(); await ses.clearCache(); } catch { /* ignore */ }
        try { v.webContents.close(); } catch { /* ignore */ }
      }
    },
  };

  // ---------------------------------------------------------------------- the panel
  function wireIpc() {
    if (ready) return;
    ready = true;
    const mine = (e) => win && !win.isDestroyed() && e.sender === win.webContents;
    ipcMain.handle("ws:snapshot", async (e) => {
      if (!mine(e) || !api) return null;
      const view = await api.get("/autoapply/run");
      return { view, person: person ? person.reason : null };
    });
    // every control answers { ok, message } so the panel can say what happened (or why not)
    const said = (e) => ({ ok: false, message: (e && e.body && e.body.error && e.body.error.message) || (e && e.message) || "That did not work. Try again." });
    ipcMain.handle("ws:control", async (e, action) => {
      if (!mine(e) || !api || !["pause", "resume", "skip", "stop", "start"].includes(action)) return null;
      try {
        await api.post(`/autoapply/run/${action}`);
        // a skip or stop while the person is being asked takes effect at once
        if (person && (action === "skip" || action === "stop")) person.resolve(action);
        return { ok: true };
      } catch (err) { return said(err); }
    });
    ipcMain.handle("ws:retryFailed", async (e) => {
      if (!mine(e) || !api) return null;
      try { return { ok: true, result: await api.post("/autoapply/applications/retry-failed", {}) }; }
      catch (err) { return said(err); }
    });
    ipcMain.handle("ws:speed", async (e, speed) => {
      if (!mine(e) || !api || !["slow", "normal", "fast"].includes(speed)) return null;
      try { await api.put("/autoapply/run/settings", { speed }); return { ok: true }; }
      catch (err) { return said(err); }
    });
    ipcMain.handle("ws:answer", (e, what) => { if (mine(e) && person) person.resolve(what === "continue" ? "continue" : "skip"); });
  }

  function validBase(base) {
    try {
      const u = new URL(base);
      return u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname));
    } catch { return false; }
  }

  return {
    /** Open the workspace for the signed-in person. `token` and `base` come from the app's own page. */
    open({ token, base, name, platform }) {
      if (!token || !validBase(base)) return false;
      if (win && !win.isDestroyed()) { win.show(); win.focus(); return true; }
      wireIpc();
      api = createApi({ base, token });
      win = new BrowserWindow({
        width: 1320, height: 860, minWidth: 900, minHeight: 600, title: "InterviewMeet Auto-Apply", autoHideMenuBar: true,
        webPreferences: { preload: path.join(__dirname, "workspace-preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false },
      });
      win.webContents.on("will-navigate", (e) => e.preventDefault());
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.on("resize", layout);
      win.on("closed", async () => {
        if (exec) exec.stop();
        await workspaceApi.finish();
        win = null; api = null; exec = null;
      });
      win.loadFile(path.join(__dirname, "workspace.html"));
      exec = executorLib.create({ api, workspace: workspaceApi, version: appVersion, platform, name: name || "This computer", log, guardOpts });
      exec.start();
      return true;
    },
    close() { if (win && !win.isDestroyed()) win.close(); },
    isOpen: () => !!win && !win.isDestroyed(),
    workspace: workspaceApi,
  };
}

module.exports = { create, PANEL_W };
