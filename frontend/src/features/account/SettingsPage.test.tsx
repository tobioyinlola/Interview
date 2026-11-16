import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import {
  ME,
  UNAUTH,
  mockApi,
  renderApp,
  stubSupportedBrowser,
} from "../../test-utils";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

describe("SettingsPage", () => {
  it("states the practice-only, consent and third-party terms", async () => {
    mockApi({ "GET /api/me": () => ({ json: ME }) });
    renderApp(<App />, "/settings");
    expect(
      await screen.findByText(/partner who knows the assistant is on/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/processed by OpenAI/i)).toBeInTheDocument();
    expect(
      screen.getByText(/discarded. Only text is saved/i),
    ).toBeInTheDocument();
  });

  it("asks for confirmation before deleting, then deletes and leaves the app", async () => {
    let deleted = false;
    const calls = mockApi({
      "GET /api/me": () => (deleted ? UNAUTH : { json: ME }),
      "DELETE /api/account": () => {
        deleted = true;
        return { status: 202, json: { status: "accepted" } };
      },
    });
    renderApp(<App />, "/settings");
    await userEvent.click(
      await screen.findByRole("button", { name: /delete my account/i }),
    );
    expect(calls.some((c) => c.key === "DELETE /api/account")).toBe(false); // not yet
    await userEvent.click(
      screen.getByRole("button", { name: /yes, delete everything/i }),
    );
    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    const del = calls.find((c) => c.key === "DELETE /api/account")!;
    expect(del.headers.get("x-requested-with")).toBe("meet-practice");
  });

  it("lets the user cancel", async () => {
    const calls = mockApi({ "GET /api/me": () => ({ json: ME }) });
    renderApp(<App />, "/settings");
    await userEvent.click(
      await screen.findByRole("button", { name: /delete my account/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("button", { name: /delete my account/i }),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.key === "DELETE /api/account")).toBe(false);
  });
});
