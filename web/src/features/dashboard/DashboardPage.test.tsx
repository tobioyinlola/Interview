import { screen, within } from "@testing-library/react";

import { App } from "../../app/App";
import { ME, mockApi, renderApp, stubSupportedBrowser } from "../../test-utils";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const base = (over: Record<string, () => object> = {}) => ({
  "GET /api/me": () => ({ json: ME }),
  "GET /api/notes": () => ({
    json: { role: "PM", content: "Led a launch.", updated_at: "x" },
  }),
  "GET /api/companies": () => ({ json: [] }),
  "GET /api/sessions": () => ({ json: { items: [], next_cursor: null } }),
  ...over,
});
const card = () => screen.findByRole("region", { name: "Readiness" });

describe("DashboardPage (FR-33)", () => {
  it("tells a new user what to do next", async () => {
    mockApi(
      base({
        "GET /api/notes": () => ({
          json: { role: "", content: "", updated_at: null },
        }),
      }),
    );
    renderApp(<App />, "/");
    const c = within(await card());
    expect(c.getAllByText("Not done:").length).toBeGreaterThanOrEqual(3); // notes, brief and consent
    expect(c.getByRole("link", { name: "Add your notes" })).toHaveAttribute(
      "href",
      "/notes",
    );
    expect(c.getByRole("link", { name: "Add a company" })).toHaveAttribute(
      "href",
      "/companies",
    );
    expect(await screen.findByText("No companies yet.")).toBeInTheDocument();
    expect(await screen.findByText("No sessions yet.")).toBeInTheDocument();
  });

  it("ticks notes, a fresh brief and the browser, and reminds about consent", async () => {
    mockApi(
      base({
        "GET /api/companies": () => ({
          json: [
            {
              id: "c1",
              name: "Acme",
              last_researched_at: ago(2),
              job_status: "ready",
            },
          ],
        }),
      }),
    );
    renderApp(<App />, "/");
    const c = within(await card());
    await screen.findByText("Company brief ready and fresh");
    expect(c.getByText(/Notes saved/)).toBeInTheDocument();
    expect(c.queryByRole("link", { name: "Add your notes" })).toBeNull();
    expect(c.getByText("Browser can share tab audio")).toBeInTheDocument();
    expect(
      c.getByText(/Partner consent: you confirm it when you start a session/),
    ).toBeInTheDocument();
    expect(c.getByRole("link", { name: "Start practice" })).toHaveAttribute(
      "href",
      "/session/new",
    );
  });

  it("warns when the newest brief is more than 7 days old", async () => {
    mockApi(
      base({
        "GET /api/companies": () => ({
          json: [
            {
              id: "c1",
              name: "Old",
              last_researched_at: ago(12),
              job_status: "ready",
            },
            {
              id: "c2",
              name: "Older",
              last_researched_at: ago(30),
              job_status: "ready",
            },
          ],
        }),
      }),
    );
    renderApp(<App />, "/");
    expect(await screen.findByText(/brief is 12 days old/i)).toHaveTextContent(
      /researching again/i,
    );
    expect(screen.getByText("Needs attention:")).toBeInTheDocument();
  });

  it("does not warn if any brief is fresh, even when another is old", async () => {
    mockApi(
      base({
        "GET /api/companies": () => ({
          json: [
            {
              id: "c1",
              name: "Old",
              last_researched_at: ago(30),
              job_status: "ready",
            },
            {
              id: "c2",
              name: "New",
              last_researched_at: ago(1),
              job_status: "ready",
            },
          ],
        }),
      }),
    );
    renderApp(<App />, "/");
    expect(
      await screen.findByText("Company brief ready and fresh"),
    ).toBeInTheDocument();
  });

  it("lists companies with status and recent sessions with links", async () => {
    mockApi(
      base({
        "GET /api/companies": () => ({
          json: [
            {
              id: "a",
              name: "Alpha",
              last_researched_at: null,
              job_status: "searching",
            },
            {
              id: "b",
              name: "Beta",
              last_researched_at: ago(1),
              job_status: "ready",
            },
            {
              id: "c",
              name: "Gamma",
              last_researched_at: null,
              job_status: "failed",
            },
            {
              id: "d",
              name: "Delta",
              last_researched_at: null,
              job_status: null,
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
                duration_seconds: 125,
                status: "ended",
                company_id: "b",
                company_name: "Beta",
                question_count: 4,
              },
            ],
            next_cursor: null,
          },
        }),
      }),
    );
    renderApp(<App />, "/");
    const co = within(await screen.findByRole("region", { name: "Companies" }));
    expect(await co.findByText("Researching…")).toBeInTheDocument();
    expect(co.getByText("Brief ready")).toBeInTheDocument();
    expect(co.getByText("Research failed")).toBeInTheDocument();
    expect(co.getByText("Not researched")).toBeInTheDocument();
    const se = within(screen.getByRole("region", { name: "Recent sessions" }));
    expect(
      await se.findByText(/Beta · 2 min 5 s · 4 questions/),
    ).toBeInTheDocument();
    expect(se.getByRole("link", { name: /2026|Nov/ })).toHaveAttribute(
      "href",
      "/sessions/s1",
    );
  });

  it("shows only the five most recent items", async () => {
    mockApi(
      base({
        "GET /api/companies": () => ({
          json: Array.from({ length: 8 }, (_, i) => ({
            id: `c${i}`,
            name: `Company${i}`,
            last_researched_at: null,
            job_status: null,
          })),
        }),
      }),
    );
    renderApp(<App />, "/");
    await screen.findByText("Company0");
    expect(screen.queryByText("Company5")).toBeNull();
  });
});
