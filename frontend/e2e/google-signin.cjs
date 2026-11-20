// Real-browser test of "Continue with Google" against the fake Google in fake-google.cjs.
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
const mode = (m) => fetch(`http://localhost:9099/control?mode=${m}`);

(async () => {
  const browser = await chromium.launch();
  const page = await (
    await browser.newContext({ viewport: { width: 1280, height: 900 } })
  ).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(BASE + "/signup");
  const google = page.getByRole("button", { name: /continue with google/i });
  await google.waitFor();
  ok(
    await google.isDisabled(),
    "sign up: Google is disabled until the terms are accepted",
  );
  await page.getByRole("checkbox", { name: /i agree/i }).check();
  await mode("ok");
  await google.click();
  await page.waitForURL("**/onboarding");
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.waitForURL("**/dashboard");
  await page.getByText(/^Hello/).waitFor();
  await skipTour(page);
  ok(
    await page.getByText("google.user@example.com").isVisible(),
    "signed in through Google; the email was normalised to lower case",
  );
  ok(
    (await page.context().cookies()).some(
      (c) => c.httpOnly && c.name !== "oauth_state",
    ),
    "a session cookie was set (HttpOnly)",
  );
  ok(
    !(await page.context().cookies()).some((c) => c.name === "oauth_state"),
    "the one-time state cookie is gone",
  );

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await mode("ok");
  await page.getByRole("button", { name: /continue with google/i }).click();
  await page.waitForURL("**/dashboard");
  ok(
    true,
    "log in again with Google reaches the dashboard (same account, no signup step)",
  );

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await mode("deny");
  await page.getByRole("button", { name: /continue with google/i }).click();
  await page.getByRole("alert").waitFor();
  ok(
    /cancelled/i.test(await page.getByRole("alert").innerText()) &&
      page.url().includes("/login"),
    "denying the Google prompt returns to login with a clear message",
  );
  const apiBase = process.env.API_BASE ?? "http://localhost:8765"; // "" = same origin
  const me = await page.evaluate(
    (base) =>
      fetch(base + "/api/me", { credentials: "include" }).then((r) => r.status),
    apiBase,
  );
  ok(me === 401, "no session exists after a denial (/api/me answers 401)");
  await page.goto(BASE + "/dashboard");
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  ok(true, "still signed out after the denial (dashboard sends me to login)");

  await mode("unverified");
  await page.getByRole("button", { name: /continue with google/i }).click();
  await page.getByRole("alert").waitFor();
  ok(
    /didn't work/i.test(await page.getByRole("alert").innerText()),
    "an unverified Google email is refused",
  );
  await mode("ok");

  ok(errors.length === 0, "no uncaught page errors");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
