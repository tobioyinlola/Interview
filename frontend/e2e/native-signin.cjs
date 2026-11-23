// Real-browser test of Google sign-in from an installed app. Two browser contexts stand in for the
// two programs: "the app" (a web view that cannot run Google itself) and "the system browser" (which
// signs in and gets back the interviewmeet:// link). Uses the fake Google in fake-google.cjs.
const { chromium } = require("playwright");
const { skipTour } = require("./helpers.cjs");
const BASE = "http://localhost:5173";
const ok = (cond, msg) => {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("•", msg);
};

(async () => {
  const browser = await chromium.launch();
  await fetch("http://localhost:9099/control?mode=ok");

  // --- the app: its window cannot run Google, so it asks the shell to open the real browser
  const appCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await appCtx.addInitScript(() => {
    window.interviewMeetDesktop = {
      isDesktop: true,
      platform: "win32",
      systemAudio: true,
      openInBrowser: (url) => {
        window.__opened = url;
      },
    };
  });
  const app = await appCtx.newPage();
  await app.goto(BASE + "/login");
  await app.getByRole("button", { name: /continue with google/i }).click();
  await app.waitForFunction(() => window.__opened);
  const start = new URL(await app.evaluate(() => window.__opened));
  ok(
    start.pathname === "/api/auth/google/start" && start.searchParams.get("app") === "1",
    "the app asks for the browser sign-in at the app's own Google address",
  );
  ok(/^[\w-]{43}$/.test(start.searchParams.get("challenge")), "it sends only a challenge (a hash)");
  ok(!app.url().includes("google"), "the app window itself never leaves the app");

  // --- the system browser: signs in at (fake) Google and lands on the hand-back page
  const sys = await (await browser.newContext()).newPage();
  await sys.goto(start.href);
  await sys.getByRole("link", { name: "Open InterviewMeet" }).waitFor();
  const link = new URL(await sys.getByRole("link", { name: "Open InterviewMeet" }).getAttribute("href"));
  ok(link.protocol === "interviewmeet:" && link.hostname === "auth", "the browser is told to open interviewmeet://auth");
  const code = link.searchParams.get("code");
  ok(code && code.length >= 20, "it carries a one-time code");
  await sys.goto(BASE + "/dashboard");
  await sys.waitForURL("**/login");
  ok(true, "the browser itself was not signed in: the code goes to the app, not a cookie here");

  // --- back in the app: the shell loads /auth/app?code=... and the app swaps it for a session
  const probe = await browser.newContext();
  const stolen = await probe.newPage();
  await stolen.goto(BASE + "/auth/app?code=" + code);
  await stolen.getByRole("alert").waitFor();
  ok(true, "someone who catches the code but has no secret from the app is turned away");

  await app.goto(BASE + "/auth/app?code=" + code);
  // a new account goes to onboarding first; either way the app must end up signed in
  await app.locator("text=/^Hello|Skip for now/").first().waitFor();
  if (await app.getByRole("button", { name: "Skip for now" }).isVisible()) {
    await app.getByRole("button", { name: "Skip for now" }).click();
    await app.waitForURL("**/dashboard");
  }
  await app.getByText(/^Hello/).waitFor();
  await skipTour(app);
  ok(await app.getByText("google.user@example.com").isVisible(), "the app is signed in as the Google account");

  // the code works once
  const again = await appCtx.newPage();
  await again.goto(BASE + "/auth/app?code=" + code);
  await again.getByRole("alert").waitFor();
  ok(true, "the same code cannot be used a second time");

  // ---- creating an account in the app: the confirmation link opens in the browser, the app ends up signed in
  const fs = require("fs");
  const lastLink = () =>
    [...fs.readFileSync(process.env.API_LOG, "utf8").matchAll(/http:\/\/localhost:5173\/login\/verify\?token=[\w-]+/g)].pop()?.[0];
  for (const shell of ["desktop", "android"]) {
    const email = `${shell}${Date.now()}@example.com`;
    const ctx = await browser.newContext({ viewport: { width: shell === "android" ? 390 : 1280, height: 860 }, isMobile: shell === "android", hasTouch: shell === "android" });
    await ctx.addInitScript((kind) => {
      if (kind === "desktop")
        window.interviewMeetDesktop = { isDesktop: true, platform: "win32", systemAudio: true, openInBrowser: () => {} };
      else
        window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android", Plugins: {} };
    }, shell);
    const inApp = await ctx.newPage();
    await inApp.goto(BASE + "/signup");
    await inApp.getByLabel("Full name").fill("App Person");
    await inApp.getByLabel("Email address").fill(email);
    await inApp.getByLabel("Password", { exact: true }).fill("correct horse battery staple 91");
    await inApp.getByLabel("Confirm password", { exact: true }).fill("correct horse battery staple 91");
    await inApp.getByRole("checkbox", { name: /i agree/i }).check();
    await inApp.getByRole("button", { name: "Create account" }).click();
    await inApp.getByText(/bring you back here/i).waitFor();
    ok(true, `${shell} app: sign-up sent, the app says the link will bring the person back`);
    await new Promise((r) => setTimeout(r, 400));
    const verifyLink = lastLink();
    ok(verifyLink, `${shell} app: the confirmation email carries a link`);

    // the link opens in the real browser, not the app
    const browserPage = await (await browser.newContext()).newPage();
    await browserPage.goto(verifyLink);
    const open = browserPage.getByRole("link", { name: "Open InterviewMeet" });
    await open.waitFor();
    const back = new URL(await open.getAttribute("href"));
    ok(back.protocol === "interviewmeet:" && back.searchParams.get("code"), `${shell} app: the browser offers to open the app`);
    await browserPage.goto(BASE + "/dashboard");
    await browserPage.waitForURL("**/login");
    ok(true, `${shell} app: the browser itself was not signed in`);

    // the app picks the hand-back up and the account is signed in inside the app
    await inApp.goto(BASE + "/auth/app?code=" + back.searchParams.get("code"));
    // a new account goes to onboarding first; either way the app must end up signed in
    await inApp.locator("text=/^Hello, App|Skip for now|Good (morning|afternoon|evening),/").first().waitFor();
    if (await inApp.getByRole("button", { name: "Skip for now" }).isVisible()) {
      await inApp.getByRole("button", { name: "Skip for now" }).click();
      await inApp.waitForURL("**/dashboard");
    }
    // the website greets "Hello, App"; the phone app shows "Good evening," then the first name
    await inApp.getByText(shell === "android" ? "App" : /^Hello, App/, { exact: shell === "android" }).first().waitFor({ timeout: 8000 });
    ok(true, `${shell} app: the new account is signed in inside the app, with the name from the form`);
    await ctx.close();
  }

  await browser.close();
  console.log("native-signin: ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
