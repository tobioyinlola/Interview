import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { mockApi, renderApp } from "../../test-utils";
import { JobSourcesPanel } from "./JobSourcesPanel";

const row = (over: Record<string, unknown>) => ({
  kind: "greenhouse",
  board: "acme",
  company: "Acme",
  origin: "startup",
  url: "https://boards.greenhouse.io/acme",
  enabled: true,
  health: "ok",
  jobs_listed: 40,
  every_minutes: 60,
  last_synced_at: "2026-11-26T07:00:00Z",
  last_error: null,
  ...over,
});

describe("back office: job boards", () => {
  it("opens the full list on request, searches it and offers the download", async () => {
    const list = vi.fn(() => ({
      json: {
        items: [
          row({}),
          row({
            kind: "jobicy",
            board: "",
            company: null,
            origin: "settings",
            url: "https://jobicy.com",
            jobs_listed: 100,
          }),
        ],
      },
    }));
    mockApi({
      "GET /api/admin/job-sources": () => ({
        json: {
          mode: "central",
          total: 2,
          by_kind: { greenhouse: 1, jobicy: 1 },
          by_health: { ok: 2 },
          jobs_listed: 140,
          failing: [],
        },
      }),
      "GET /api/admin/job-sources/list": list,
    });
    renderApp(<JobSourcesPanel />, "/admin/auto-apply");
    const open = await screen.findByRole("button", { name: "See all 2" });
    expect(list).not.toHaveBeenCalled(); // read only when opened
    expect(screen.getByRole("link", { name: "Download CSV" })).toHaveAttribute(
      "href",
      expect.stringContaining("/api/admin/job-sources/export.csv"),
    );
    await userEvent.click(open);
    const table = within(
      await screen.findByRole("table", { name: "All job boards" }),
    );
    expect(table.getByRole("link", { name: "Acme" })).toHaveAttribute(
      "href",
      "https://boards.greenhouse.io/acme",
    );
    expect(table.getByText(/found via startup research/)).toBeInTheDocument();
    expect(
      table.getByRole("link", { name: "Jobicy feed" }),
    ).toBeInTheDocument();
    await userEvent.type(
      screen.getByPlaceholderText("Find a company or board"),
      "acme",
    );
    expect(table.queryByRole("link", { name: "Jobicy feed" })).toBeNull();
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
  });
});
