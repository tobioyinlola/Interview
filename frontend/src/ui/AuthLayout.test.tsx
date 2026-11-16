import { screen } from "@testing-library/react";

import indexHtml from "../../index.html?raw";
import { App } from "../app/App";
import {
  UNAUTH,
  mockApi,
  renderApp,
  stubSupportedBrowser,
} from "../test-utils";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

const BOXED =
  ".card, [class*='shadow'], [class*='rounded-2xl'], [class*='border ']";

describe("form pages have no box around the form", () => {
  it.each([
    ["/signup", "Create your account"],
    ["/login", "Sign in"],
    ["/forgot-password", "Reset your password"],
    ["/reset-password?token=abcdefghijklmnop", "Choose a new password"],
    ["/login/verify", "That link didn't work"],
  ])("%s sits straight on the page", async (route, heading) => {
    mockApi({
      "GET /api/me": () => UNAUTH,
      "GET /api/auth/providers": () => ({ json: { google: true } }),
    });
    renderApp(<App />, route);
    await screen.findByRole("heading", { name: heading });
    expect(screen.getByRole("main").querySelector(BOXED)).toBeNull();
  });

  it("applies to the terms and privacy pages and the unsupported-browser notice too", async () => {
    mockApi({ "GET /api/me": () => UNAUTH });
    const { unmount } = renderApp(<App />, "/terms");
    await screen.findByRole("heading", { name: "Terms of use" });
    expect(screen.getByRole("main").querySelector(BOXED)).toBeNull();
    unmount();
    vi.restoreAllMocks();
    mockApi({ "GET /api/me": () => UNAUTH }); // jsdom is not a supported browser
    renderApp(<App />, "/dashboard");
    await screen.findByRole("heading", { name: /isn't supported/i });
    expect(screen.getByRole("main").querySelector(BOXED)).toBeNull();
  });
});

describe("phone setup", () => {
  it("lets the page draw under the notch (viewport-fit=cover) at device width", () => {
    expect(indexHtml).toMatch(/name="viewport"[^>]*width=device-width/);
    expect(indexHtml).toMatch(/viewport-fit=cover/);
  });

  it("gives email fields the right keyboard and stops autocorrect mangling them", async () => {
    mockApi({
      "GET /api/me": () => UNAUTH,
      "GET /api/auth/providers": () => ({ json: { google: false } }),
    });
    renderApp(<App />, "/signup");
    const email = await screen.findByLabelText("Email address");
    expect(email).toHaveAttribute("inputmode", "email");
    expect(email).toHaveAttribute("autocapitalize", "none");
    expect(email).toHaveAttribute("autocorrect", "off");
    expect(email).toHaveAttribute("spellcheck", "false");
  });

  it("makes the terms checkbox a large tap target inside a clickable label", async () => {
    mockApi({
      "GET /api/me": () => UNAUTH,
      "GET /api/auth/providers": () => ({ json: { google: false } }),
    });
    renderApp(<App />, "/signup");
    const box = await screen.findByRole("checkbox", { name: /i agree/i });
    expect(box.className).toMatch(/h-6 w-6/);
    expect(box.closest("label")).not.toBeNull();
  });
});
