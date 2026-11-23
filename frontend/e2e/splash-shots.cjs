// Frames of the opening animation and the three welcome slides, as the Android app shows them.
const { chromium } = require("playwright");
const B = "http://localhost:5173";
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android", Plugins: {} };
  });
  const page = await ctx.newPage();
  const out = process.env.E2E_SHOTS || ".";
  await page.goto(B + "/");
  const t0 = Date.now();
  for (const ms of [250, 600, 950, 1300, 1700, 2150]) {
    const wait = ms - (Date.now() - t0);
    if (wait > 0) await page.waitForTimeout(wait);
    await page.screenshot({ path: `${out}/splash-${String(ms).padStart(4, "0")}.png` });
  }
  await page.waitForSelector('[data-testid="splash"]', { state: "detached", timeout: 6000 });
  await page.getByRole("button", { name: "Next" }).waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/welcome-1.png` });
  await page.getByRole("button", { name: "Next" }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/welcome-2.png` });
  await page.getByRole("button", { name: "Next" }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/welcome-3.png` });
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("heading", { name: "Create your account" }).waitFor();
  console.log("splash-shots: ok, then Get started reached the sign-up page");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
