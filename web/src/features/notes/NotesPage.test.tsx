import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import { ME, mockApi, renderApp, stubSupportedBrowser } from "../../test-utils";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

describe("NotesPage", () => {
  it("loads saved notes without saving them back", async () => {
    const calls = mockApi({
      "GET /api/me": () => ({ json: ME }),
      "GET /api/notes": () => ({
        json: { role: "PM", content: "Led launch", updated_at: "x" },
      }),
    });
    renderApp(<App />, "/notes");
    expect(await screen.findByDisplayValue("Led launch")).toBeInTheDocument();
    expect(screen.getByDisplayValue("PM")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.some((c) => c.key === "PUT /api/notes")).toBe(false);
  });

  it("autosaves edits and shows the character limit", async () => {
    const calls = mockApi({
      "GET /api/me": () => ({ json: ME }),
      "GET /api/notes": () => ({
        json: { role: "", content: "", updated_at: null },
      }),
      "PUT /api/notes": ({ body }) => ({
        json: { ...(body as object), updated_at: "now" },
      }),
    });
    renderApp(<App />, "/notes");
    await userEvent.type(
      await screen.findByLabelText("Experience notes"),
      "Shipped X",
    );
    expect(screen.getByText(/9 \/ 16,000/)).toBeInTheDocument();
    expect(
      await screen.findByText("Saved", {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    const puts = calls.filter((c) => c.key === "PUT /api/notes");
    expect(puts).toHaveLength(1);
    expect(puts[0].body).toEqual({ role: "", content: "Shipped X" });
  });
});
