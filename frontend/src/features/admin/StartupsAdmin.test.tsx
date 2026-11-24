import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import { mockApi, renderApp, stubSupportedBrowser } from "../../test-utils";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

const dir = (over: object = {}) => ({
  id: "d1",
  name: "Seedcamp",
  url: "https://seedcamp.com/our-companies/",
  region_hint: "eu",
  enabled: true,
  builtin: true,
  last_run_at: null,
  last_found: 0,
  last_added: 0,
  last_problem: null,
  ...over,
});
const data = (over: object = {}) => ({
  startups: 14,
  by_status: { researched: 9, new: 4, dead: 1 },
  by_region: { us: 8, eu: 6 },
  with_contacts: 7,
  with_openings: 3,
  directories: [
    dir(),
    dir({
      id: "d2",
      name: "Local Hub",
      builtin: false,
      last_problem: "No readable text was found. The page may need JavaScript.",
      last_run_at: "2026-11-24T08:00:00Z",
    }),
  ],
  ...over,
});
const base = (routes: Record<string, () => object> = {}) =>
  mockApi({
    "GET /api/admin/auth/me": () => ({
      json: { email: "boss@example.com", full_name: null },
    }),
    "GET /api/billing": () => ({ status: 404, json: {} }),
    "GET /api/admin/startups/overview": () => ({ json: data() }),
    ...routes,
  });

describe("Back office: startups", () => {
  it("shows the totals and what each directory gave us, including why one failed", async () => {
    base();
    renderApp(<App />, "/admin/startups");
    const totals = within(await screen.findByLabelText("Startup totals"));
    expect(totals.getByText("14")).toBeInTheDocument();
    expect(
      totals.getByText("9 waiting".replace("9", "4"), { exact: false }),
    ).toBeInTheDocument();
    const table = within(screen.getByRole("table", { name: "Directories" }));
    expect(table.getByText("Seedcamp")).toBeInTheDocument();
    expect(table.getByText("Not yet")).toBeInTheDocument();
    expect(table.getByText(/may need JavaScript/)).toBeInTheDocument();
  });

  it("reads a directory now, turns one off, and only offers delete for ones we added", async () => {
    const read = vi.fn(() => ({ json: dir({ last_found: 5 }) }));
    const off = vi.fn(() => ({ json: dir({ enabled: false }) }));
    base({
      "POST /api/admin/startups/directories/d1/refresh": read,
      "PUT /api/admin/startups/directories/d1": off,
    });
    renderApp(<App />, "/admin/startups");
    const table = within(
      await screen.findByRole("table", { name: "Directories" }),
    );
    expect(table.getAllByRole("button", { name: "Delete" })).toHaveLength(1);
    await userEvent.click(
      table.getAllByRole("button", { name: "Read now" })[0],
    );
    await waitFor(() => expect(read).toHaveBeenCalled());
    await userEvent.click(table.getByLabelText("Read Seedcamp every week"));
    await waitFor(() => expect(off).toHaveBeenCalled());
  });

  it("adds a directory", async () => {
    const add = vi.fn(() => ({
      status: 201,
      json: dir({ id: "d3", name: "New Hub" }),
    }));
    base({ "POST /api/admin/startups/directories": add });
    renderApp(<App />, "/admin/startups");
    await userEvent.type(
      await screen.findByLabelText("Directory name"),
      "New Hub",
    );
    await userEvent.type(
      screen.getByLabelText("Directory address"),
      "https://hub.example/portfolio",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Add directory" }),
    );
    await waitFor(() => expect(add).toHaveBeenCalled());
  });

  it("imports pasted companies, one per line", async () => {
    const imp = vi.fn(() => ({ json: { added: 2, skipped: 0 } }));
    base({ "POST /api/admin/startups/import": imp });
    renderApp(<App />, "/admin/startups");
    await userEvent.type(
      await screen.findByLabelText("Source name"),
      "Techstars Berlin",
    );
    await userEvent.type(
      screen.getByLabelText("Companies"),
      "Acme, acme.io, Germany, Payments{enter}Beta, beta.io",
    );
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(imp).toHaveBeenCalled());
    expect(await screen.findByText(/Added 2, skipped 0/)).toBeInTheDocument();
  });
});
