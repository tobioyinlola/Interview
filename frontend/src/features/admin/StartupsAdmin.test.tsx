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

const startup = (over: object = {}) => ({
  id: "s1",
  name: "Lumen",
  website: "https://lumen.io",
  domain: "lumen.io",
  directory: "Seedcamp",
  directory_url: "https://seedcamp.com/our-companies/",
  batch: "W26",
  one_liner: "Payment links",
  sector: "fintech",
  region: "eu",
  country: "France",
  status: "researched",
  researched_at: "2026-11-24T08:00:00Z",
  created_at: "2026-11-23T08:00:00Z",
  summary: "Lumen makes payment links for small shops.",
  hiring: true,
  careers_url: "https://lumen.io/careers",
  openings: [
    { title: "Senior Product Manager", url: "https://lumen.io/careers/pm" },
  ],
  contacts: [
    {
      email: "jobs@lumen.io",
      name: null,
      title: null,
      kind: "role",
      source_url: "https://lumen.io/contact",
    },
  ],
  ...over,
});

describe("Back office: the lists behind the totals", () => {
  it("makes each total a link to the list it counts", async () => {
    base();
    renderApp(<App />, "/admin/startups");
    const totals = within(await screen.findByLabelText("Startup totals"));
    const hrefs = totals
      .getAllByRole("link", { name: "See the list" })
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      "/admin/startups/list",
      "/admin/startups/list?filter=researched",
      "/admin/startups/list?filter=contacts",
      "/admin/startups/roles",
    ]);
  });

  it("links a directory's Found number to the startups it gave us", async () => {
    base({
      "GET /api/admin/startups/overview": () => ({
        json: data({
          directories: [
            dir({ last_found: 12, last_run_at: "2026-11-24T08:00:00Z" }),
          ],
        }),
      }),
    });
    renderApp(<App />, "/admin/startups");
    const table = within(
      await screen.findByRole("table", { name: "Directories" }),
    );
    expect(table.getByRole("link", { name: "12" })).toHaveAttribute(
      "href",
      "/admin/startups/list?directory=Seedcamp",
    );
  });

  it("shows each startup with its website, what it does, roles with apply links and contacts", async () => {
    base({
      "GET /api/admin/startups/list": () => ({
        json: { total: 1, items: [startup()] },
      }),
    });
    renderApp(<App />, "/admin/startups/list");
    const startups = await screen.findByRole("list", { name: "Startups" });
    const card = within(within(startups).getAllByRole("listitem")[0]);
    expect(card.getByRole("link", { name: "Lumen" })).toHaveAttribute(
      "href",
      "https://lumen.io",
    );
    expect(card.getByText("https://lumen.io")).toBeVisible();
    expect(
      card.getByText(/Lumen makes payment links for small shops/),
    ).toBeVisible();
    expect(card.getByText(/Payment links/)).toBeVisible();
    expect(card.getByText(/France \(eu\)/)).toBeVisible();
    expect(card.getByRole("link", { name: "Seedcamp" })).toHaveAttribute(
      "href",
      "https://seedcamp.com/our-companies/",
    );
    expect(card.getByText("Senior Product Manager")).toBeVisible();
    expect(card.getByRole("link", { name: "Apply link" })).toHaveAttribute(
      "href",
      "https://lumen.io/careers/pm",
    );
    expect(card.getByText("jobs@lumen.io")).toBeVisible();
    expect(
      card.getByRole("link", { name: "where it is published" }),
    ).toHaveAttribute("href", "https://lumen.io/contact");
  });

  it("opens on what the link says: the filter, the directory and the page", async () => {
    base({
      "GET /api/admin/startups/list": () => ({
        json: { total: 60, items: [startup()] },
      }),
    });
    renderApp(
      <App />,
      "/admin/startups/list?filter=contacts&directory=Seedcamp&page=1",
    );
    await screen.findByRole("list", { name: "Startups" });
    expect(
      screen.getByRole("button", { name: "With a contact" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: /From Seedcamp/ })).toBeVisible();
    expect(screen.getByText(/60 startups from Seedcamp/)).toBeVisible();
    expect(screen.getByText("Page 2 of 3")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Page 3 of 3")).toBeVisible();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("says so when nothing matches", async () => {
    base({
      "GET /api/admin/startups/list": () => ({ json: { total: 0, items: [] } }),
    });
    renderApp(<App />, "/admin/startups/list?q=zzz");
    expect(await screen.findByText("No startups match that.")).toBeVisible();
  });

  it("lists every open role with the startup and an apply link", async () => {
    base({
      "GET /api/admin/startups/roles": () => ({
        json: {
          total: 2,
          startups: 2,
          items: [
            {
              startup_id: "s1",
              startup: "Lumen",
              website: "https://lumen.io",
              region: "eu",
              country: "France",
              directory: "Seedcamp",
              title: "Senior Product Manager",
              url: "https://lumen.io/careers/pm",
              careers_url: "https://lumen.io/careers",
            },
            {
              startup_id: "s2",
              startup: "Nova",
              website: "https://nova.io",
              region: "us",
              country: null,
              directory: "Techstars",
              title: "Product Designer",
              url: "https://nova.io/jobs/1",
              careers_url: null,
            },
          ],
        },
      }),
    });
    renderApp(<App />, "/admin/startups/roles");
    expect(await screen.findByText(/2 roles at 2 startups/)).toBeVisible();
    const list = screen.getByRole("list", { name: "Open roles" });
    const [first, second] = within(list).getAllByRole("listitem");
    expect(within(first).getByText("Senior Product Manager")).toBeVisible();
    expect(within(first).getByRole("link", { name: "Lumen" })).toHaveAttribute(
      "href",
      "https://lumen.io",
    );
    expect(
      within(first).getByRole("link", { name: "Apply link" }),
    ).toHaveAttribute("href", "https://lumen.io/careers/pm");
    expect(
      within(first).getByRole("link", { name: "Careers page" }),
    ).toHaveAttribute("href", "https://lumen.io/careers");
    expect(within(second).getByText("Product Designer")).toBeVisible();
    expect(
      within(second).queryByRole("link", { name: "Careers page" }),
    ).toBeNull();
  });

  it("explains an empty roles list", async () => {
    base({
      "GET /api/admin/startups/roles": () => ({
        json: { total: 0, startups: 0, items: [] },
      }),
    });
    renderApp(<App />, "/admin/startups/roles");
    expect(await screen.findByText(/No open roles found yet/)).toBeVisible();
  });
});
