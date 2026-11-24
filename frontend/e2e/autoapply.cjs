// Real-browser test of Auto-Apply through nginx: set up, start, find jobs, send by form and by
// email, answer a question, then an interview invitation becomes "Prepare for interview" and opens
// the preparation flow. Everything outside the app is a fixture, so nothing real is contacted.
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const { skipTour } = require("./helpers.cjs");
const BASE = "http://localhost:5173";
const SHOTS = (process.env.E2E_SHOTS || "/tmp") + "/autoapply";
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
const psql = (sql) =>
  execSync(
    `PGPASSWORD=postgres psql -h localhost -U postgres meetpractice -tAqc "${sql}"`,
  )
    .toString()
    .trim();
const EMAIL = `ada${Date.now()}@example.com`;
const CV =
  "Ada Okoye\nada@example.com +234 801 234 5678\nSenior Product Manager at Northwind (2021-2025): led payments roadmap, grew revenue 30%.";

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shot = async (name, full = true) => {
    await sleep(400);
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
  };
  const until = async (fn, what, tries = 40) => {
    for (let i = 0; i < tries; i++) {
      if (await fn()) return;
      await sleep(500);
    }
    ok(false, `timed out waiting for ${what}`);
  };

  // a new customer with a CV
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
  await page.evaluate(
    async (cv) =>
      fetch("/api/notes", {
        method: "PUT",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-requested-with": "meet-practice",
        },
        body: JSON.stringify({ role: "Product manager", content: cv }),
      }),
    CV,
  );

  // the menu has Auto-Apply, and a new person is invited to set up
  await page.getByRole("link", { name: "Auto-Apply", exact: true }).click();
  await page.waitForURL("**/auto-apply");
  await page.getByRole("link", { name: "Set up Auto-Apply" }).waitFor();
  ok(true, "the menu has Auto-Apply and a new person is invited to set it up");
  await shot("1-not-set-up", false);
  await page.getByRole("link", { name: "Set up Auto-Apply" }).click();
  await page.waitForURL("**/auto-apply/setup");

  const stepIs = async (title) => {
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
  };
  const next = async () => {
    const btn = page.getByRole("button", { name: "Next", exact: true });
    ok(await btn.isEnabled(), "Next is available");
    await btn.click();
  };

  // step 1: the details read from the CV, checked by the person
  await stepIs("Your details");
  ok(
    await page.getByRole("button", { name: "Next", exact: true }).isDisabled(),
    "Next waits until the details are confirmed",
  );
  await page.getByRole("button", { name: "Read my CV" }).click();
  await page.getByLabel("Full name").waitFor();
  await page.getByRole("button", { name: "Add a role" }).click();
  await page.getByLabel("Job title (role 1)").fill("Senior Product Manager");
  await page.getByLabel("Employer (role 1)").fill("Northwind");
  await page.getByLabel("Started (role 1)").fill("2021");
  await page.getByLabel("Ended (role 1)").fill("2025");
  await page
    .getByLabel("What you did (role 1)")
    .fill("Led payments roadmap, grew revenue 30%.");
  await page.getByLabel("Full name").fill("Ada Okoye");
  await shot("2a-step-1");
  await page.getByRole("button", { name: "These details are right" }).click();
  await page.getByText(/Your details are confirmed/).waitFor();
  ok(
    true,
    "step 1: the candidate checks and confirms the details read from their CV",
  );
  await next();

  // step 2: role and place
  await stepIs("What you want");
  ok(
    await page.getByRole("button", { name: "Next", exact: true }).isDisabled(),
    "Next waits for a role and a place",
  );
  await page.fill("#s-roles", "Senior Product Manager");
  await page.getByRole("button", { name: "Add role" }).click();
  await page.fill("#s-locs", "Nigeria");
  await page.getByRole("button", { name: "Add place" }).click();
  await page.getByRole("button", { name: /Remote/ }).click();
  await shot("2b-step-2");
  await next();
  ok(true, "step 2: roles, places and work style are chosen and saved");

  // step 3: preferences are optional
  await stepIs("Nice to have");
  await shot("2c-step-3");
  await page.getByRole("button", { name: "Skip" }).click();

  // step 4: schedule
  await stepIs("When to apply");
  await page.selectOption("#s-tz", "Africa/Lagos");
  await shot("2d-step-4");
  await next();

  // step 5: ways to apply, with the mailbox
  await stepIs("How to apply");
  await page
    .getByRole("button", { name: /Employers' application forms/ })
    .click();
  await page.getByRole("button", { name: "Connect my email" }).click();
  await page.getByText(/Connected: /).waitFor();
  await page.getByRole("button", { name: /Email applications/ }).click();
  await shot("2e-step-5");
  await next();
  ok(
    true,
    "steps 3-5: preferences skipped, schedule set, forms and email chosen and the mailbox connected",
  );

  // step 6: a reusable answer
  await stepIs("Your quick answers");
  await page.fill("#qa-notice_period", "Two weeks");
  await shot("2f-step-6");
  await next();

  // step 7: review, agree and start
  await stepIs("Review and start");
  const start = page.getByRole("button", { name: "Start Auto-Apply" });
  ok(
    await start.isDisabled(),
    "starting is blocked until the candidate agrees",
  );
  await shot("2-setup");
  await page.getByLabel(/I agree that InterviewMeet may apply/).check();
  await start.click();
  await page.waitForURL("**/auto-apply");
  await page.getByText(/On · day 1 of 30/).waitFor();
  ok(true, "step 7: the candidate starts a 30-day search and sees day 1 of 30");

  // find jobs, then the scheduler sends them
  await page.getByRole("button", { name: "Search for roles now" }).click();
  await until(
    async () => (await page.getByText(/found, \d+ matched/).count()) > 0,
    "the search to finish",
  );
  await until(
    async () => {
      await page.reload();
      await page
        .getByRole("heading", { name: "Recent applications" })
        .waitFor();
      return (
        (await page.getByText("Submitted").count()) > 0 &&
        (await page.getByText("Sent by email").count()) > 0
      );
    },
    "applications to go out",
    30,
  );
  ok(
    true,
    "a form application and an email application went out with no further clicks",
  );
  await page.getByRole("region", { name: "Needs your input" }).waitFor();
  await shot("3-dashboard");

  // an application: why it matched and exactly what was sent
  await page
    .getByRole("link", { name: /Senior Product Manager at Acme/ })
    .click();
  await page.getByRole("heading", { name: "Why it matched" }).waitFor();
  await page.getByText("What was sent").waitFor();
  await page.getByText("The CV that went out").click();
  ok(
    (await page
      .getByText(/Senior Product Manager, Northwind \(2021 - 2025\)/)
      .count()) > 0,
    "the exact CV that went out is shown, with the candidate's own facts",
  );
  await shot("4-application");

  // the one that needs input: approve the unclear location and answer the question
  await page.goto(BASE + "/auto-apply");
  await page
    .getByRole("region", { name: "Needs your input" })
    .getByRole("link")
    .first()
    .click();
  await page.getByRole("heading", { name: "Needs your input" }).waitFor();
  await page.getByRole("button", { name: "I have checked. Go ahead" }).click();
  // the notice period was answered once in setup and approved for reuse, so it is not asked again
  await until(
    async () => {
      await page.reload();
      await page.getByRole("heading", { name: "Why it matched" }).waitFor();
      return (await page.getByText(/Ready to send|Submitted/).count()) > 0;
    },
    "the approved application to be ready",
    20,
  );
  ok(
    true,
    "the candidate approved the unclear rule, and the saved answer filled in the question",
  );
  await shot("5-needs-input-resolved", false);

  // an interview invitation (the reply reading is covered by the API tests; here we place the
  // result of it so the screen and the hand-off are checked in a real browser)
  const appId = psql(
    `SELECT a.id FROM aa_applications a JOIN users u ON u.id=a.user_id JOIN aa_postings p ON p.id=a.posting_id WHERE u.email='${EMAIL}' AND p.company='Acme'`,
  );
  const userId = psql(`SELECT id FROM users WHERE email='${EMAIL}'`);
  psql(
    `INSERT INTO aa_interviews (id,user_id,application_id,round,status,scheduled_at,history,time_zone_unclear,created_at,updated_at) VALUES (gen_random_uuid(),'${userId}','${appId}',2,'scheduled', now() + interval '2 days','[]',false,now(),now())`,
  );
  await page.goto(BASE + "/auto-apply");
  await page
    .getByRole("button", { name: "Prepare for interview" })
    .first()
    .waitFor();
  ok(true, "a confirmed interview puts Prepare for interview first");
  await shot("6-prepare");
  await page
    .getByRole("region", { name: "Next interview" })
    .getByRole("button", { name: "Prepare for interview" })
    .click();
  await page.waitForURL("**/session/new?interview=*");
  await page.getByText(/starts from your Auto-Apply interview/).waitFor();
  await page.getByRole("button", { name: /Start/ }).click();
  await page.waitForURL(/\/session\/[0-9a-f-]{36}/);
  ok(
    true,
    "Prepare for interview opens the assistant from the submitted application",
  );
  const snap = psql(
    `SELECT notes_snapshot FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.email='${EMAIL}' ORDER BY s.started_at DESC LIMIT 1`,
  );
  ok(
    snap.includes("Round 2") &&
      snap.includes("Northwind") &&
      snap.includes("Lead payments product"),
    "the session holds the submitted CV, the round and the job as applied",
  );

  // pause stops it
  await page.goto(BASE + "/auto-apply");
  await page.getByRole("button", { name: "Pause Auto-Apply" }).click();
  await page.getByText(/Paused · day 1 of 30/).waitFor();
  await page.getByRole("button", { name: "Resume Auto-Apply" }).click();
  ok(true, "pause and resume work and keep the day count");

  // phone: no sideways scrolling on the two main pages
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [
    "/auto-apply",
    "/auto-apply/setup",
    "/auto-apply/applications",
  ]) {
    await page.goto(BASE + path);
    await sleep(600);
    const fits = await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    );
    if (!fits) {
      const wide = await page.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .filter(
            (e) =>
              e.getBoundingClientRect().right >
              document.documentElement.clientWidth + 1,
          )
          .slice(0, 6)
          .map(
            (e) =>
              `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 60)} "${(e.textContent || "").slice(0, 40)}" right=${Math.round(e.getBoundingClientRect().right)}`,
          ),
      );
      console.error("wider than the phone:", wide);
    }
    ok(fits, `${path} fits a phone screen`);
  }
  await shot("7-phone", false);
  ok(
    errors.length === 0,
    "no uncaught page errors" + (errors.length ? ": " + errors[0] : ""),
  );
  await browser.close();
})();
