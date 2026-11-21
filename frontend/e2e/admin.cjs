// Real-browser test of the admin console, plus screenshots of every email template and of the new
// sign-in layout. Run through scripts/e2e-live.sh (the API there treats admin-e2e@example.com as an
// admin). Earlier scripts in the same run leave real accounts and activity for it to look at.
const { chromium } = require("playwright");
const fs = require("fs");
const { skipTour } = require("./helpers.cjs");
const BASE = "http://localhost:5173";
const SHOTS = (process.env.E2E_SHOTS || "/tmp") + "/admin";
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(SHOTS + "/emails", { recursive: true });
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

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shot = async (name, full = true) => {
    await sleep(500);
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
  };

  // the new sign-in and sign-up layout
  await page.goto(BASE + "/login");
  await page.getByTestId("auth-showcase").waitFor();
  ok(
    await page.getByTestId("auth-showcase").isVisible(),
    "on a computer the sign-in page has the showcase on the left",
  );
  const sx = (await page.getByTestId("auth-showcase").boundingBox()).x;
  const fx = (
    await page.getByRole("heading", { name: "Sign in" }).boundingBox()
  ).x;
  ok(sx < fx, "and the form is on the right of it");
  await shot("1-login-desktop", false);
  await page.getByRole("button", { name: "Next slide" }).click();
  await page
    .getByRole("heading", { name: "A strong answer, the moment they ask" })
    .waitFor();
  await shot("2-login-slide-2", false);
  await page.goto(BASE + "/signup");
  await page.getByTestId("auth-showcase").waitFor();
  await shot("3-signup-desktop", false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + "/login");
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  ok(
    !(await page.getByTestId("auth-showcase").isVisible()),
    "on a phone the showcase is gone",
  );
  ok(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
    "and the form fits the phone without sideways scrolling",
  );
  await shot("4-login-phone", false);
  await page.setViewportSize({ width: 820, height: 1000 });
  await page.reload();
  ok(
    !(await page.getByTestId("auth-showcase").isVisible()),
    "and on a tablet too",
  );
  await page.setViewportSize({ width: 1280, height: 900 });

  // sign in as the admin
  await page.goto(BASE + "/login");
  await page.getByLabel("Email address").fill("admin-e2e@example.com");
  const n = links().length;
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  for (let i = 0; i < 60 && links().length <= n; i++) await sleep(100);
  await page.goto(links().pop());
  await page
    .getByRole("button", { name: "Skip for now" })
    .click({ timeout: 4000 })
    .catch(() => {});
  await page.waitForURL("**/dashboard");
  await skipTour(page);
  await page.getByRole("link", { name: "Admin console" }).click();
  await page.getByRole("navigation", { name: "Admin sections" }).waitFor();
  ok(true, "an admin sees the console in the sidebar and can open it");

  // overview
  await page.getByRole("heading", { name: "Overview" }).waitFor();
  await page.getByRole("heading", { name: "Activation funnel" }).waitFor();
  const funnel = await page.getByRole("meter").count();
  ok(funnel >= 5, `the overview draws the funnel (${funnel} steps)`);
  await page.getByText("What needs attention").waitFor();
  await shot("5-overview");

  // users: search, open one, give a free interview
  await page.getByRole("link", { name: "Users" }).click();
  await page.getByRole("table", { name: "People" }).waitFor();
  const people = await page
    .getByRole("table", { name: "People" })
    .getByRole("row")
    .count();
  ok(people > 2, `the user list shows people (${people - 1} rows)`);
  await shot("6-users");
  await page.getByLabel("Search by name or email").fill("example.com");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await sleep(600);
  const first = page
    .getByRole("table", { name: "People" })
    .getByRole("link")
    .first();
  const who = await first.innerText();
  await first.click();
  await page.getByRole("heading", { name: who }).waitFor();
  await page.getByRole("heading", { name: "Activity" }).waitFor();
  await page.getByLabel("How many").fill("2");
  await page.getByLabel(/Reason/).fill("Thanks for testing");
  await page.getByRole("button", { name: "Give free interviews" }).click();
  await page.getByText(/Added 2 free interviews/).waitFor();
  ok(true, "an admin can open one person and give them free interviews");
  await shot("7-user");

  // the activity log shows that gift, against the admin
  await page.getByRole("link", { name: "Activity log" }).click();
  await page.getByRole("list", { name: "Platform activity" }).waitFor();
  await page.getByText("Admin gave free interviews").first().waitFor();
  const entries = await page
    .getByRole("list", { name: "Platform activity" })
    .getByRole("listitem")
    .count();
  ok(
    entries >= 10,
    `the activity log lists what has happened (${entries} entries)`,
  );
  ok(
    (await page.getByText("by admin-e2e@example.com").count()) >= 1,
    "and names the admin who acted",
  );
  await page.getByLabel("Kind").selectOption("email");
  await sleep(800);
  await shot("8-activity-emails");
  const csv = await page.evaluate(async () => {
    const r = await fetch("/api/admin/activity/export.csv", {
      credentials: "include",
    });
    return {
      status: r.status,
      type: r.headers.get("content-type"),
      head: (await r.text()).split(/\r?\n/)[0],
    };
  });
  ok(
    csv.status === 200 && csv.head === "time,kind,what,user,detail",
    "the log downloads as a spreadsheet",
  );

  // referrals, marketing, quality
  await page.getByRole("link", { name: "Referrals" }).click();
  await page.getByRole("heading", { name: "Top inviters" }).waitFor();
  await page.getByRole("heading", { name: "Held sign-ups" }).waitFor();
  ok(
    (await page.getByRole("table", { name: "Held sign-ups" }).count()) === 1,
    "the referrals page lists sign-ups held for the same device",
  );
  await shot("9-referrals");
  await page.getByRole("link", { name: "Marketing" }).click();
  await page.getByRole("heading", { name: "Signals for pricing" }).waitFor();
  await page.getByRole("table", { name: "By source" }).waitFor();
  ok(true, "marketing shows channels and the pricing signals");
  await shot("10-marketing");
  await page.getByRole("link", { name: "Quality" }).click();
  await page.getByRole("heading", { name: "Speed" }).waitFor();
  await shot("11-quality");

  // emails: preview every template
  await page.getByRole("link", { name: "Emails", exact: true }).click();
  await page.getByRole("table", { name: "Email templates" }).waitFor();
  const previews = page.getByRole("button", { name: /^Preview / });
  const count = await previews.count();
  ok(count === 12, `the emails page lists all ${count} templates`);
  await shot("12-emails");
  for (let i = 0; i < count; i++) {
    await page
      .getByRole("button", { name: /^Preview / })
      .nth(i)
      .click();
    const frame = page.locator('iframe[title^="Preview of"]');
    await frame.waitFor();
    await sleep(500);
    const label = (
      await page.getByRole("heading", { name: /^Preview:/ }).innerText()
    ).replace("Preview: ", "");
    const slug = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    await frame.screenshot({
      path: `${SHOTS}/emails/${String(i + 1).padStart(2, "0")}-${slug}.png`,
    });
    const html = await frame.getAttribute("srcdoc");
    ok(
      html.includes("InterviewMeet") && html.includes("<!doctype html>"),
      `preview ${i + 1}: ${label}`,
    );
    ok(
      (await frame.getAttribute("sandbox")) === "",
      `  it is shown in a sandboxed frame`,
    );
  }

  // an ordinary person gets nothing
  const other = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const p2 = await other.newPage();
  await p2.goto(BASE + "/login");
  await p2
    .getByLabel("Email address")
    .fill(`ordinary${Date.now()}@example.com`);
  const m = links().length;
  await p2.getByRole("button", { name: "Email me a sign-in link" }).click();
  for (let i = 0; i < 60 && links().length <= m; i++) await sleep(100);
  await p2.goto(links().pop());
  await p2
    .getByRole("button", { name: "Skip for now" })
    .click({ timeout: 4000 })
    .catch(() => {});
  await p2.waitForURL("**/dashboard");
  await skipTour(p2);
  ok(
    (await p2.getByRole("link", { name: "Admin console" }).count()) === 0,
    "an ordinary person has no admin link",
  );
  const status = await p2.evaluate(
    async () =>
      (await fetch("/api/admin/overview", { credentials: "include" })).status,
  );
  ok(status === 404, "and the server answers them with 404");
  await p2.goto(BASE + "/admin");
  await p2.waitForURL("**/dashboard");
  ok(true, "typing the admin address sends them back to their dashboard");

  // the admin pages on a phone: nothing runs off the side
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [
    "/admin",
    "/admin/users",
    "/admin/activity",
    "/admin/referrals",
    "/admin/marketing",
    "/admin/quality",
    "/admin/emails",
  ]) {
    await page.goto(BASE + path);
    await page.getByRole("navigation", { name: "Admin sections" }).waitFor();
    await sleep(500);
    const fits = await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    );
    ok(fits, `${path} fits a phone screen`);
  }
  await shot("13-admin-phone", false);
  ok(
    errors.length === 0,
    "no uncaught page errors" + (errors.length ? ": " + errors[0] : ""),
  );
  await browser.close();
})();
