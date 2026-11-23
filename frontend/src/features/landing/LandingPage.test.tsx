import { screen } from "@testing-library/react";

import {
  ME,
  UNAUTH,
  mockApi,
  renderApp,
  stubSupportedBrowser,
} from "../../test-utils";
import { App } from "../../app/App";
import { WINDOWS_DOWNLOAD_URL } from "./LandingPage";
import main from "../../main.tsx?raw";
import tailwindConfig from "../../../tailwind.config.js?raw";

afterEach(() => vi.restoreAllMocks());

describe("landing page", () => {
  it("is what a signed-out visitor sees at /, with sign-in calls to action", async () => {
    stubSupportedBrowser();
    mockApi({ "GET /api/me": () => UNAUTH });
    renderApp(<App />, "/");
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: /ace every interview/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("InterviewMeet").length).toBeGreaterThan(0);
    for (const link of screen.getAllByRole("link", { name: /get started/i })) {
      expect(link).toHaveAttribute("href", "/signup");
    }
    for (const link of screen.getAllByRole("link", { name: /^sign in$/i })) {
      expect(link).toHaveAttribute("href", "/login");
    }
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
  });

  it("sends a signed-in user straight to the dashboard", async () => {
    stubSupportedBrowser();
    mockApi({ "GET /api/me": () => ({ json: ME }) });
    renderApp(<App />, "/");
    expect(
      await screen.findByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
  });

  it("works in a browser the app does not support (for example a phone)", async () => {
    mockApi({ "GET /api/me": () => UNAUTH }); // no stubSupportedBrowser: jsdom is unsupported
    renderApp(<App />, "/");
    expect(
      await screen.findByRole("heading", { level: 1 }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/isn't supported/i)).not.toBeInTheDocument();
  });

  it("states only what the product does: no invented statistics, ratings or logos", async () => {
    mockApi({ "GET /api/me": () => UNAUTH });
    const { container } = renderApp(<App />, "/");
    await screen.findByRole("heading", { level: 1 });
    const text = container.textContent ?? "";
    for (const invented of [
      /trustpilot/i,
      /180k/i,
      /94%/,
      /stanford|harvard|mit\b/i,
      /testimonial/i,
    ]) {
      expect(text).not.toMatch(invented);
    }
    expect(text).toMatch(/partner who knows/i); // the consent positioning is on the page
  });

  it("marks every illustration as an example", async () => {
    mockApi({ "GET /api/me": () => UNAUTH });
    const { container } = renderApp(<App />, "/");
    await screen.findByRole("heading", { level: 1 });
    const windows = container.querySelectorAll(
      '[aria-hidden="true"].shadow-card, [aria-hidden="true"].shadow-lift',
    );
    expect(windows.length).toBeGreaterThan(0);
    windows.forEach((w) => expect(w.textContent).toMatch(/example/i));
  });
});

describe("brand tokens", () => {
  it("uses the four brand colours and Inter", async () => {
    const cfg = tailwindConfig.toLowerCase();
    for (const hex of ["#f7f4ff", "#ffffff", "#1c1b2e", "#7b47f3"])
      expect(cfg).toContain(hex);
    expect(cfg).toContain("inter variable");
    expect(main).toContain("@fontsource-variable/inter/wght.css");
    expect(main).toContain("@fontsource-variable/inter/wght-italic.css");
  });
});

describe("header", () => {
  it("blends into the page: no card, background or shadow of its own", async () => {
    mockApi({ "GET /api/me": () => UNAUTH });
    renderApp(<App />, "/");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(nav.className).not.toMatch(/bg-surface|shadow|rounded/);
  });
});

describe("the desktop download", () => {
  it("offers the Windows installer from the landing page", async () => {
    stubSupportedBrowser();
    mockApi({ "GET /api/me": () => UNAUTH });
    renderApp(<App />, "/");
    const link = await screen.findByRole("link", {
      name: "Download for Windows",
    });
    expect(link).toHaveAttribute("href", WINDOWS_DOWNLOAD_URL);
    expect(WINDOWS_DOWNLOAD_URL).toMatch(
      /^https:\/\/github\.com\/.+\/releases\/latest\/download\/InterviewMeet-Setup\.exe$/,
    );
    expect(screen.getByText(/Mac version coming soon/)).toBeInTheDocument();
  });
});
