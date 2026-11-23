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
  await app.waitForURL(/\/(onboarding|dashboard)/);
  if (app.url().includes("onboarding")) {
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

  await browser.close();
  console.log("native-signin: ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
