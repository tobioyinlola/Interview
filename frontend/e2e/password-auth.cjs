// Real-browser test of sign up with a password, log in, wrong password, and password reset.
// Emailed links are read from the API log (local mode prints them instead of sending).
const { chromium } = require("playwright");
const { skipTour } = require("./helpers.cjs");
const fs = require("fs");
const BASE = "http://localhost:5173";
const ok = (cond, msg, detail) => {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("•", msg);
};
const lastLink = (re) =>
  [...fs.readFileSync(process.env.API_LOG, "utf8").matchAll(re)].pop()?.[0];
const waitLink = async (re, before) => {
  for (let i = 0; i < 50; i++) {
    const l = lastLink(re);
    if (l && l !== before) return l;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("no link for " + re);
};
const EMAIL = `pw${Date.now()}@example.com`;
const PASS = "correct horse battery!";
const NEW = "a brand new passphrase!";

(async () => {
  const browser = await chromium.launch();
  const page = await (
    await browser.newContext({ viewport: { width: 1280, height: 900 } })
  ).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (process.env.E2E_DEBUG) {
    page.on("console", (m) =>
      console.log("console:", m.type(), m.text().slice(0, 160)),
    );
    page.on("framenavigated", (f) => console.log("nav:", f.url()));
    page.on(
      "request",
      (r) =>
        r.url().includes("/api/") &&
        console.log(
          "req:",
          r.method(),
          r.url().replace("http://localhost:8765", ""),
        ),
    );
  }

  await page.goto(BASE + "/signup");
  await page.getByLabel("Full name").fill("  Jordan   Reyes ");
  await page.getByLabel("Email address").fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASS);
  await page.getByLabel("Confirm password", { exact: true }).fill(PASS + "x");
  const create = page.getByRole("button", { name: "Create account" });
  ok(
    await create.isDisabled(),
    "Create account is disabled while the passwords differ",
  );
  ok(
    await page.getByText("The passwords don't match.").isVisible(),
    "a mismatch message is shown",
  );
  await page.getByLabel("Confirm password", { exact: true }).fill(PASS);
  ok(
    await create.isDisabled(),
    "Create account is disabled until the terms are accepted",
  );
  const box = page.getByRole("checkbox", { name: /i agree/i });
  const below = await page.evaluate(() => {
    const c = document.querySelector("input[type=checkbox]").closest("label");
    return c.nextElementSibling.textContent;
  });
  ok(
    below === "Create account",
    "the terms checkbox sits directly above the Create account button",
  );
  await page.getByRole("button", { name: "Show password" }).click();
  ok(
    (await page
      .getByLabel("Password", { exact: true })
      .getAttribute("type")) === "text",
    "the reveal button shows the password",
  );
  await page.getByRole("button", { name: "Hide password" }).click();
  ok(
    (await page
      .getByLabel("Password", { exact: true })
      .getAttribute("type")) === "password",
    "and hides it again",
  );
  await box.check();
  await create.click();
  await page.getByText(/confirm your address/i).waitFor();
  ok(true, "sign up tells the person to confirm by email");
  await page.goto(BASE + "/login");
  await page.getByLabel("Email address").fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASS);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("alert").waitFor();
  ok(
    /incorrect/i.test(await page.getByRole("alert").innerText()),
    "the password does not work before the email is confirmed",
  );

  const link = await waitLink(
    /http:\/\/localhost:5173\/login\/verify\?token=[\w-]+/g,
  );
  await page.goto(link);
  await page.waitForURL("**/onboarding");
  ok(
    true,
    "opening the emailed link creates the account and starts onboarding",
  );
  const pick = async (name) => {
    await page.getByRole("radio", { name }).check({ force: true });
    await page.getByRole("button", { name: "Continue" }).click();
  };
  await page.getByText("Step 1 of 4").waitFor();
  ok(
    await page.getByRole("button", { name: "Continue" }).isDisabled(),
    "Continue is disabled until an answer is chosen",
  );
  await pick(/A new job/);
  await page.getByText("Step 2 of 4").waitFor();
  await pick(/Senior/);
  await page.getByText("Step 3 of 4").waitFor();
  await pick(/This week/);
  await page.getByText("Step 4 of 4").waitFor();
  await page
    .getByRole("checkbox", { name: /Structuring my answers/ })
    .check({ force: true });
  await page.getByRole("button", { name: "Finish" }).click();
  await page.getByText("You're all set, Jordan").waitFor();
  ok(true, "the finish screen thanks the person by first name");
  await page.getByRole("link", { name: "Go to your dashboard" }).click();
  await page.waitForURL("**/dashboard");
  await page.getByText(/^Good (morning|afternoon|evening), Jordan/).waitFor();
  await skipTour(page);
  ok(
    true,
    "four answers saved; the dashboard greets the first name with a wave",
  );
  ok(
    await page.getByRole("region", { name: "Your focus" }).isVisible(),
    "the dashboard shows the chosen focus",
  );
  await page.reload();
  await page.getByText(/^Good (morning|afternoon|evening), Jordan/).waitFor();
  ok(
    !page.url().includes("onboarding"),
    "a finished onboarding is not asked again after a reload",
  );

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await page.getByLabel("Email address").fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill("not the password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("alert").waitFor();
  ok(
    /incorrect/i.test(await page.getByRole("alert").innerText()),
    "a wrong password is refused with a clear message",
  );
  await page.getByLabel("Password", { exact: true }).fill(PASS);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard");
  ok(true, "the right password logs in");

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  const before = lastLink(
    /http:\/\/localhost:5173\/reset-password\?token=[\w-]+/g,
  );
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await page.getByRole("heading", { name: "Reset your password" }).waitFor(); // let the route change finish
  await page.getByLabel("Email address").fill(EMAIL);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await page.getByText(/if that address has an account/i).waitFor();
  const reset = await waitLink(
    /http:\/\/localhost:5173\/reset-password\?token=[\w-]+/g,
    before,
  );
  await page.goto(reset);
  await page.getByLabel("New password", { exact: true }).fill(NEW);
  await page.getByLabel("Confirm new password", { exact: true }).fill(NEW);
  await page.getByRole("button", { name: "Save new password" }).click();
  await page.waitForURL("**/dashboard");
  ok(true, "the reset link chooses a new password and signs in");

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await page.getByLabel("Email address").fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASS);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("alert").waitFor();
  ok(
    /incorrect/i.test(await page.getByRole("alert").innerText()),
    "the old password no longer works",
  );
  await page.getByLabel("Password", { exact: true }).fill(NEW);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard");
  ok(true, "the new password works");

  await page.goto(reset);
  await page
    .getByLabel("New password", { exact: true })
    .fill("yet another passphrase!");
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill("yet another passphrase!");
  await page.getByRole("button", { name: "Save new password" }).click();
  await page.getByText(/didn.t work/i).waitFor();
  ok(true, "a used reset link is refused when it is submitted");
  ok(errors.length === 0, "no uncaught page errors");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
