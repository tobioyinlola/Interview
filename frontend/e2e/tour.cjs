// Screenshots of every page with realistic data, at desktop and phone width, for design review.
// Run through scripts/e2e-live.sh with E2E_TOUR=1. Output: $E2E_SHOTS/tour/.
const { chromium } = require("playwright");
const fs = require("fs");
const B = "http://localhost:5173";
const OUT = (process.env.E2E_SHOTS || require("os").tmpdir()) + "/tour";
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 860 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  const shot = async (name, full = true) => {
    await sleep(400);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
    console.log("•", name);
  };
  // signed out
  for (const [n, p] of [
    ["01-landing", "/"],
    ["02-login", "/login"],
    ["03-signup", "/signup"],
  ]) {
    await page.goto(B + p);
    await shot(n);
  }
  // sign up with a name, through the emailed link
  const email = `tour${Date.now()}@example.com`;
  await page.goto(B + "/signup");
  await page.getByLabel("Full name").fill("Jordan Reyes");
  await page.getByLabel("Email address").fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct horse battery");
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("correct horse battery");
  await page.getByRole("checkbox", { name: /i agree/i }).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByText(/confirm your address/i).waitFor();
  await shot("04-signup-sent");
  await sleep(400);
  const link = [
    ...fs
      .readFileSync(process.env.API_LOG, "utf8")
      .matchAll(/http:\/\/localhost:5173\/login\/verify\?token=[\w-]+/g),
  ].pop()[0];
  await page.goto(link);
  await page.waitForURL("**/onboarding");
  await shot("05-onboarding-1");
  await page.getByRole("radio", { name: /A new job/ }).check({ force: true });
  await page.getByRole("button", { name: "Continue" }).click();
  await shot("06-onboarding-2");
  await page.getByRole("radio", { name: /Senior/ }).check({ force: true });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("radio", { name: /This week/ }).check({ force: true });
  await page.getByRole("button", { name: "Continue" }).click();
  await shot("07-onboarding-4");
  await page
    .getByRole("checkbox", { name: /Structuring my answers/ })
    .check({ force: true });
  await page
    .getByRole("checkbox", { name: /Company questions/ })
    .check({ force: true });
  await page.getByRole("button", { name: "Finish" }).click();
  await shot("08-onboarding-done");
  await page.getByRole("link", { name: "Go to your dashboard" }).click();
  await page.waitForURL("**/dashboard");
  await shot("09-dashboard-new");
  // CV and a company
  await page.goto(B + "/notes");
  await shot("10-cv-empty");
  await page.fill("#role", "Senior Product Manager");
  await page.setInputFiles(
    'input[type="file"]',
    __dirname + "/fixtures/cv.pdf",
  );
  await page.getByRole("heading", { name: "cv.pdf" }).waitFor();
  await shot("11-cv-uploaded");
  await page.goto(B + "/companies");
  await shot("12-companies-empty");
  try {
    await page.getByRole("button", { name: "Add a company" }).first().click();
    await page.fill("#c-name", "Northwind Payments");
    await page.fill("#c-site", "https://northwind.example");
    await page.fill("#c-role", "Senior Product Manager");
    await shot("13-company-form");
    await page.getByRole("button", { name: "Save and research" }).click();
    await page
      .getByText(/Brief ready|Researching/)
      .first()
      .waitFor({ timeout: 20000 });
    await sleep(1500);
    await shot("14-companies");
    await page
      .getByRole("link", { name: /Northwind/ })
      .first()
      .click();
    await sleep(2500);
    await shot("15-company-brief");
  } catch (e) {
    console.log("company step skipped:", String(e.message).slice(0, 100));
  }
  await page.goto(B + "/session/new");
  await shot("16-practice-setup");
  await page.goto(B + "/dashboard");
  await shot("17-dashboard");
  await page.goto(B + "/sessions");
  await shot("18-sessions");
  await page.goto(B + "/settings");
  await shot("19-settings");
  await page.goto(B + "/terms");
  await shot("20-terms");
  // phone
  await ctx.close();
  const state = await (async () => null)();
  await browser.close();
})();
