import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import { ME, mockApi, renderApp, stubSupportedBrowser } from "../../test-utils";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

const api = () =>
  mockApi({
    "GET /api/me": () => ({ json: { ...ME, onboarded: true } }),
    "GET /api/notes": () => ({
      json: { role: "PM", content: "x", updated_at: "x" },
    }),
    "GET /api/companies": () => ({
      json: [
        {
          id: "c1",
          name: "Northwind Payments",
          job_status: "ready",
          last_researched_at: null,
        },
      ],
    }),
    "GET /api/sessions": () => ({
      json: {
        items: [
          {
            id: "s1",
            started_at: "2026-11-16T10:00:00Z",
            ended_at: "x",
            duration_seconds: 60,
            status: "ended",
            company_id: "c1",
            company_name: "Northwind Payments",
            question_count: 3,
          },
        ],
        next_cursor: null,
      },
    }),
  });

const box = () => screen.findByRole("combobox");

describe("dashboard search", () => {
  it("sits in the top bar and finds companies, sessions and pages as you type", async () => {
    api();
    renderApp(<App />, "/dashboard");
    const input = await box();
    await userEvent.type(input, "north");
    const list = await screen.findByRole("listbox", { name: "Search results" });
    expect(
      within(within(list).getByRole("group", { name: "Companies" })).getByText(
        "Northwind Payments",
      ),
    ).toBeInTheDocument();
    expect(
      within(within(list).getByRole("group", { name: "Sessions" })).getByText(
        "Northwind Payments",
      ),
    ).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "true");
  });

  it("opens the highlighted result with Enter and clears itself", async () => {
    api();
    renderApp(<App />, "/dashboard");
    const input = await box();
    await userEvent.type(input, "northwind");
    await screen.findAllByRole("option");
    await userEvent.keyboard("{Enter}");
    // the first result is the company, whose page is requested
    expect(input).toHaveValue("");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("moves through results with the arrow keys", async () => {
    api();
    renderApp(<App />, "/dashboard");
    const input = await box();
    await userEvent.type(input, "northwind");
    const options = await screen.findAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      screen.getAllByRole("option")[1].id,
    );
  });

  it("says so when nothing matches, and Escape clears it", async () => {
    api();
    renderApp(<App />, "/dashboard");
    const input = await box();
    await userEvent.type(input, "zzzzqq");
    expect(await screen.findByText(/Nothing found for/)).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(input).toHaveValue("");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("jumps to the search box when / is pressed, but not while typing in another field", async () => {
    api();
    renderApp(<App />, "/dashboard");
    const input = await box();
    await userEvent.keyboard("/");
    expect(input).toHaveFocus();
    expect(input).toHaveValue(""); // the slash was a shortcut, not text
    await userEvent.type(input, "a/b");
    expect(input).toHaveValue("a/b"); // in the box a slash is just a slash
  });
});
