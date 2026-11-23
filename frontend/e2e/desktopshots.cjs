// Desktop-size check: screenshots of the main pages at common laptop and monitor sizes, and how much
// of the width next to the sidebar the page content actually uses.
const { chromium } = require("playwright");
const { skipTour } = require("./helpers.cjs");
const fs = require("fs");
const B = "http://localhost:5173";
const SIZES = [
  [1920, 1080],
  [1536, 864],
  [1366, 768],
  [1280, 720],
  [1024, 768],
];
const PAGES = [
  "/dashboard",
  "/auto-apply",
  "/auto-apply/setup",
  "/auto-apply/applications",
  "/companies",
  "/sessions",
  "/settings/profile",
  "/settings/cv",
  "/referrals",
  "/help",
];
(async () => {
  const browser = await chromium.launch();
  const email = `desk${Date.now()}@example.com`;
  const seed = await (await browser.newContext()).newPage();
  await seed.goto(B + "/login");
  await seed.getByLabel("Email address").fill(email);
  await seed.getByRole("button", { name: "Email me a sign-in link" }).click();
  await seed.getByText(/check your email/i).waitFor();
  await seed.waitForTimeout(300);
  const link = [
    ...fs
      .readFileSync(process.env.API_LOG, "utf8")
      .matchAll(/http:\/\/localhost:5173\/login\/verify\?token=[\w-]+/g),
  ].pop()[0];
  await seed.goto(link);
  await seed.getByRole("button", { name: "Skip for now" }).click();
  await seed.waitForURL("**/dashboard");
  await skipTour(seed);
  const state = await seed.context().storageState();
  for (const [w, h] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, storageState: state });
    const page = await ctx.newPage();
    for (const p of PAGES) {
      await page.goto(B + p);
      await page.waitForSelector("main", { state: "attached", timeout: 15000 });
      await page.waitForTimeout(500);
      const m = await page.evaluate(() => {
        const main = document.querySelector("main");
        const r = main.getBoundingClientRect();
        let right = 0;
        for (const e of main.querySelectorAll("*")) {
          const b = e.getBoundingClientRect();
          if (b.width > 0 && b.height > 0) right = Math.max(right, b.right);
        }
        return { left: Math.round(r.left), mainRight: Math.round(r.right), contentRight: Math.round(right), vw: innerWidth, sideways: document.documentElement.scrollWidth > innerWidth };
      });
      const avail = m.vw - m.left;
      const used = Math.round(((m.contentRight - m.left) / avail) * 100);
      console.log(`${w}x${h} ${p.padEnd(26)} uses ${String(used).padStart(3)}% of the width${m.sideways ? "  SIDEWAYS SCROLL" : ""}`);
      if (process.env.E2E_SHOTS)
        await page.screenshot({ path: `${process.env.E2E_SHOTS}/desk-${w}-${p.replace(/[^a-z]+/g, "_")}.png`, fullPage: true });
    }
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(2); });
