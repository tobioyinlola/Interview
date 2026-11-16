import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import { ME, mockApi, renderApp, stubSupportedBrowser } from "../../test-utils";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

const row = (id: string, over = {}) => ({
  id,
  started_at: "2026-11-16T10:00:00Z",
  ended_at: "2026-11-16T10:12:30Z",
  duration_seconds: 750,
  status: "ended",
  company_id: "c1",
  company_name: "Acme",
  question_count: 3,
  ...over,
});
const me = { "GET /api/me": () => ({ json: ME }) };

describe("SessionsPage (FR-35)", () => {
  it("lists past sessions with date, length, company and question count", async () => {
    mockApi({
      ...me,
      "GET /api/sessions": () => ({
        json: {
          items: [
            row("s1"),
            row("s2", {
              company_name: null,
              duration_seconds: null,
              ended_at: null,
              question_count: 1,
            }),
          ],
          next_cursor: null,
        },
      }),
    });
    renderApp(<App />, "/sessions");
    // within the page, not the sidebar navigation that wraps every signed-in page
    const items = await waitFor(() =>
      within(screen.getByRole("main")).getAllByRole("listitem"),
    );
    const rows = items.filter((i) => i.textContent?.includes("question"));
    expect(rows[0]).toHaveTextContent("Acme · 12 min 30 s · 3 questions");
    expect(rows[1]).toHaveTextContent("No company · in progress · 1 question");
    expect(within(rows[0]).getByRole("link")).toHaveAttribute(
      "href",
      "/sessions/s1",
    );
  });

  it("explains the empty state", async () => {
    mockApi({
      ...me,
      "GET /api/sessions": () => ({ json: { items: [], next_cursor: null } }),
    });
    renderApp(<App />, "/sessions");
    expect(await screen.findByText(/No sessions yet/)).toBeInTheDocument();
  });

  it("loads more pages with the cursor", async () => {
    const urls: string[] = [];
    mockApi({
      ...me,
      "GET /api/sessions": () => ({
        json: { items: [row("s1")], next_cursor: "CURSOR1" },
      }),
    });
    const base = globalThis.fetch as unknown as (
      u: string,
      i?: RequestInit,
    ) => Promise<Response>;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      urls.push(url);
      if (url.includes("cursor=CURSOR1")) {
        return new Response(
          JSON.stringify({
            items: [row("s2", { started_at: "2026-11-15T09:00:00Z" })],
            next_cursor: null,
          }),
        );
      }
      return base(url, init);
    });
    renderApp(<App />, "/sessions");
    await userEvent.click(
      await screen.findByRole("button", { name: "Load more" }),
    );
    await waitFor(() =>
      expect(
        screen.getAllByRole("link", { name: /2026|Nov/ }).length,
      ).toBeGreaterThanOrEqual(2),
    );
    expect(urls.some((u) => u.includes("cursor=CURSOR1"))).toBe(true);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull(); // last page
  });

  it("deletes a session after confirmation", async () => {
    let items = [row("s1")];
    const calls = mockApi({
      ...me,
      "GET /api/sessions": () => ({ json: { items, next_cursor: null } }),
      "DELETE /api/sessions/s1": () => {
        items = [];
        return { json: { status: "ok" } };
      },
    });
    renderApp(<App />, "/sessions");
    await userEvent.click(
      await screen.findByRole("button", { name: /Delete session from/ }),
    );
    expect(calls.some((c) => c.key.startsWith("DELETE"))).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(
      screen.getByRole("button", { name: /Delete session from/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(await screen.findByText(/No sessions yet/)).toBeInTheDocument();
  });
});
