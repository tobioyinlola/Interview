// Real-browser test of Settings: tabs, bio data, setting and changing a password, the CV upload that
// moved here from the menu, and that all of it works on a phone.
const { chromium } = require("playwright");
const fs = require("fs");
const { skipTour } = require("./helpers.cjs");
const BASE = "http://localhost:5173";
const SHOTS = (process.env.E2E_SHOTS || "/tmp") + "/settings";
fs.mkdirSync(SHOTS, { recursive: true });
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
const EMAIL = `settings${Date.now()}@example.com`;
const PW1 = "first brand new passphrase";
const PW2 = "second brand new passphrase";

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shot = async (name) => {
    await sleep(400);
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  };

  await page.goto(BASE + "/login");
  await page.getByLabel("Email address").fill(EMAIL);
  const before = links().length;
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  for (let i = 0; i < 60 && links().length <= before; i++) await sleep(100);
  await page.goto(links().pop());
  await page
    .getByRole("button", { name: "Skip for now" })
    .click({ timeout: 4000 })
    .catch(() => {});
  await page.waitForURL("**/dashboard");
  await skipTour(page);

  // the menu has Settings, and no CV item any more
  const nav = page.getByRole("navigation", { name: "Main" });
  ok(
    (await nav.getByRole("link", { name: "CV", exact: true }).count()) === 0,
    "the CV is no longer in the menu",
  );
  await nav.getByRole("link", { name: "Settings" }).click();
  await page.waitForURL("**/settings/profile");
  const tabs = page.getByRole("navigation", { name: "Settings sections" });
  for (const t of ["Profile", "Password", "CV", "Privacy and data"])
    await tabs.getByRole("link", { name: t }).waitFor();
  ok(true, "Settings has Profile, Password, CV and Privacy and data tabs");

  // bio data
  await page.getByLabel("Full name").fill("Ada Okoye");
  await page.getByLabel("Phone number").fill("+234 801 234 5678");
  await page.selectOption("#profile-country", "Nigeria");
  await page.getByLabel("City or town").fill("Lagos");
  await page.fill("#profile-headline", "Senior Product Manager");
  await page
    .getByLabel("LinkedIn or portfolio link")
    .fill("linkedin.com/in/adaokoye");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Saved.").waitFor();
  ok(
    (await page.getByLabel("LinkedIn or portfolio link").inputValue()) ===
      "https://linkedin.com/in/adaokoye",
    "bio data is saved, and the address is tidied",
  );
  await shot("1-profile");
  await page.reload();
  ok(
    (await page.getByLabel("Phone number").inputValue()) ===
      "+234 801 234 5678",
    "it is still there after a reload",
  );
  ok(
    (await page
      .getByLabel("Email address")
      .isDisabled()
      .catch(() => false)) ||
      (await page.getByLabel("Email address").getAttribute("readonly")) !==
        null,
    "the sign-in email is read-only",
  );
  await page.getByLabel("Phone number").fill("call me");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("alert").waitFor();
  ok(true, "a nonsense phone number is refused with a reason");

  // a first password, then a change
  await tabs.getByRole("link", { name: "Password" }).click();
  await page.getByRole("heading", { name: "Set a password" }).waitFor();
  await page.getByLabel("New password", { exact: true }).fill(PW1);
  await page.getByLabel("Repeat the new password", { exact: true }).fill(PW1);
  await page.getByRole("button", { name: "Set password" }).click();
  await page.getByText(/Password saved/).waitFor();
  await page.getByRole("heading", { name: "Change your password" }).waitFor();
  ok(true, "a first password is set without a current one");
  await page
    .getByLabel("Current password", { exact: true })
    .fill("not it at all, sorry");
  await page.getByLabel("New password", { exact: true }).fill(PW2);
  await page.getByLabel("Repeat the new password", { exact: true }).fill(PW2);
  await page.getByRole("button", { name: "Change password" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "current password" })
    .waitFor();
  ok(true, "changing it with the wrong current password is refused");
  await page.getByLabel("Current password", { exact: true }).fill(PW1);
  await page.getByRole("button", { name: "Change password" }).click();
  await page.getByText(/Password saved/).waitFor();
  await shot("2-password");

  // sign out and back in with the new password
  await page
    .getByRole("button", { name: /Sign out/ })
    .first()
    .click()
    .catch(async () => {
      await page.getByRole("button", { name: "Account" }).click();
      await page.getByRole("menuitem", { name: /Sign out/ }).click();
    });
  await page.waitForURL(/\/($|login)/);
  await page.goto(BASE + "/login");
  await page.getByLabel("Email address").fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PW2);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard");
  ok(true, "signing in works with the new password");

  // the CV tab
  await page.goto(BASE + "/settings/cv");
  await page.getByRole("heading", { name: "Your CV", exact: true }).waitFor();
  await page.fill("#role", "Product Manager");
  await page.setInputFiles(
    'input[type="file"]',
    __dirname + "/fixtures/cv.pdf",
  );
  await page.getByRole("heading", { name: "cv.pdf" }).waitFor();
  ok(true, "the CV is uploaded from Settings");
  await shot("3-cv");
  await page.goto(BASE + "/notes");
  await page.waitForURL("**/settings/cv");
  ok(true, "the old CV address still lands on the CV tab");

  // phone: no sideways scrolling, tabs reachable
  for (const [w, h] of [
    [320, 568],
    [390, 844],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    for (const tab of ["profile", "password", "cv", "privacy"]) {
      await page.goto(`${BASE}/settings/${tab}`);
      await page
        .getByRole("navigation", { name: "Settings sections" })
        .waitFor();
      await sleep(400);
      const fits = await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1,
      );
      ok(fits, `settings/${tab} fits a ${w}px screen`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + "/settings/privacy");
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("link", { name: "Privacy and data" })
    .scrollIntoViewIfNeeded();
  await shot("4-phone-privacy");
  ok(
    errors.length === 0,
    "no uncaught page errors" + (errors.length ? ": " + errors[0] : ""),
  );
  await browser.close();
})();
