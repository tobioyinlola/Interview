import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import { ME, mockApi, renderApp, stubSupportedBrowser } from "../../test-utils";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

const summary = (over = {}) => ({
  days: [
    {
      day: "2026-11-16",
      sessions: 3,
      active_users: 2,
      stt_seconds: 2400,
      llm_input_tokens: 350000,
      llm_output_tokens: 15000,
      research_jobs: 3,
      research_tokens: 0,
      estimated_cost_usd: 0.9,
    },
    {
      day: "2026-11-15",
      sessions: 1,
      active_users: 1,
      stt_seconds: 600,
      llm_input_tokens: 100000,
      llm_output_tokens: 5000,
      research_jobs: 0,
      research_tokens: 0,
      estimated_cost_usd: 0.25,
    },
  ],
  top_users: [
    {
      email: "heavy@example.com",
      stt_seconds: 1800,
      tokens: 260000,
      research_jobs: 2,
      estimated_cost_usd: 0.65,
    },
    {
      email: "light@example.com",
      stt_seconds: 600,
      tokens: 105000,
      research_jobs: 1,
      estimated_cost_usd: 0.25,
    },
  ],
  total_cost_usd: 1.15,
  sessions: 4,
  avg_cost_per_session_usd: 0.2876,
  research_jobs: 3,
  avg_cost_per_research_job_usd: 0.0123,
  caps: {
    stt_seconds_daily: 5400,
    tokens_daily: 500000,
    research_jobs_daily: 10,
  },
  prices: {
    stt_per_minute: 0.017,
    llm_input_per_million: 0.4,
    llm_output_per_million: 1.6,
  },
  ...over,
});
const admin = { "GET /api/me": () => ({ json: { ...ME, is_admin: true } }) };

describe("UsagePage", () => {
  it("shows totals, averages, days, heaviest users and the caps in force", async () => {
    mockApi({ ...admin, "GET /api/admin/usage": () => ({ json: summary() }) });
    renderApp(<App />, "/admin/usage");
    const totals = within(await screen.findByLabelText("Totals"));
    expect(totals.getByText("$1.15")).toBeInTheDocument();
    expect(totals.getByText("$0.288")).toBeInTheDocument();
    expect(totals.getByText("$0.012")).toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("2026-11-16")).toBeInTheDocument();
    expect(within(rows[1]).getByText("40.0")).toBeInTheDocument(); // 2400 s of audio
    expect(within(rows[1]).getByText("350,000 / 15,000")).toBeInTheDocument();
    expect(within(rows[1]).getByText("$0.900")).toBeInTheDocument();
    const top = within(screen.getByRole("region", { name: "Heaviest users" }));
    const first = top.getAllByRole("listitem")[0];
    expect(first).toHaveTextContent("heavy@example.com");
    expect(first).toHaveTextContent("$0.650");
    expect(
      screen.getByText(
        /Transcription 90 min · Tokens 500,000 · Research jobs 10/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Estimates from counted audio seconds/),
    ).toBeInTheDocument();
  });

  it("changes the window and asks the server for it", async () => {
    const urls: string[] = [];
    mockApi({
      ...admin,
      "GET /api/admin/usage": () => ({ json: summary() }),
    });
    const base = globalThis.fetch as unknown as (
      u: string,
      i?: RequestInit,
    ) => Promise<Response>;
    vi.stubGlobal("fetch", (u: string, i?: RequestInit) => {
      urls.push(u);
      return base(u, i);
    });
    renderApp(<App />, "/admin/usage");
    await screen.findByLabelText("Totals");
    await userEvent.selectOptions(screen.getByLabelText(/Window/), "90");
    await screen.findByLabelText("Totals");
    expect(urls.some((u) => u.endsWith("days=30"))).toBe(true);
    expect(urls.some((u) => u.endsWith("days=90"))).toBe(true);
  });

  it("says so when there is no usage and shows n/a for averages", async () => {
    mockApi({
      ...admin,
      "GET /api/admin/usage": () => ({
        json: summary({
          days: [],
          top_users: [],
          total_cost_usd: 0,
          sessions: 0,
          avg_cost_per_session_usd: null,
          avg_cost_per_research_job_usd: null,
        }),
      }),
    });
    renderApp(<App />, "/admin/usage");
    expect(
      await screen.findByText("No usage in this window."),
    ).toBeInTheDocument();
    expect(
      within(screen.getByLabelText("Totals")).getAllByText("n/a"),
    ).toHaveLength(2);
  });

  it("is simply unavailable to someone who is not an admin (the server answers 404)", async () => {
    mockApi({
      "GET /api/me": () => ({ json: { ...ME, is_admin: false } }),
      "GET /api/admin/usage": () => ({
        status: 404,
        json: {
          error: { code: "not_found", message: "Not found.", request_id: "r" },
        },
      }),
    });
    renderApp(<App />, "/admin/usage");
    expect(await screen.findByText(/isn't available/)).toBeInTheDocument();
    expect(screen.queryByText("Estimated total")).toBeNull();
  });
});

describe("navigation", () => {
  it("shows the Usage link only to admins", async () => {
    mockApi({
      ...admin,
      "GET /api/notes": () => ({
        json: { role: "", content: "", updated_at: null },
      }),
      "GET /api/companies": () => ({ json: [] }),
      "GET /api/sessions": () => ({ json: { items: [], next_cursor: null } }),
    });
    renderApp(<App />, "/");
    expect(await screen.findByRole("link", { name: "Usage" })).toHaveAttribute(
      "href",
      "/admin/usage",
    );
  });

  it("hides it from everyone else", async () => {
    mockApi({
      "GET /api/me": () => ({ json: { ...ME, is_admin: false } }),
      "GET /api/notes": () => ({
        json: { role: "", content: "", updated_at: null },
      }),
      "GET /api/companies": () => ({ json: [] }),
      "GET /api/sessions": () => ({ json: { items: [], next_cursor: null } }),
    });
    renderApp(<App />, "/");
    await screen.findByRole("link", { name: "Sessions" });
    expect(screen.queryByRole("link", { name: "Usage" })).toBeNull();
  });
});
