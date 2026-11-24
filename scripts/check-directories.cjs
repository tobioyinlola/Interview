// Opens each directory page in a real browser and reports what it shows: the HTTP status, how much text
// the page has once its scripts have run, and how many different outside websites it links to (the
// companies' own sites). A page with plenty of both can be read; a page with no text needs its
// companies pasted in; a 403/404 is not a page we can use.
//
//   node scripts/check-directories.cjs '["https://example.com/portfolio", ...]'
//   (with no argument it checks every built-in directory)
//
// Needs Playwright and, from a sandbox, a network that allows the sites.
const { chromium } = require("playwright");
const urls = process.argv[2]
  ? JSON.parse(process.argv[2])
  : JSON.parse(require("child_process").execSync(
      "python3 -c \"import json,sys; sys.path.insert(0,'backend'); from app.hunt import directory; print(json.dumps([u for _,u,_ in directory.DEFAULTS]))\"",
    ).toString());
const proxy = process.env.HTTPS_PROXY || "";
(async () => {
  const launch = { args: ["--no-sandbox"] };
  if (proxy) { const u = new URL(proxy); launch.proxy = { server: `${u.protocol}//${u.host}`, username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) }; }
  const b = await chromium.launch(launch);
  const ctx = await b.newContext({ ignoreHTTPSErrors: true, userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36" });
  for (const url of urls) {
    const p = await ctx.newPage();
    try {
      const r = await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await p.waitForTimeout(3500); await p.mouse.wheel(0, 5000); await p.waitForTimeout(1500);
      const i = await p.evaluate(() => {
        const host = location.hostname.replace(/^www\./, "");
        const ext = new Map(); [...document.querySelectorAll("a[href^=http]")].forEach(a => { try { const h = new URL(a.href).hostname.replace(/^www\./, ""); if (!h.endsWith(host) && !/linkedin|twitter|x\.com|facebook|instagram|youtube|medium/.test(h)) ext.set(h, a.textContent.trim().slice(0,25)); } catch {} });
        return { text: document.body.innerText.length, ext: ext.size, sample: [...ext.entries()].slice(0, 5).map(([h,t]) => `${t||"?"}→${h}`).join("; "), head: document.body.innerText.replace(/\s+/g," ").slice(0,110) };
      });
      console.log(String(r && r.status()).padEnd(4), url.padEnd(58), `${i.text}ch ${i.ext} ext |`, i.sample || i.head);
    } catch (e) { console.log("err ", url.padEnd(58), String(e.message).split("\n")[0].slice(0, 60)); }
    await p.close();
  }
  await b.close();
})();
