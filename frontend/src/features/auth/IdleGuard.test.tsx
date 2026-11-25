import { act, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { App } from "../../app/App";
import { ME, mockApi, renderApp, stubSupportedBrowser } from "../../test-utils";
import { IDLE_MS } from "./IdleGuard";

const MIN = 60_000;

beforeEach(() => {
  stubSupportedBrowser();
  try {
    localStorage.removeItem("im-last-active");
  } catch {
    /* not available */
  }
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

let signedOut = false;
const signedIn = (extra: Record<string, () => object> = {}) => {
  signedOut = false;
  return mockApi({
    "GET /api/me": () =>
      signedOut
        ? {
            status: 401,
            json: { error: { code: "not_authenticated", message: "Sign in." } },
          }
        : { json: { ...ME, onboarded: true, tour_done: true } },
    "GET /api/notes": () => ({
      json: { role: "", content: "x", updated_at: null },
    }),
    "GET /api/sessions": () => ({ json: { items: [], next_cursor: null } }),
    "GET /api/billing": () => ({ status: 404, json: {} }),
    ...extra,
  });
};

/** Move the clock without waiting, and let the app's timers run. */
const pass = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe("signing out after 20 minutes of inactivity", () => {
  it("is twenty minutes", () => {
    expect(IDLE_MS).toBe(20 * MIN);
  });

  it("warns a minute before, and staying signed in starts the count again", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const out = vi.fn(() => ({ json: { status: "ok" } }));
    signedIn({ "POST /api/auth/logout": out });
    renderApp(<App />, "/dashboard");
    await screen.findByRole("heading", { name: /^Good/ });
    await pass(18 * MIN);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await pass(1.5 * MIN);
    const warn = await screen.findByRole("alertdialog");
    expect(warn).toHaveTextContent(/signed out in/);
    act(() => screen.getByRole("button", { name: "Stay signed in" }).click());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await pass(10 * MIN);
    expect(out).not.toHaveBeenCalled(); // the clock started again at that click
  });

  it("signs out when nothing has been touched for 20 minutes, and says why", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const out = vi.fn(() => {
      signedOut = true;
      return { json: { status: "ok" } };
    });
    signedIn({ "POST /api/auth/logout": out });
    renderApp(<App />, "/dashboard");
    await screen.findByRole("heading", { name: /^Good/ });
    await pass(21 * MIN);
    await waitFor(() => expect(out).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(/signed out after 20 minutes of inactivity/),
    ).toBeVisible();
  });

  it("any touch counts as being here", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const out = vi.fn(() => ({ json: { status: "ok" } }));
    signedIn({ "POST /api/auth/logout": out });
    renderApp(<App />, "/dashboard");
    await screen.findByRole("heading", { name: /^Good/ });
    for (let i = 0; i < 5; i++) {
      await pass(10 * MIN);
      act(() => {
        window.dispatchEvent(new Event("pointerdown"));
      });
    }
    expect(out).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
