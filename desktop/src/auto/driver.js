"use strict";
// Drives one page through the browser's own protocol (CDP). `send(method, params)` is all it needs,
// so the same code runs on an Electron view's debugger in the app and on a test browser.
//
// Everything that reads the page runs in an isolated JavaScript world; typing, clicks and uploads
// are real input events from outside the page, as a person's would be.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const lib = fs.readFileSync(path.join(__dirname, "page_lib.js"), "utf8");

const WORLD = "interviewmeet-automation";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeDriver(send, opts = {}) {
  let contextId = null;
  let libReady = false;
  const tmp = opts.tmpDir || fs.mkdtempSync(path.join(os.tmpdir(), "im-docs-"));

  async function world() {
    if (contextId) return contextId;
    const tree = await send("Page.getFrameTree", {});
    const frameId = tree.frameTree.frame.id;
    const w = await send("Page.createIsolatedWorld", { frameId, worldName: WORLD });
    contextId = w.executionContextId;
    libReady = false;
    return contextId;
  }

  async function raw(expression) {
    const id = await world();
    const r = await send("Runtime.evaluate", { expression, contextId: id, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      const msg = (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text;
      const err = new Error(String(msg).slice(0, 300));
      err.page = true;
      throw err;
    }
    return r.result.value;
  }

  /** Evaluate in the isolated world. A navigation destroys the world: make a new one and retry once. */
  async function ev(expression) {
    for (let attempt = 0; ; attempt++) {
      try {
        if (!libReady) { await raw(lib); libReady = true; }
        return await raw(expression);
      } catch (e) {
        const gone = /context|Cannot find|destroyed|navigat|Target closed/i.test(String(e && e.message));
        if (!gone || attempt >= 2) throw e;
        contextId = null; libReady = false;
        await sleep(150);
      }
    }
  }
  const call = (fn, ...args) => ev(`__im.${fn}(${args.map((a) => JSON.stringify(a === undefined ? null : a)).join(",")})`);
  const fnValue = (src) => ev(`(${src})()`);

  async function clickAt(x, y) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }

  const d = {
    ev, call, fnValue,
    sleep,
    invalidate() { contextId = null; libReady = false; },
    url: async () => (await call("state")).url,
    state: () => call("state"),
    count: (sel) => call("count", sel),
    visible: async (sel) => { try { return !!(await call("visible", sel)); } catch { return false; } },
    /** a real click on a control, found by selector (and exact text, for rows of buttons) */
    async click(sel, which, text) {
      const at = await call("locate", sel, which == null ? "first" : which, text || null);
      if (!at) throw new Error("not found");
      await sleep(40);
      if (!at.w || !at.h) return d.clickScript(sel, which === "last" ? (await call("count", sel)) - 1 : which == null || which === "first" ? 0 : which);
      await clickAt(at.x, at.y);
    },
    async clickScript(sel, which) {
      if (!(await call("jsClick", sel, which || 0))) throw new Error("not found");
    },
    /** type into a text box: focus it, empty it, insert the text as typed input */
    async type(sel, text) {
      const at = await call("locate", sel, "first", null);
      if (!at) throw new Error("not found");
      await call("clear", sel);
      await send("Input.insertText", { text });
    },
    async setDate(sel, v) { if (!(await call("setDate", sel, v))) throw new Error("not found"); },
    async select(sel, label) { if (!(await call("select", sel, label))) throw new Error("not found"); },
    async press(key) {
      const code = { Escape: 27, Enter: 13 }[key] || 0;
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, windowsVirtualKeyCode: code });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, windowsVirtualKeyCode: code });
    },
    /** attach a document to a file input. The browser needs a real file: it is written to a private
     *  temporary folder, handed over, and deleted when the application ends. */
    async setFile(sel, name, bytes) {
      const dir = path.join(tmp, crypto.randomBytes(6).toString("hex"));
      fs.mkdirSync(dir, { mode: 0o700 });
      const file = path.join(dir, name.replace(/[^\w. -]+/g, "_")); // the employer sees the real name
      fs.writeFileSync(file, bytes, { mode: 0o600 });
      // the browser reads the file when the form is sent, so it stays until the application has
      // ended (close() removes the private folder)
      const doc = await send("DOM.getDocument", { depth: 0 });
      const q = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: sel });
      if (!q.nodeId) throw new Error("not found");
      await send("DOM.setFileInputFiles", { nodeId: q.nodeId, files: [file] });
    },
    close() { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } },
  };
  return d;
}

module.exports = { makeDriver };
