// Shared by the browser tests.

/** The first-time tour opens by itself the first time the dashboard is shown. Tests that are about
 *  something else skip it, as a person would. (A no-op if it does not appear.) */
async function skipTour(page, timeout = 5000) {
  const skip = page.getByRole("button", { name: "Skip tour" });
  try {
    await skip.waitFor({ timeout });
    await skip.click();
    await page
      .getByRole("dialog")
      .waitFor({ state: "detached", timeout: 5000 });
  } catch {
    /* it did not appear: this account has had it */
  }
}

module.exports = { skipTour };
