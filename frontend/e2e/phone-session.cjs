// A live interview from the phone app: it listens through the microphone (a real MediaStream stands in
// for it), shows the interviewer's question as it is heard, drafts an answer, takes a typed question,
// and ends with a saved session. Run with scripts/e2e-live.sh.
const { chromium } = require("playwright");
const { skipTour } = require("./helpers.cjs");
const fs = require("fs");
const step = (m) => console.log("•", m);
const check = (cond, msg) => {
  if (!cond) throw new Error("CHECK FAILED: " + msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = "http://localhost:5173";

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // the microphone: a real MediaStream with a live audio track
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext();
      await ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.3;
      osc.frequency.value = 220;
      const dest = ctx.createMediaStreamDestination();
      osc.connect(gain).connect(dest);
      osc.start();
      return dest.stream;
    };
    // after sign-in the test turns this on, and the page behaves like the installed phone app
    if (localStorage.getItem("e2e-phone"))
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android", Plugins: {} };
  });

  await page.goto(BASE + "/login");
  await page.fill("#email", `phone${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByText("Check your email").waitFor();
  await sleep(300);
  const link = [...fs.readFileSync(process.env.API_LOG, "utf8").matchAll(/http:\/\/localhost:5173\/login\/verify\?token=[\w-]+/g)].pop()[0];
  await page.goto(link);
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("heading", { name: "Dashboard" }).waitFor();
  await skipTour(page);
  await page.goto(BASE + "/notes");
  await page.fill("#role", "Product Manager");
  await page.setInputFiles('input[type="file"]', __dirname + "/fixtures/cv.pdf");
  await page.getByRole("heading", { name: "cv.pdf" }).waitFor();
  await sleep(2200);
  step("signed in and CV uploaded");

  await page.evaluate(() => localStorage.setItem("e2e-phone", "1"));
  await page.goto(BASE + "/session/new");
  await page.getByRole("heading", { name: "Start an interview" }).waitFor();
  check(await page.getByText(/listens through its microphone/).isVisible(), "the setup page speaks phone");
  await page.selectOption("#company", "none");
  const start = page.getByRole("button", { name: "Start session" });
  for (let i = 0; i < 30 && (await start.isDisabled()); i++) await sleep(100);
  await start.click();
  await page.getByRole("button", { name: "Start listening" }).waitFor();
  check((await page.getByRole("button", { name: "Share Meet tab" }).count()) === 0, "no 'share a tab' on a phone");
  step("phone session page open: " + page.url());

  await page.getByRole("button", { name: "Start listening" }).click();
  await page.getByText("Listening", { exact: true }).waitFor({ timeout: 8000 });
  step("listening through the microphone");
  await page.getByText(/Tell me about a time you led a project/).first().waitFor({ timeout: 15000 });
  step("the interviewer's question is shown as it is heard");
  await page.getByTestId("outline").waitFor({ timeout: 15000 });
  for (let i = 0; i < 40 && !(await page.getByTestId("outline").innerText()).trim(); i++) await sleep(250);
  const answer = (await page.getByTestId("outline").innerText()).trim();
  check(answer.length > 10, "a draft answer is shown for the question");
  step("draft answer: " + answer.slice(0, 60).replace(/\n/g, " ") + "…");

  await page.getByRole("button", { name: "Done, next question" }).click();
  await page.getByLabel("Type a question").fill("Why do you want to work here?");
  await page.getByRole("button", { name: "Ask" }).click();
  await page.getByTestId("outline").waitFor({ timeout: 15000 });
  step("a typed question gets an answer too");

  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  check(w <= 392, "the page fits a phone screen (" + w + "px)");
  await page.screenshot({ path: (process.env.E2E_SHOTS || "/tmp") + "/phone-session.png", fullPage: true });

  await page.getByRole("button", { name: "End session" }).click();
  await page.getByText("Session saved.").waitFor({ timeout: 8000 });
  check(await page.getByRole("link", { name: "Review it" }).isVisible(), "the review is linked");
  step("session ended and saved");
  check(errors.length === 0, "no uncaught page errors: " + errors.join(" | "));
  console.log("• no uncaught page errors");
  await browser.close();
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
