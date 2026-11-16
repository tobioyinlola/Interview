import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import { ME, mockApi, renderApp, stubSupportedBrowser } from "../../test-utils";
import { COMPANY, SOURCES, apiError, detail, job, src } from "./fixtures";

vi.mock("../../api/polling", async (orig) => ({
  ...(await orig<typeof import("../../api/polling")>()),
  POLL_MS: 20,
}));

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

const me = { "GET /api/me": () => ({ json: ME }) };
const open = () => renderApp(<App />, "/companies/c1");

describe("CompanyPage: research progress", () => {
  it("shows progress, then the brief, without a reload", async () => {
    const stages = [
      detail({ brief: null, sources: [], job: job("queued") }),
      detail({
        brief: null,
        sources: [],
        job: job("reading_pages", { step_detail: "Reading https://acme.com/" }),
      }),
      detail({ brief: null, sources: SOURCES, job: job("writing") }),
      detail(),
    ];
    let n = 0;
    mockApi({
      ...me,
      "GET /api/companies/c1": () => ({
        json: stages[Math.min(n++, stages.length - 1)],
      }),
    });
    open();

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/Queued/);
    await waitFor(() =>
      expect(screen.getByText("Reading pages")).toHaveAttribute(
        "aria-current",
        "step",
      ),
    );
    expect(screen.getByText("Reading https://acme.com/")).toBeInTheDocument();
    expect(screen.getByText(/You can leave this page/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Research/ })).toBeDisabled(); // one job at a time

    expect(
      await screen.findByText("Acme builds payment software."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Brief ready/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Research again" }),
    ).toBeEnabled();
    expect(screen.queryByText(/You can leave this page/)).toBeNull();
  });

  it("stops polling once research has finished", async () => {
    let calls = 0;
    mockApi({
      ...me,
      "GET /api/companies/c1": () => {
        calls++;
        return { json: detail() };
      },
    });
    open();
    await screen.findByText(/Brief ready/);
    const settled = calls;
    await new Promise((r) => setTimeout(r, 120));
    expect(calls).toBe(settled);
  });

  it("explains a failed job and offers per-link recovery", async () => {
    mockApi({
      ...me,
      "GET /api/companies/c1": () => ({
        json: detail({
          brief: null,
          job: job("failed", {
            error:
              "No readable sources were found. Paste text from the company's pages.",
          }),
          sources: [
            src({
              id: "w",
              kind: "website",
              status: "blocked",
              reason: "The site blocked the request.",
            }),
            src({
              id: "j",
              kind: "job_posting",
              url: "https://acme.com/jobs",
              title: "",
              status: "login_required",
              reason: "The page needs you to sign in.",
            }),
            src({ id: "ok", kind: "extra_link", status: "ok" }),
          ],
        }),
      }),
    });
    open();
    expect(await screen.findByText(/Research didn't finish/)).toHaveTextContent(
      /No readable sources/,
    );
    expect(
      screen.getByText("The site blocked the request."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The page needs you to sign in."),
    ).toBeInTheDocument();
    expect(screen.getByText("Needs sign-in")).toBeInTheDocument();
    // only unreadable sources offer "Paste its text"
    expect(
      screen.getAllByRole("button", { name: "Paste its text" }),
    ).toHaveLength(2);
    expect(
      screen.getByText(/paste text for any page that could not be read/i),
    ).toBeInTheDocument();
  });

  it("warns when the brief is more than 7 days old", async () => {
    mockApi({
      ...me,
      "GET /api/companies/c1": () => ({
        json: detail({
          company: {
            ...COMPANY,
            last_researched_at: new Date(
              Date.now() - 10 * 86_400_000,
            ).toISOString(),
          },
        }),
      }),
    });
    open();
    expect(await screen.findByText(/Researched 10 days ago/)).toHaveTextContent(
      /consider researching again/,
    );
  });
});

describe("CompanyPage: pasting text for a page that could not be read", () => {
  const blocked = detail({
    brief: null,
    job: job("failed", { error: "No readable sources were found." }),
    sources: [
      src({
        id: "w",
        status: "blocked",
        reason: "The site blocked the request.",
        title: "Acme site",
      }),
    ],
  });

  it("sends the pasted text and refreshes", async () => {
    let pasted = false;
    const calls = mockApi({
      ...me,
      "GET /api/companies/c1": () => ({
        json: pasted
          ? detail({
              ...blocked,
              sources: [
                ...blocked.sources,
                src({ id: "p", kind: "pasted", title: "Careers", url: null }),
              ],
            })
          : blocked,
      }),
      "POST /api/companies/c1/sources/paste": () => {
        pasted = true;
        return {
          status: 201,
          json: src({ id: "p", kind: "pasted", title: "Careers", url: null }),
        };
      },
    });
    open();
    await userEvent.click(
      await screen.findByRole("button", { name: "Paste its text" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Paste text from the page",
    });
    expect(within(dialog).getByLabelText("Name for this text")).toHaveValue(
      "Acme site",
    );
    expect(
      within(dialog).getByRole("button", { name: "Save text" }),
    ).toBeDisabled(); // needs text
    expect(within(dialog).getByLabelText("Text")).toHaveFocus();
    await userEvent.type(
      within(dialog).getByLabelText("Text"),
      "We hire Rust engineers.",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Save text" }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const post = calls.find(
      (c) => c.key === "POST /api/companies/c1/sources/paste",
    )!;
    expect(post.body).toEqual({
      title: "Acme site",
      text: "We hire Rust engineers.",
    });
    expect(post.headers.get("x-requested-with")).toBe("meet-practice");
    expect(await screen.findByText("Careers")).toBeInTheDocument();
    expect(screen.getAllByText("Pasted by you").length).toBeGreaterThan(0);
  });

  it("closes on Escape and Cancel without saving", async () => {
    const calls = mockApi({
      ...me,
      "GET /api/companies/c1": () => ({ json: blocked }),
    });
    open();
    await userEvent.click(
      await screen.findByRole("button", { name: "Paste text" }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Paste text" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls.some((c) => c.key.startsWith("POST"))).toBe(false);
  });

  it("shows the server's message if saving fails", async () => {
    mockApi({
      ...me,
      "GET /api/companies/c1": () => ({ json: blocked }),
      "POST /api/companies/c1/sources/paste": () =>
        apiError(422, "invalid_request", "Invalid fields: text"),
    });
    open();
    await userEvent.click(
      await screen.findByRole("button", { name: "Paste text" }),
    );
    await userEvent.type(screen.getByLabelText("Text"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Save text" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Invalid fields/,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument(); // stays open, text kept
    expect(screen.getByLabelText("Text")).toHaveValue("x");
  });
});

describe("CompanyPage: actions", () => {
  it("researches again", async () => {
    let running = false;
    const calls = mockApi({
      ...me,
      "GET /api/companies/c1": () => ({
        json: running ? detail({ job: job("queued") }) : detail(),
      }),
      "POST /api/companies/c1/research": () => {
        running = true;
        return { status: 202, json: { job_id: "j2" } };
      },
    });
    open();
    await userEvent.click(
      await screen.findByRole("button", { name: "Research again" }),
    );
    expect(await screen.findByText("Queued")).toBeInTheDocument();
    expect(
      calls.filter((c) => c.key === "POST /api/companies/c1/research"),
    ).toHaveLength(1);
  });

  it("shows the daily limit message when researching again is refused", async () => {
    mockApi({
      ...me,
      "GET /api/companies/c1": () => ({ json: detail() }),
      "POST /api/companies/c1/research": () =>
        apiError(
          429,
          "daily_cap",
          "You've reached today's research limit. Try again tomorrow.",
        ),
    });
    open();
    await userEvent.click(
      await screen.findByRole("button", { name: "Research again" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /today's research limit/,
    );
  });

  it("edits details and says the brief needs a re-run", async () => {
    const calls = mockApi({
      ...me,
      "GET /api/companies/c1": () => ({ json: detail() }),
      "PUT /api/companies/c1": ({ body }) => ({
        json: { ...COMPANY, ...(body as object) },
      }),
    });
    open();
    await userEvent.click(
      await screen.findByRole("button", { name: "Edit company details" }),
    );
    const role = screen.getByLabelText("Role");
    expect(role).toHaveValue("Backend Engineer");
    await userEvent.clear(role);
    await userEvent.type(role, "Staff Engineer");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText(/Press/)).toHaveTextContent(
      /Research again/,
    );
    const put = calls.find((c) => c.key === "PUT /api/companies/c1")!;
    expect(put.body).toMatchObject({
      name: "Acme",
      role: "Staff Engineer",
      website_url: "https://acme.com/",
    });
    expect(calls.some((c) => c.key === "POST /api/companies/c1/research")).toBe(
      false,
    );
  });

  it("shows a rejected link when editing", async () => {
    mockApi({
      ...me,
      "GET /api/companies/c1": () => ({ json: detail() }),
      "PUT /api/companies/c1": () =>
        apiError(
          422,
          "invalid_url",
          "Website: Links to private or local network addresses are not allowed.",
        ),
    });
    open();
    await userEvent.click(
      await screen.findByRole("button", { name: "Edit company details" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /private or local network/,
    );
    expect(
      screen.getByRole("button", { name: "Save changes" }),
    ).toBeInTheDocument(); // still editing
  });

  it("removes a source", async () => {
    const calls = mockApi({
      ...me,
      "GET /api/companies/c1": () => ({ json: detail() }),
      "DELETE /api/companies/c1/sources/s2": () => ({ json: { status: "ok" } }),
    });
    open();
    await userEvent.click(
      await screen.findByRole("button", { name: "Remove source 2" }),
    );
    await waitFor(() =>
      expect(
        calls.some((c) => c.key === "DELETE /api/companies/c1/sources/s2"),
      ).toBe(true),
    );
  });

  it("asks before deleting, then deletes and returns to the list", async () => {
    let deleted = false;
    const calls = mockApi({
      ...me,
      "GET /api/companies/c1": () => ({ json: detail() }),
      "GET /api/companies": () => ({ json: [] }),
      "DELETE /api/companies/c1": () => {
        deleted = true;
        return { json: { status: "ok" } };
      },
    });
    open();
    await userEvent.click(
      await screen.findByRole("button", { name: "Delete this company" }),
    );
    expect(calls.some((c) => c.key === "DELETE /api/companies/c1")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Delete this company" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(
      await screen.findByRole("heading", { name: "Companies" }),
    ).toBeInTheDocument();
    expect(deleted).toBe(true);
  });

  it("handles a company that does not exist", async () => {
    mockApi({
      ...me,
      "GET /api/companies/c1": () =>
        apiError(404, "company_not_found", "Company not found."),
    });
    open();
    expect(await screen.findByText(/was not found/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to companies" }),
    ).toBeInTheDocument();
  });
});
