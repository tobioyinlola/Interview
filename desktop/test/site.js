"use strict";
// A small employer site served from this machine: the pages the tests apply to. Nothing here is a
// real employer, and nothing leaves the machine.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const page = (n) => fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8");
const ROUTES = {
  "/jobs/1": "greenhouse.html", "/jobs/captcha": "captcha.html", "/jobs/silent": "silent.html",
  "/ashby/jobs/1": "ashby.html", "/jobs/probe": "probe.html", "/ashby/modern": "ashby-modern.html", "/jobs/invisible": "invisible-required.html", "/jobs/submitted": "submitted-text.html", "/jobs/interstitial": "interstitial.html", "/jobs/steps": "steps.html", "/jobs/clearance": "declaration.html",
};

// Invisible reCAPTCHA as Ashby and many others load it: a small badge in the corner and a hidden
// challenge frame. It asks nothing of a person, so the form must go on as if it were not there.
const INVISIBLE = `
 <div class="grecaptcha-badge" data-style="bottomright" style="width:256px;height:60px;position:fixed;bottom:14px;right:-186px;box-shadow:0 0 5px gray">
  <div class="grecaptcha-logo"><iframe title="reCAPTCHA" width="256" height="60" src="/recaptcha/enterprise/anchor?ar=1&k=x&size=invisible"></iframe></div>
  <textarea id="g-recaptcha-response" name="g-recaptcha-response" class="g-recaptcha-response" style="display:none"></textarea>
 </div>
 <div style="visibility:hidden;position:absolute;top:-10000px"><div><iframe title="recaptcha challenge expires in two minutes" width="400" height="580" src="/recaptcha/enterprise/bframe?k=x"></iframe></div></div>`;
// The same, except the first press brings up a visible picture puzzle (a low score) and sends nothing.
const PUZZLE = INVISIBLE + `
 <div id="puzzle" style="display:none;position:fixed;top:40px;left:40px;z-index:9"><iframe title="recaptcha challenge" width="400" height="580" src="/recaptcha/api2/bframe?k=x"></iframe></div>
 <script>
  const realSend = send; let passed = false;
  send = function () { if (!passed && !missing().length) { document.getElementById("puzzle").style.display = "block"; return; } return realSend(); };
  window.passPuzzle = () => { passed = true; document.getElementById("puzzle").style.display = "none"; send(); };
 </script>`;
const VARIANTS = { "/ashby/recaptcha": INVISIBLE, "/ashby/puzzle": PUZZLE };

function parseMultipart(buf, type) {
  const m = /boundary=(.+)$/.exec(type || "");
  const fields = {};
  if (!m) return fields;
  for (const part of buf.toString("latin1").split("--" + m[1])) {
    const h = /name="([^"]+)"(?:; filename="([^"]*)")?\r\n(?:Content-Type: [^\r\n]*\r\n)?\r\n([\s\S]*?)\r\n$/.exec(part);
    if (h) fields[h[1]] = h[2] !== undefined ? { filename: h[2], size: Buffer.byteLength(h[3], "latin1") } : h[3];
  }
  return fields;
}

function start() {
  const received = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const html = (b, code = 200) => { res.writeHead(code, { "content-type": "text/html" }); res.end(b); };
    if (req.method === "GET" && ROUTES[url.pathname]) return html(page(ROUTES[url.pathname]));
    if (req.method === "GET" && VARIANTS[url.pathname]) return html(page("ashby-modern.html").replace("</body>", VARIANTS[url.pathname] + "</body>"));
    if (req.method === "GET" && url.pathname === "/confirmation") return html("<html><body><h2>Thank you for applying!</h2></body></html>");
    if (req.method === "POST" && url.pathname === "/probe-report") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => { try { received.probe = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* ignore */ } res.writeHead(204); res.end(); });
      return;
    }
    if (req.method === "POST") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        if (url.pathname === "/silent") return html("<html><body><p>Working on it...</p></body></html>");
        if (url.pathname === "/ashby/apply") { received.push(parseMultipart(body, req.headers["content-type"])); res.writeHead(200); return res.end("{}"); }
        if (url.pathname === "/apply") {
          received.push(parseMultipart(body, req.headers["content-type"]));
          res.writeHead(303, { location: "/confirmation" });
          return res.end();
        }
        html("not found", 404);
      });
      return;
    }
    html("not found", 404);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    resolve({ origin: `http://127.0.0.1:${server.address().port}`, received, close: () => new Promise((r) => server.close(r)) });
  }));
}
module.exports = { start };
