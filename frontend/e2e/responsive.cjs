// Responsive check for the pages that need no seeded data, at phone, folded-phone, landscape and
// tablet sizes. Fails on sideways scrolling, controls under 44px tall, and form text under 16px
// (iPhones zoom the page when you focus a smaller field).
const { chromium } = require("playwright");
const { skipTour } = require("./helpers.cjs");
const fs = require("fs");
const B = "http://localhost:5173";
const SIZES = [
  [280, 640],
  [320, 568],
  [360, 740],
  [390, 844],
  [414, 896],
  [667, 375],
  [768, 1024],
];
const OUT = [
  "/",
  "/signup",
  "/login",
  "/forgot-password",
  "/reset-password?token=abcdefghijklmnop",
  "/login/verify?token=abcdefghijklmnop",
  "/terms",
  "/privacy",
];
const IN = [
  "/dashboard",
  "/onboarding",
  "/referrals",
  "/help",
  "/settings/profile",
  "/settings/password",
  "/settings/cv",
  "/settings/privacy",
  "/auto-apply",
  "/auto-apply/setup",
  "/auto-apply/setup?step=role",
  "/auto-apply/setup?step=preferences",
  "/auto-apply/setup?step=schedule",
  "/auto-apply/setup?step=apply",
  "/auto-apply/setup?step=answers",
  "/auto-apply/applications",
  "/companies",
  "/session/new",
  "/sessions",
];

const probe = () => {
  const de = document.documentElement;
  const found = [];
  if (de.scrollWidth > de.clientWidth) {
    const bad = [...document.querySelectorAll("body *")].find(
      (e) =>
        e.getBoundingClientRect().right > de.clientWidth &&
        getComputedStyle(e).position !== "fixed",
    );
    found.push(
      `sideways scroll by ${de.scrollWidth - de.clientWidth}px (${bad ? bad.tagName.toLowerCase() + " " + String(bad.className).slice(0, 40) : "?"})`,
    );
  }
  const sel =
    "button, input:not([type=hidden]), select, textarea, [role=button], form a:not(label a)";
  for (const e of document.querySelectorAll(sel)) {
    const cs = getComputedStyle(e);
    if (
      cs.visibility === "hidden" ||
      e.getBoundingClientRect().width === 0 ||
      e.closest(".sr-only,[aria-hidden=true]")
    )
      continue;
    const box = (
      e.type === "checkbox" ? e.closest("label") || e : e
    ).getBoundingClientRect();
    const name = (
      e.getAttribute("aria-label") ||
      e.textContent ||
      e.id ||
      e.type ||
      ""
    )
      .trim()
      .slice(0, 26);
    if (box.height < 44)
      found.push(
        `${e.tagName.toLowerCase()} "${name}" is ${Math.round(box.height)}px tall`,
      );
    if (
      /INPUT|TEXTAREA|SELECT/.test(e.tagName) &&
      e.type !== "checkbox" &&
      parseFloat(cs.fontSize) < 16
    )
      found.push(`${e.tagName.toLowerCase()} "${name}" text is ${cs.fontSize}`);
  }
  const shell = document.querySelector("main");
  if (
    shell &&
    /\/(signup|login|forgot-password|reset-password)/.test(location.pathname) &&
    shell.querySelector(".card, [class*=shadow], [class*=rounded-2xl]")
  )
    found.push("a bordered, rounded or shadowed box surrounds the form");
  return found;
};

(async () => {
  const browser = await chromium.launch();
  const email = `resp${Date.now()}@example.com`;
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
  let checks = 0,
    bad = 0;
  for (const [w, h] of SIZES) {
    for (const [paths, st] of [
      [OUT, undefined],
      [IN, state],
    ]) {
      const ctx = await browser.newContext({
        viewport: { width: w, height: h },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: w < 500,
        storageState: st,
      });
      const page = await ctx.newPage();
      for (const p of paths) {
        await page.goto(B + p);
        try {
          await page.waitForSelector("main, h1", {
            state: "attached",
            timeout: 15000,
          });
        } catch (e) {
          console.log(
            `[${w}x${h}] ${p}: the page did not render (${page.url()})`,
          );
          console.log(
            (await page.evaluate(() => document.body.innerText)).slice(0, 300),
          );
          throw e;
        }
        await page.waitForTimeout(350);
        if (process.env.E2E_SHOTS && p === "/dashboard" && st)
          await page.screenshot({
            path: `${process.env.E2E_SHOTS}/dash-${w}.png`,
            fullPage: true,
          });
        const issues = await page.evaluate(probe);
        checks++;
        if (issues.length) {
          bad++;
          console.log(`[${w}x${h}] ${p}: ${[...new Set(issues)].join(" // ")}`);
        }
      }
      await ctx.close();
    }
  }
  console.log(`responsive: ${checks} page-size checks, ${bad} with problems`);
  await browser.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
