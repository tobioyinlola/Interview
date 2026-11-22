import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import { ME, mockApi, renderApp, stubSupportedBrowser } from "../../test-utils";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

const api = (me: object, extra: Record<string, () => object> = {}) =>
  mockApi({
    "GET /api/me": () => ({ json: me }),
    "GET /api/notes": () => ({
      json: { role: "", content: "", updated_at: null },
    }),
    "GET /api/companies": () => ({ json: [] }),
    "GET /api/sessions": () => ({ json: { items: [], next_cursor: null } }),
    "GET /api/billing": () => ({ status: 404, json: {} }),
    "PUT /api/tour": () => ({ json: { ...me, tour_done: true } }),
    ...extra,
  });

const fresh = { ...ME, onboarded: true, tour_done: false };

describe("the first-time tour", () => {
  it("starts by itself on the dashboard for someone who has not had it", async () => {
    api(fresh);
    renderApp(<App />, "/dashboard");
    expect(
      await screen.findByRole("dialog", { name: "Welcome to InterviewMeet" }),
    ).toBeInTheDocument();
  });

  it("does not start for someone who has had it", async () => {
    api({ ...fresh, tour_done: true });
    renderApp(<App />, "/dashboard");
    await screen.findByRole("combobox");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not start when the account does not say (an older answer without the field)", async () => {
    api({ ...ME, onboarded: true });
    renderApp(<App />, "/dashboard");
    await screen.findByRole("combobox");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("never interrupts another page", async () => {
    api(fresh);
    renderApp(<App />, "/notes");
    await screen.findByRole("combobox");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("remembers that it was skipped, and does not come back", async () => {
    const calls = api(fresh);
    renderApp(<App />, "/dashboard");
    await userEvent.click(
      await screen.findByRole("button", { name: "Skip tour" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.find((c) => c.key === "PUT /api/tour")!.body).toEqual({
      done: true,
    });
    await userEvent.click(screen.getByRole("link", { name: "Overview" })); // back to the dashboard
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("remembers that it was finished", async () => {
    const calls = api(fresh);
    renderApp(<App />, "/dashboard");
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    for (let i = 0; i < 7; i++)
      await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.filter((c) => c.key === "PUT /api/tour")).toHaveLength(1);
  });

  it("can be taken again from the account menu, even after it was done", async () => {
    api({ ...fresh, tour_done: true });
    renderApp(<App />, "/dashboard");
    await userEvent.click(
      await screen.findByRole("button", { name: /Account menu/ }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Take the tour" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Welcome to InterviewMeet" }),
    ).toBeInTheDocument();
  });

  it("can be taken again from the Help page", async () => {
    api({ ...fresh, tour_done: true });
    renderApp(<App />, "/help");
    await userEvent.click(
      await screen.findByRole("button", { name: "Take the tour" }),
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("points at items that really exist in the app's layout", async () => {
    api({ ...fresh, tour_done: true });
    renderApp(<App />, "/dashboard");
    await screen.findByRole("combobox");
    for (const t of [
      "search",
      "nav-settings",
      "nav-companies",
      "nav-session-new",
      "nav-sessions",
      "nav-referrals",
      "profile",
    ])
      expect(document.querySelector(`[data-tour="${t}"]`), t).not.toBeNull();
  });

  it("the step through the app: names each place in order", async () => {
    api(fresh);
    renderApp(<App />, "/dashboard");
    const seen: string[] = [];
    await screen.findByRole("dialog");
    for (let i = 0; i < 9; i++) {
      seen.push(
        within(screen.getByRole("dialog")).getByRole("heading").textContent ??
          "",
      );
      if (i < 8)
        await userEvent.click(
          screen.getByRole("button", { name: i === 0 ? "Start" : "Next" }),
        );
    }
    expect(seen[0]).toBe("Welcome to InterviewMeet");
    expect(seen[2]).toBe("1. Upload your CV");
    expect(seen[5]).toBe("The live panel");
    expect(seen[8]).toBe("Your account");
  });
});
