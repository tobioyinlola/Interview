// Real-browser test of the free trial and the invite reward: three friends sign up through one
// person's link, the reward is redeemed, and sessions run out as they should.
const { chromium } = require("playwright");
const { skipTour } = require("./helpers.cjs");
const fs = require("fs");
const BASE = "http://localhost:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (cond, msg) => {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("•", msg);
};
const links = () =>
  [
    ...fs
      .readFileSync(process.env.API_LOG, "utf8")
      .matchAll(/http:\/\/localhost:5173\/login\/verify\?token=[\w-]+/g),
  ].map((m) => m[0]);
const waitNewLink = async (before) => {
  for (let i = 0; i < 60; i++) {
    const all = links();
    if (all.length > before) return all[all.length - 1];
    await sleep(100);
  }
  throw new Error("no sign-in link");
};
const stamp = Date.now();
const SHOTS = process.env.E2E_SHOTS || "/tmp";
const snap = async (page, name) => {
  await sleep(500);
  await page.screenshot({
    path: `${SHOTS}/referral-${name}.png`,
    fullPage: true,
  });
};

(async () => {
  const browser = await chromium.launch();
  const ctx = async () =>
    (
      await browser.newContext({ viewport: { width: 1280, height: 900 } })
    ).newPage();

  // A signs in and finds their invite link
  const a = await ctx();
  await a.goto(BASE + "/login");
  await a.getByLabel("Email address").fill(`owner${stamp}@example.com`);
  const before = links().length;
  await a.getByRole("button", { name: "Email me a sign-in link" }).click();
  await a.goto(await waitNewLink(before));
  await a.getByRole("button", { name: "Skip for now" }).click();
  await a.waitForURL("**/dashboard");
  await skipTour(a);
  await a
    .getByRole("region", { name: "Your sessions" })
    .getByText(/1\s+session available/)
    .waitFor();
  ok(true, "a new account starts with one free session on the dashboard");
  await a.getByRole("link", { name: "Invite friends" }).first().click();
  await a.getByRole("heading", { name: "Invite friends" }).waitFor();
  const link = await a.getByLabel("Invite link", { exact: true }).inputValue();
  ok(
    /\/signup\?ref=[a-z0-9]{8}$/.test(link),
    "the invite link has a code: " + link,
  );
  const path = new URL(link).pathname + new URL(link).search;
  await snap(a, "1-new-account");

  // three friends sign up through it
  for (let i = 1; i <= 3; i++) {
    const f = await ctx();
    await f.goto(BASE + path);
    await f
      .getByLabel("Full name")
      .fill(`Friend ${["", "One", "Two", "Three"][i]}`);
    await f.getByLabel("Email address").fill(`friend${i}-${stamp}@example.com`);
    await f
      .getByLabel("Password", { exact: true })
      .fill("correct horse battery!");
    await f
      .getByLabel("Confirm password", { exact: true })
      .fill("correct horse battery!");
    await f.getByRole("checkbox", { name: /i agree/i }).check();
    const n = links().length;
    await f.getByRole("button", { name: "Create account" }).click();
    await f.getByText(/confirm your address/i).waitFor();
    await f.goto(await waitNewLink(n));
    await f.waitForURL("**/onboarding");
    await f.close();
    await a.reload();
    // the third friend completes the set: the bar is full and the reward appears
    await a
      .getByText(
        i < 3
          ? new RegExp(`${i} of 3 toward your next free session`)
          : /You earned 1 free session/,
      )
      .waitFor();
    if (i < 3) {
      if (i === 2) await snap(a, "2-two-friends");
      ok(
        (await a
          .getByRole("button", { name: "Redeem free session" })
          .count()) === 0,
        `after ${i} friend(s) there is nothing to redeem yet`,
      );
    }
  }
  await a.getByText(/You earned 1 free session/).waitFor();
  ok(true, "the third friend earns a free session");
  await snap(a, "3-reward-earned");

  // the reward is only usable once redeemed
  await a.getByText("You can start 1 session now.").waitFor();
  await a.getByRole("button", { name: "Redeem free session" }).click();
  await a.getByText("1 from inviting friends").waitFor();
  await a.getByText("You can start 2 sessions now.").waitFor();
  ok(true, "redeeming adds a session to the account");
  await snap(a, "4-redeemed");
  await a.setViewportSize({ width: 390, height: 844 });
  await snap(a, "5-phone");
  await a.setViewportSize({ width: 1280, height: 900 });

  // the same person, on their own browser, with a second email: it does not count
  await a.getByRole("button", { name: "Sign out" }).click();
  await a.getByRole("heading", { name: "Sign in" }).waitFor();
  await a.goto(BASE + path);
  await a.getByLabel("Full name").fill("Second Address");
  await a.getByLabel("Email address").fill(`second-${stamp}@example.org`);
  await a.getByLabel("Password", { exact: true }).fill("correct horse battery!");
  await a
    .getByLabel("Confirm password", { exact: true })
    .fill("correct horse battery!");
  await a.getByRole("checkbox", { name: /i agree/i }).check();
  const m = links().length;
  await a.getByRole("button", { name: "Create account" }).click();
  await a.getByText(/confirm your address/i).waitFor();
  await a.goto(await waitNewLink(m));
  await a.waitForURL("**/onboarding");
  await a.getByRole("button", { name: "Skip for now" }).click();
  await a.waitForURL("**/dashboard");
  await skipTour(a);
  await a.getByRole("button", { name: "Sign out" }).click();
  await a.getByRole("heading", { name: "Sign in" }).waitFor();
  await a.getByLabel("Email address").fill(`owner${stamp}@example.com`);
  const k = links().length;
  await a.getByRole("button", { name: "Email me a sign-in link" }).click();
  await a.goto(await waitNewLink(k));
  await a.waitForURL("**/dashboard");
  await a.goto(BASE + "/referrals");
  await a.getByText(/1 sign-up didn't count/).waitFor();
  ok(true, "a second email on the inviter's own browser did not count");
  await a.getByText("3 friends have signed up").waitFor();
  ok(true, "and the three real friends still do");
  await snap(a, "6-held");

  // use both sessions, then the third is refused
  await a.goto(BASE + "/notes");
  await a.fill("#role", "Product Manager");
  await a.setInputFiles('input[type="file"]', __dirname + "/fixtures/cv.pdf");
  await a.getByRole("heading", { name: "cv.pdf" }).waitFor();
  await sleep(2200);
  for (let i = 1; i <= 2; i++) {
    await a.goto(BASE + "/session/new");
    await a
      .getByRole("option", { name: /No company/ })
      .waitFor({ state: "attached" });
    await a.selectOption("#company", "none");
    await a.getByRole("button", { name: "Start session" }).click();
    await a.getByRole("heading", { name: "Capture" }).waitFor();
    await a.getByRole("button", { name: "End session" }).click();
    ok(
      true,
      `session ${i} started (${i === 1 ? "the free trial" : "the redeemed reward"})`,
    );
  }
  await a.goto(BASE + "/session/new");
  await a.getByText("You have used your free session").waitFor();
  ok(
    await a.getByRole("button", { name: "Start session" }).isDisabled(),
    "the third session cannot be started: payments are coming soon",
  );
  await a.screenshot({
    path: (process.env.E2E_SHOTS || "/tmp") + "/9-no-sessions-left.png",
    fullPage: true,
  });
  await browser.close();
})();
