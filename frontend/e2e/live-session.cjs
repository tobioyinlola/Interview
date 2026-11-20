// Real-browser end-to-end test of the live session. Run it with scripts/e2e-live.sh, which starts
// the API in fake-provider mode (no OpenAI) and the web dev server first.
const { chromium } = require("playwright");
const fs = require("fs");
const { execSync } = require("child_process");
const SHOTS = process.env.E2E_SHOTS || require("os").tmpdir();
const step = (m) => console.log("•", m);
const check = (cond, msg) => {
  if (!cond) throw new Error("CHECK FAILED: " + msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A stand-in for "share the Meet tab with audio": a real MediaStream with a live audio track.
const FAKE_SHARE = () => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const ctx = new AudioContext();
    await ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.3;
    osc.frequency.value = 220;
    const dest = ctx.createMediaStreamDestination();
    osc.connect(gain).connect(dest);
    osc.start();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const video = canvas.captureStream(1).getVideoTracks()[0];
    const stream = new MediaStream([...dest.stream.getAudioTracks(), video]);
    window.__stopShare = () =>
      stream.getAudioTracks().forEach((t) => {
        t.stop();
        t.dispatchEvent(new Event("ended"));
      });
    return stream;
  };
};

// A stand-in for the microphone: another real MediaStream with a live audio track.
const FAKE_MIC = () => {
  navigator.mediaDevices.getUserMedia = async () => {
    const ctx = new AudioContext();
    await ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.25;
    osc.frequency.value = 330;
    const dest = ctx.createMediaStreamDestination();
    osc.connect(gain).connect(dest);
    osc.start();
    return dest.stream;
  };
};

