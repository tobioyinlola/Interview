// Real-browser test of the first-time tour and the Help page: it opens by itself on the first visit
// to the dashboard, rings the real item each step is about, falls back to the middle of the screen
// on a phone, is remembered once finished, and can be taken again.
const { chromium } = require("playwright");
const fs = require("fs");
const BASE = "http://localhost:5173";
const SHOTS = (process.env.E2E_SHOTS || "/tmp") + "/guide";
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

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 860 },
  });
  const page = await ctx.newPage();
  const snap = async (name) => {
    await sleep(350);
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
  };

  await page.goto(BASE + "/login");
  await page.getByLabel("Email address").fill(`guide${Date.now()}@example.com`);
  const n = links().length;
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  for (let i = 0; i < 60 && links().length <= n; i++) await sleep(100);
  await page.goto(links().pop());
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.waitForURL("**/dashboard");

  // it opens by itself
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  ok(
    /Welcome to InterviewMeet/.test(await dialog.innerText()),
    "the tour opens by itself on the first visit to the dashboard",
  );
  await snap("1-welcome");

  // each step with a target rings the real item
  const expectRing = async (testAttr, label) => {
    const ring = await page.getByTestId("tour-spotlight").boundingBox();
    const el = await page
      .locator(`[data-tour="${testAttr}"]`)
      .first()
      .boundingBox();
    console.log("   ring", JSON.stringify(ring), "item", JSON.stringify(el));
    ok(
      ring &&
        el &&
        ring.x <= el.x &&
        ring.y <= el.y &&
        ring.x + ring.width >= el.x + el.width &&
        ring.y + ring.height >= el.y + el.height,
      `the ring surrounds the real ${label}`,
    );
  };
  await page.getByRole("button", { name: "Start" }).click();
  await dialog.getByRole("heading", { name: "Search everything" }).waitFor();
  await expectRing("search", "search box");
  await snap("2-search");
  await page.getByRole("button", { name: "Next" }).click();
  await dialog.getByRole("heading", { name: "1. Upload your CV" }).waitFor();
  await expectRing("nav-notes", "CV link in the sidebar");
  await snap("3-cv");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await dialog.getByRole("heading", { name: "The live panel" }).waitFor();
  ok(
    (await page.getByTestId("tour-spotlight").count()) === 0,
    "the live panel step has no ring: it is shown in the middle",
  );
  await snap("4-live-panel");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await dialog.getByRole("heading", { name: "Your account" }).waitFor();
  await expectRing("profile", "account button");
  await snap("5-account");
  await page.getByRole("button", { name: "Back" }).click();
  await dialog.getByRole("heading", { name: "Free sessions" }).waitFor();
  ok(true, "Back goes to the previous step");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await dialog.waitFor({ state: "detached" });
  ok(true, "finishing closes the tour");

  // remembered on the account: not again, even after a reload or another visit
  await page.reload();
  await page.getByRole("combobox").waitFor();
  await sleep(800);
  ok(
    (await page.getByRole("dialog").count()) === 0,
    "it does not come back after a reload",
  );

  // taken again from the account menu
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Take the tour" }).click();
  await dialog.waitFor();
  ok(true, "the account menu replays it");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  ok(true, "Escape skips it");

  // the Help page
  await page.getByRole("link", { name: "Help" }).first().click();
  await page.getByRole("heading", { name: "Help" }).waitFor();
  await page.getByText("Once an answer is up it stays").waitFor();
  await page.getByText("Can I use it in a real interview?").click();
  await page.getByText(/No\. InterviewMeet is for practice/).waitFor();
  await page.screenshot({ path: `${SHOTS}/6-help.png`, fullPage: true });
  ok(true, "the Help page explains the panel and answers questions");
  await page.getByRole("button", { name: "Take the tour" }).click();
  await dialog.waitFor();
  ok(true, "the Help page replays the tour");
  await page.keyboard.press("Escape");

  // on a phone the menu is a drawer, so its steps are shown in the middle with the same words
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Take the tour" }).click();
  await dialog.waitFor();
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await dialog.getByRole("heading", { name: "1. Upload your CV" }).waitFor();
  const box = await dialog.boundingBox();
  ok(
    box && box.x >= 0 && box.x + box.width <= 390,
    "the card fits on a phone screen",
  );
  ok(
    (await page.getByTestId("tour-spotlight").count()) === 0,
    "no ring for the hidden menu item: centred instead",
  );
  await snap("7-phone");
  await page.keyboard.press("Escape");
  await browser.close();
})();
