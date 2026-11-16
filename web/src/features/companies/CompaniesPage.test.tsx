import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import { ME, mockApi, renderApp, stubSupportedBrowser } from "../../test-utils";
import { COMPANY, apiError, detail } from "./fixtures";

vi.mock("../../api/polling", async (orig) => ({
  ...(await orig<typeof import("../../api/polling")>()),
  POLL_MS: 20,
}));

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

const base = {
  "GET /api/me": () => ({ json: ME }),
  "GET /api/notes": () => ({
    json: { role: "Product Manager", content: "", updated_at: null },
  }),
};

const ago = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString();

describe("CompaniesPage", () => {
  it("explains the empty state", async () => {
    mockApi({ ...base, "GET /api/companies": () => ({ json: [] }) });
    renderApp(<App />, "/companies");
    expect(await screen.findByText(/No companies yet/i)).toBeInTheDocument();
  });

  it("lists companies with plain research status", async () => {
    mockApi({
      ...base,
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
            last_researched_at: ago(3),
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
    });
    renderApp(<App />, "/companies");
    // within the page, not the sidebar navigation that wraps every signed-in page
    const items = await waitFor(() =>
      within(screen.getByRole("main")).getAllByRole("listitem"),
    );
    const text = items.map((i) => i.textContent);
    expect(text).toEqual([
      expect.stringContaining("AlphaResearching…"),
      expect.stringContaining("BetaResearched 3 days ago"),
      expect.stringContaining("GammaResearch failed"),
      expect.stringContaining("DeltaNot researched"),
    ]);
    expect(screen.getByRole("link", { name: "Alpha" })).toHaveAttribute(
      "href",
      "/companies/a",
    );
  });

  it("adds a company, prefilling the role, and opens its page", async () => {
    const calls = mockApi({
      ...base,
      "GET /api/companies": () => ({ json: [] }),
      "POST /api/companies": () => ({
        status: 201,
        json: { company: COMPANY, job_id: "j1" },
      }),
      "GET /api/companies/c1": () => ({ json: detail() }),
    });
    renderApp(<App />, "/companies");
    await userEvent.click(
      await screen.findByRole("button", { name: "Add a company" }),
    );
    expect(await screen.findByLabelText("Role")).toHaveValue("Product Manager");
    await userEvent.type(screen.getByLabelText("Company name"), "  Acme  ");
    await userEvent.type(
      screen.getByLabelText(/Company website/),
      "https://acme.com",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save and research" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Acme" }),
    ).toBeInTheDocument();
    const post = calls.find((c) => c.key === "POST /api/companies")!;
    expect(post.body).toEqual({
      name: "Acme",
      website_url: "https://acme.com",
      job_posting_url: null,
      extra_links: [],
      role: "Product Manager",
      known_text: "",
    });
    expect(post.headers.get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(post.headers.get("x-requested-with")).toBe("meet-practice");
  });

  it("requires a company name", async () => {
    mockApi({ ...base, "GET /api/companies": () => ({ json: [] }) });
    renderApp(<App />, "/companies");
    await userEvent.click(
      await screen.findByRole("button", { name: "Add a company" }),
    );
    expect(
      screen.getByRole("button", { name: "Save and research" }),
    ).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Company name"), "A");
    expect(
      screen.getByRole("button", { name: "Save and research" }),
    ).toBeEnabled();
  });

  it("shows a rejected link's message and keeps everything typed", async () => {
    mockApi({
      ...base,
      "GET /api/companies": () => ({ json: [] }),
      "POST /api/companies": () =>
        apiError(
          422,
          "invalid_url",
          "Website: Links to localhost or local networks are not allowed.",
        ),
    });
    renderApp(<App />, "/companies");
    await userEvent.click(
      await screen.findByRole("button", { name: "Add a company" }),
    );
    await userEvent.type(screen.getByLabelText("Company name"), "Acme");
    await userEvent.type(
      screen.getByLabelText(/Company website/),
      "http://localhost",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save and research" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Website: Links to localhost/,
    );
    expect(screen.getByLabelText("Company name")).toHaveValue("Acme");
    expect(screen.getByLabelText(/Company website/)).toHaveValue(
      "http://localhost",
    );
  });

  it("tells the user when the daily research limit is reached", async () => {
    mockApi({
      ...base,
      "GET /api/companies": () => ({ json: [] }),
      "POST /api/companies": () =>
        apiError(
          429,
          "daily_cap",
          "You've reached today's research limit. Try again tomorrow.",
        ),
    });
    renderApp(<App />, "/companies");
    await userEvent.click(
      await screen.findByRole("button", { name: "Add a company" }),
    );
    await userEvent.type(screen.getByLabelText("Company name"), "Acme");
    await userEvent.click(
      screen.getByRole("button", { name: "Save and research" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /today's research limit/,
    );
  });

  it("reuses the idempotency key for a retry, and issues a new one when the form changes", async () => {
    const calls = mockApi({
      ...base,
      "GET /api/companies": () => ({ json: [] }),
      "POST /api/companies": () =>
        apiError(500, "boom", "Something went wrong."),
    });
    renderApp(<App />, "/companies");
    await userEvent.click(
      await screen.findByRole("button", { name: "Add a company" }),
    );
    await userEvent.type(screen.getByLabelText("Company name"), "Acme");
    const submit = screen.getByRole("button", { name: "Save and research" });
    await userEvent.click(submit);
    await screen.findByRole("alert");
    await userEvent.click(submit);
    await waitFor(() =>
      expect(calls.filter((c) => c.key === "POST /api/companies")).toHaveLength(
        2,
      ),
    );
    await userEvent.type(screen.getByLabelText("Company name"), " Inc");
    await userEvent.click(submit);
    await waitFor(() =>
      expect(calls.filter((c) => c.key === "POST /api/companies")).toHaveLength(
        3,
      ),
    );
    const keys = calls
      .filter((c) => c.key === "POST /api/companies")
      .map((c) => c.headers.get("idempotency-key"));
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("allows at most three extra links and drops blank ones", async () => {
    const calls = mockApi({
      ...base,
      "GET /api/companies": () => ({ json: [] }),
      "POST /api/companies": () => apiError(500, "x", "x"),
    });
    renderApp(<App />, "/companies");
    await userEvent.click(
      await screen.findByRole("button", { name: "Add a company" }),
    );
    await userEvent.type(screen.getByLabelText("Company name"), "Acme");
    const add = screen.getByRole("button", { name: "Add a link" });
    await userEvent.click(add);
    await userEvent.click(add);
    await userEvent.click(add);
    expect(add).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText("Extra link 1"),
      "https://acme.com/blog",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Remove extra link 3" }),
    );
    expect(add).toBeEnabled();
    await userEvent.click(
      screen.getByRole("button", { name: "Save and research" }),
    );
    await waitFor(() =>
      expect(calls.some((c) => c.key === "POST /api/companies")).toBe(true),
    );
    const post = calls.find((c) => c.key === "POST /api/companies")!;
    expect((post.body as { extra_links: string[] }).extra_links).toEqual([
      "https://acme.com/blog",
    ]);
  });

  it("limits what I already know to 2,000 characters", async () => {
    mockApi({ ...base, "GET /api/companies": () => ({ json: [] }) });
    renderApp(<App />, "/companies");
    await userEvent.click(
      await screen.findByRole("button", { name: "Add a company" }),
    );
    const known = screen.getByLabelText("What I already know");
    expect(known).toHaveAttribute("maxlength", "2000");
    const form = screen.getByRole("form", { name: "Company details" });
    expect(within(form).getByText("0 / 2,000")).toBeInTheDocument();
  });
});