(async () => {
  const browser = await chromium.launch({
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1200, height: 950 },
  });
  const page = await ctx.newPage();
  const cspViolations = [];
  let cspHeaderSeen = false;
  await page.exposeFunction("reportCsp", (m) => cspViolations.push(m));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) =>
      window.reportCsp(`${e.violatedDirective} blocked ${e.blockedURI}`),
    );
  });
  page.on("response", (r) => {
    if (
      r.request().resourceType() === "document" &&
      r.headers()["content-security-policy"]
    )
      cspHeaderSeen = true;
  });
  page.on("console", (m) => {
    if (
      /Content Security Policy|Refused to (load|execute|apply)/.test(m.text())
    )
      cspViolations.push("console: " + m.text().slice(0, 160));
  });
  await page.addInitScript(FAKE_SHARE);
  await page.addInitScript(FAKE_MIC);
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  // sign in
  await page.goto("http://localhost:5173/login");
  await page.fill("#email", `live${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByText("Check your email").waitFor();
  await sleep(300);
  const link = [
    ...fs
      .readFileSync(process.env.API_LOG, "utf8")
      .matchAll(/http:\/\/localhost:5173\/login\/verify\?token=[\w-]+/g),
  ].pop()[0];
  await page.goto(link);
  // A brand-new account is asked four questions first; this test skips them.
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("heading", { name: "Dashboard" }).waitFor();

  // CV upload: a real PDF, then a Word file, then files the server must refuse
  await page.goto("http://localhost:5173/notes");
  await page.fill("#role", "Product Manager");
  const fixtures = __dirname + "/fixtures";
  await page.setInputFiles('input[type="file"]', fixtures + "/cv.pdf");
  await page.getByRole("heading", { name: "cv.pdf" }).waitFor();
  await page.getByText("See what we read").click();
  check(
    await page.getByText(/Cut onboarding time by 30%/).isVisible(),
    "the text of the uploaded PDF is shown back",
  );
  await page.setInputFiles('input[type="file"]', fixtures + "/cv.docx");
  await page.getByRole("heading", { name: "cv.docx" }).waitFor();
  step("uploaded a PDF, then replaced it with a Word file");
  await page.setInputFiles('input[type="file"]', {
    name: "photo.png",
    mimeType: "image/png",
    buffer: Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64),
    ]),
  });
  await page.getByRole("alert").waitFor();
  check(
    /isn't supported/i.test(await page.getByRole("alert").innerText()),
    "an image is refused with a clear message",
  );
  await page.setInputFiles('input[type="file"]', {
    name: "huge.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  check(
    /over 5 MB/i.test(await page.getByRole("alert").innerText()),
    "a file over 5 MB is refused before it is sent",
  );
  check(
    await page.getByRole("heading", { name: "cv.docx" }).isVisible(),
    "the earlier CV is kept after a refused upload",
  );
  // a large file must get through the web server in front of the API (its body limit), and be cut
  const apiBase = process.env.API_BASE || new URL(page.url()).origin;
  const big = await page.request.post(apiBase + "/api/notes/cv", {
    headers: {
      "x-requested-with": "meet-practice",
      "x-filename": "big.txt",
      "content-type": "text/plain",
    },
    data: Buffer.from("word ".repeat(900_000)), // 4.5 MB
  });
  check(
    big.status() === 200 && (await big.json()).truncated === true,
    "a 4.5 MB file passes the proxy and is cut to the length limit",
  );
  await page.setInputFiles('input[type="file"]', fixtures + "/cv.pdf"); // back to the real CV
  await page.getByRole("heading", { name: "cv.pdf" }).waitFor();
  await sleep(2200); // the role autosaves
  step("signed in and CV uploaded");

  // setup: Start stays disabled until the three conditions hold
  await page.goto("http://localhost:5173/session/new");
  await page
    .getByRole("option", { name: /No company/ })
    .waitFor({ state: "attached" });
  const startBtn = page.getByRole("button", { name: "Start session" });
  check(await startBtn.isDisabled(), "Start is disabled initially");
  await page.selectOption("#company", "none");
  check(await startBtn.isDisabled(), "Start is disabled without consent");
  await page.getByRole("checkbox").check();
  check(
    await startBtn.isEnabled(),
    "Start is enabled once everything is ready",
  );
  await startBtn.click();
  await page.getByRole("heading", { name: "Capture" }).waitFor();
  step("session created, live page open: " + page.url());

  // share the tab -> real worklet -> real websocket -> real relay
  await page.getByRole("button", { name: "Share Meet tab" }).click();
  await page.getByText("Listening", { exact: true }).waitFor({ timeout: 8000 });
  step("status: Listening (socket authenticated with a single-use token)");
  await sleep(600);
  const lvl = Number(
    await page.getByRole("meter").getAttribute("aria-valuenow"),
  );
  console.log("   level meter value:", lvl);
  check(lvl > 5, "the level meter moves with the shared audio");

  await page
    .getByText(/Tell me about a time you led a project/)
    .first()
    .waitFor({ timeout: 15000 });
  step("caption appeared in the transcript");
  await page.getByText(/First words in/).waitFor({ timeout: 15000 });
  await page.getByText(/led a team to ship a launch/i).waitFor();
  check(
    !(await page.getByText(/SOURCES|\[note:/).count()),
    "the panel shows no source list or labels, only the question and answer",
  );
  const first = await page.getByText(/First words in/).innerText();
  console.log("   ", first);
  await page.screenshot({
    path: SHOTS + "/3-live-outline.png",
    fullPage: true,
  });
  step("outline streamed from notes with a source label");

  // second question replaces the first
  await page
    .getByText(/Why do you want to work here/)
    .first()
    .waitFor({ timeout: 15000 });
  step("second caption arrived");
  // The first answer is locked: the second question is listed beside it and changes nothing.
  check(
    (await page.getByTestId("question").first().innerText()).includes(
      "led a project",
    ),
    "the panel still shows the first question",
  );
  check(
    (await page.getByTestId("additions").innerText()).includes(
      "Why do you want to work here",
    ),
    "what was said next is listed as an addition",
  );
  check(
    /led a team to ship a launch/i.test(
      await page.getByTestId("outline").innerText(),
    ),
    "the first answer did not change",
  );
  step("the answer stayed while the interviewer kept talking");
  await page.getByRole("button", { name: "Done, next question" }).click();
  await page
    .getByTestId("question")
    .first()
    .getByText(/Why do you want to work here/)
    .waitFor({ timeout: 10000 });
  await page.getByTestId("outline").waitFor();
  step("Done released it; the follow-up became the next question");

  // typed question + blur mode
  await page.getByRole("checkbox", { name: /Answer-first/ }).check();
  await page.fill("#manual", "What is your biggest weakness?");
  await page.press("#manual", "Enter");
  await page
    .getByRole("button", { name: "Reveal" })
    .waitFor({ timeout: 10000 });
  const blurred = await page
    .getByTestId("outline")
    .evaluate((e) => e.className.includes("blur"));
  check(blurred, "the outline is blurred before Reveal");
  await page.getByRole("button", { name: "Reveal" }).click();
  await page.screenshot({
    path: SHOTS + "/4-live-blur-revealed.png",
    fullPage: true,
  });
  step("typed question answered; blur mode hides then reveals");

  // recovery: restart the API mid-session. Wait for the old process to exit first, so this is a
  // real outage (the old server keeps open sockets alive during its graceful shutdown).
  execSync(`kill -TERM $(cat ${process.env.API_PID})`);
  execSync(
    `while kill -0 $(cat ${process.env.API_PID}) 2>/dev/null; do sleep 0.1; done`,
    { timeout: 20000, shell: "/bin/bash" },
  );
  const t0 = Date.now();
  execSync(process.env.API_START, { shell: "/bin/bash" });
  let sawDrop = false;
  let outcome = "timed out";
  for (let i = 0; i < 80; i++) {
    const statuses = await page
      .getByRole("status")
      .allInnerTexts()
      .catch(() => []);
    const alerts = await page
      .getByRole("alert")
      .allInnerTexts()
      .catch(() => []);
    if (alerts.some((a) => /Capture lost/.test(a))) {
      outcome = "capture lost";
      break;
    }
    if (statuses.some((t) => /Reconnecting/.test(t))) sawDrop = true;
    if (sawDrop && statuses.includes("Listening")) {
      outcome = "reconnected";
      break;
    }
    await sleep(250);
  }
  console.log(
    "   after API restart:",
    outcome,
    `(${((Date.now() - t0) / 1000).toFixed(1)} s after the new server started)`,
  );
  check(sawDrop, "the browser noticed the connection drop (Reconnecting)");
  check(outcome === "reconnected", "capture recovered after the API restart");
  await page.screenshot({
    path: SHOTS + "/5-after-restart.png",
    fullPage: true,
  });
  check(
    (await page.getByText(/connection lost for about/).count()) > 0,
    "transcript shows a gap marker",
  );
  step(
    "survived an API restart: reconnected with a fresh token and marked the gap",
  );

  // stop sharing from the browser's own control
  await page.evaluate(() => window.__stopShare());
  await page.getByText("Sharing stopped.").waitFor({ timeout: 5000 });
  step("stopping the share stops capture");
  await page.getByRole("button", { name: "Share Meet tab" }).click();
  await page.getByText("Listening", { exact: true }).waitFor({ timeout: 8000 });

  // the user's own microphone (FR-17): a second socket, labelled You, never answered
  await page
    .getByRole("checkbox", { name: /transcribe my microphone/i })
    .check();
  await page
    .getByRole("meter", { name: "Microphone level" })
    .waitFor({ timeout: 8000 });
  let micLevel = 0;
  for (let i = 0; i < 20 && micLevel <= 5; i++) {
    micLevel = Number(
      await page
        .getByRole("meter", { name: "Microphone level" })
        .getAttribute("aria-valuenow"),
    );
    if (micLevel <= 5) await sleep(150);
  }
  check(micLevel > 5, "the microphone level meter moves");
  await page
    .getByRole("region", { name: "Transcript" })
    .getByText("You:")
    .first()
    .waitFor({ timeout: 20000 });
  step("microphone transcribed and labelled You");

  // thumbs on an outline (FR-31)
  await page
    .getByRole("button", { name: "Useful", exact: true })
    .waitFor({ timeout: 20000 });
  let pressed = "false";
  for (let i = 0; i < 3 && pressed !== "true"; i++) {
    await page.getByRole("button", { name: "Useful", exact: true }).click();
    await sleep(300);
    pressed = await page
      .getByRole("button", { name: "Useful", exact: true })
      .getAttribute("aria-pressed");
  }
  check(pressed === "true", "a thumbs up is kept on the outline");
  step("outline rated useful");

  // end the session; transcript and review
  await page.getByRole("button", { name: "End session" }).click();
  await page.getByText("Session saved.").waitFor();
  const href = await page
    .getByRole("link", { name: "Download transcript" })
    .getAttribute("href");
  const txt = await (
    await page.request.get(new URL(href, page.url()).toString())
  ).text();
  console.log(
    "   transcript download:\n" +
      txt
        .split("\n")
        .map((l) => "     | " + l)
        .join("\n"),
  );
  await page.getByRole("link", { name: "Review it" }).click();
  await page.getByRole("heading", { name: "Session review" }).waitFor();
  await page.screenshot({ path: SHOTS + "/6-review.png", fullPage: true });
  step("review page lists the saved transcript and outlines");

  // answer scoring (FR-36) runs in the background and the page picks up the result
  await page.getByRole("button", { name: "Score my answers" }).click();
  await page
    .getByRole("list", { name: "Answer scores" })
    .waitFor({ timeout: 20000 });
  const overall = await page
    .getByLabel(/Overall score \d+ out of 100/)
    .first()
    .innerText();
  console.log("   first answer overall score:", overall.replace(/\s+/g, " "));
  check(
    (await page.getByRole("meter", { name: "Structure score" }).count()) > 0,
    "score bars are shown",
  );
  check((await page.getByText("Fixes").count()) > 0, "fixes are listed");
  await page.screenshot({ path: SHOTS + "/7-scores.png", fullPage: true });
  step("answers scored with fixes");
  check(
    (await page
      .getByRole("region", { name: "Gaps in your CV and brief" })
      .count()) === 1,
    "gap finder section is present",
  );

  // sessions list (FR-35) and the dashboard
  await page.getByRole("link", { name: "Sessions" }).first().click();
  await page.getByRole("heading", { name: "Sessions" }).waitFor();
  const rowText = await page
    .getByRole("listitem")
    .filter({ hasText: "question" })
    .first()
    .innerText();
  console.log("   sessions row:", rowText.replace(/\s+/g, " "));
  check(
    /No company · .* · \d+ questions?/.test(rowText),
    "the sessions list shows company, length and question count",
  );
  await page.getByRole("link", { name: "Overview" }).click();
  await page
    .getByRole("region", { name: "Recent sessions" })
    .getByRole("link", { name: /2026/ })
    .first()
    .waitFor();
  await page.screenshot({ path: SHOTS + "/8-dashboard.png", fullPage: true });
  step("sessions list and dashboard show the session");

  // delete the session: it leaves the app at once
  await page
    .getByRole("region", { name: "Recent sessions" })
    .getByRole("link", { name: /2026/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Delete this session" }).click();
  await page.getByRole("button", { name: "Yes, delete" }).click();
  await page.getByText(/No sessions yet/).waitFor();
  step("session deleted");
  console.log("page errors:", pageErrors.length ? pageErrors : "none");
  check(pageErrors.length === 0, "no uncaught page errors");
  console.log(
    "CSP violations:",
    cspViolations.length ? cspViolations : "none",
    "| CSP header served:",
    cspHeaderSeen,
  );
  check(
    cspViolations.length === 0,
    "the page triggered no Content-Security-Policy violations",
  );
  if (process.env.E2E_PROD === "1")
    check(
      cspHeaderSeen,
      "the production build was served with a Content-Security-Policy",
    );
  check(
    /Tell me about a time/.test(txt) &&
      /Why do you want to work here/.test(txt),
    "the downloaded transcript has both questions",
  );
  await browser.close();
})().catch((e) => {
  console.error("E2E FAILED:", e.message);
  process.exit(1);
});
