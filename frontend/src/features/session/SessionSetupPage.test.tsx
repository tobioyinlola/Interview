import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import { ME, mockApi, renderApp, stubSupportedBrowser } from "../../test-utils";

const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const notes = (content = "Led a launch.") => ({
  json: { role: "Product Manager", content, updated_at: "x" },
});
const base = (over: Record<string, () => object> = {}) => ({
  "GET /api/me": () => ({ json: ME }),
  "GET /api/notes": () => notes(),
  "GET /api/companies": () => ({
    json: [
      {
        id: "c1",
        name: "Acme",
        last_researched_at: ago(1),
        job_status: "ready",
      },
    ],
  }),
  ...over,
});
const open = () => renderApp(<App />, "/session/new");
const start = () => screen.getByRole("button", { name: "Start session" });

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

describe("SessionSetupPage", () => {
  it("keeps Start disabled until a CV is uploaded and a company is chosen", async () => {
    mockApi(base());
    open();
    await screen.findByRole("heading", { name: "Start an interview" });
    await screen.findByRole("option", { name: "Acme" });
    expect(start()).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText(/Which company/), "c1");
    expect(start()).toBeEnabled();
    expect(screen.queryByRole("checkbox")).toBeNull(); // consent was agreed at sign-up
  });

  it("adds the company interviewing you right on this page, and chooses it", async () => {
    const created = vi.fn(() => ({
      status: 201,
      json: {
        company: { id: "c-new", name: "Northwind", role: "PM", known_text: "" },
        job_id: "j1",
      },
    }));
    let list: {
      id: string;
      name: string;
      last_researched_at: string | null;
      job_status: string;
    }[] = [
      {
        id: "c1",
        name: "Acme",
        last_researched_at: ago(1),
        job_status: "ready",
      },
    ];
    mockApi(
      base({
        "GET /api/companies": () => ({ json: list }),
        "POST /api/companies": () => {
          list = [
            ...list,
            {
              id: "c-new",
              name: "Northwind",
              last_researched_at: null,
              job_status: "searching",
            },
          ];
          return created();
        },
      }),
    );
    open();
    await screen.findByRole("option", { name: "Acme" });
    await userEvent.click(
      screen.getByRole("button", { name: "Add a company" }),
    );
    await userEvent.type(screen.getByLabelText("Company name"), "Northwind");
    await userEvent.click(
      screen.getByRole("button", { name: "Add and research" }),
    );
    await waitFor(() => expect(created).toHaveBeenCalled());
    // chosen straight away, still on the same page
    await screen.findByRole("option", { name: "Northwind" });
    await waitFor(() =>
      expect(screen.getByLabelText(/Which company/)).toHaveValue("c-new"),
    );
    expect(
      screen.getByRole("heading", { name: "Start an interview" }),
    ).toBeVisible();
  });

  it("an explicit 'no company' choice counts", async () => {
    mockApi(base());
    open();
    await screen.findByRole("option", { name: "Acme" });
    await userEvent.selectOptions(
      screen.getByLabelText(/Which company/),
      "none",
    );
    expect(start()).toBeEnabled();
  });

  it("blocks Start and links to the CV page when none is uploaded", async () => {
    mockApi(base({ "GET /api/notes": () => notes("   ") }));
    open();
    await screen.findByRole("option", { name: "Acme" });
    await userEvent.selectOptions(
      screen.getByLabelText(/Which company/),
      "none",
    );
    expect(start()).toBeDisabled();
    expect(
      screen.getByRole("link", { name: "Upload your CV" }),
    ).toHaveAttribute("href", "/settings/cv");
  });

  it("tells the person the practice-only rule and where their data goes, without asking for consent again", async () => {
    mockApi(base());
    open();
    expect(
      await screen.findByText(/must know this assistant is listening/),
    ).toBeInTheDocument();
    expect(screen.getByText(/mock interviews only/i)).toBeInTheDocument();
    expect(screen.getByText(/follow local law/i)).toBeInTheDocument();
    expect(screen.getByText(/processed by OpenAI/)).toBeInTheDocument();
  });

  it("creates the session with the company and an idempotency key, and no consent box, then opens the live page", async () => {
    const calls = mockApi(
      base({
        "POST /api/sessions": () => ({
          status: 201,
          json: {
            session_id: "s-123",
            status: "active",
            consent_confirmed_at: "x",
            audio_token: "t",
            sample_rate: 24000,
          },
        }),
      }),
    );
    open();
    await screen.findByRole("option", { name: "Acme" });
    await userEvent.selectOptions(screen.getByLabelText(/Which company/), "c1");
    await userEvent.click(start());

    expect(
      await screen.findByRole("heading", { name: "Capture" }),
    ).toBeInTheDocument();
    const post = calls.find((c) => c.key === "POST /api/sessions")!;
    expect(post.body).toEqual({
      company_id: "c1",
      role: "Product Manager",
    });
    expect(post.headers.get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(post.headers.get("x-requested-with")).toBe("meet-practice");
  });

  it("sends company_id null for 'no company'", async () => {
    const calls = mockApi(
      base({
        "POST /api/sessions": () => ({
          status: 201,
          json: {
            session_id: "s",
            status: "active",
            consent_confirmed_at: "x",
            sample_rate: 24000,
          },
        }),
      }),
    );
    open();
    await screen.findByRole("option", { name: "Acme" });
    await userEvent.selectOptions(
      screen.getByLabelText(/Which company/),
      "none",
    );
    await userEvent.click(start());
    await waitFor(() =>
      expect(calls.some((c) => c.key === "POST /api/sessions")).toBe(true),
    );
    expect(
      calls.find((c) => c.key === "POST /api/sessions")!.body,
    ).toMatchObject({
      company_id: null,
    });
  });

  it("shows a server refusal and issues a new idempotency key for the retry", async () => {
    const calls = mockApi(
      base({
        "POST /api/sessions": () => ({
          status: 404,
          json: {
            error: {
              code: "company_not_found",
              message: "Company not found.",
              request_id: "r",
            },
          },
        }),
      }),
    );
    open();
    await screen.findByRole("option", { name: "Acme" });
    await userEvent.selectOptions(screen.getByLabelText(/Which company/), "c1");
    await userEvent.click(start());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Company not found.",
    );
    await userEvent.click(start());
    await waitFor(() =>
      expect(calls.filter((c) => c.key === "POST /api/sessions")).toHaveLength(
        2,
      ),
    );
    const keys = calls
      .filter((c) => c.key === "POST /api/sessions")
      .map((c) => c.headers.get("idempotency-key"));
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("tells the user when a company is still researching, has no brief, or is stale", async () => {
    mockApi(
      base({
        "GET /api/companies": () => ({
          json: [
            {
              id: "a",
              name: "Busy",
              last_researched_at: null,
              job_status: "searching",
            },
            {
              id: "b",
              name: "Bare",
              last_researched_at: null,
              job_status: null,
            },
            {
              id: "c",
              name: "Old",
              last_researched_at: ago(10),
              job_status: "ready",
            },
          ],
        }),
      }),
    );
    open();
    await screen.findByRole("option", { name: "Busy" });
    const pick = screen.getByLabelText(/Which company/);
    await userEvent.selectOptions(pick, "a");
    expect(screen.getByText(/still being researched/)).toBeInTheDocument();
    await userEvent.selectOptions(pick, "b");
    expect(screen.getByText(/No brief yet/)).toBeInTheDocument();
    await userEvent.selectOptions(pick, "c");
    expect(screen.getByText(/10 days old/)).toBeInTheDocument();
  });
});

describe("SessionSetupPage: session credits", () => {
  const credits = (over: Record<string, unknown> = {}) => ({
    sessions_available: 1,
    trial_available: true,
    referral_credits_available: 0,
    paid_credits_available: 0,
    payments_enabled: false,
    referral_code: "abc23xyz",
    referral_link: "https://app.example.com/signup?ref=abc23xyz",
    referrals_qualified: 0,
    referrals_per_reward: 3,
    referrals_to_next_reward: 3,
    rewards_earned: 0,
    rewards_redeemable: 0,
    ...over,
  });

  it("says a session uses the free trial", async () => {
    mockApi(base({ "GET /api/billing": () => ({ json: credits() }) }));
    open();
    await screen.findByRole("option", { name: "Acme" });
    expect(
      await screen.findByText(
        /This uses one of your 1 available session \(your free trial\)/,
      ),
    ).toBeInTheDocument();
  });

  it("does not block Start while sessions are free for testing, even with none counted", async () => {
    mockApi(
      base({
        "GET /api/billing": () => ({
          json: credits({
            sessions_available: 0,
            trial_available: false,
            sessions_free: true,
          }),
        }),
      }),
    );
    open();
    await screen.findByRole("option", { name: "Acme" });
    await userEvent.selectOptions(screen.getByLabelText(/Which company/), "c1");
    expect(
      await screen.findByText(/Sessions are free while we test/),
    ).toBeInTheDocument();
    expect(screen.queryByText("You have used your free session")).toBeNull();
    expect(start()).toBeEnabled();
  });

  it("blocks Start once the free session is used, and points to inviting friends", async () => {
    mockApi(
      base({
        "GET /api/billing": () => ({
          json: credits({ sessions_available: 0, trial_available: false }),
        }),
      }),
    );
    open();
    await screen.findByRole("option", { name: "Acme" });
    await userEvent.selectOptions(screen.getByLabelText(/Which company/), "c1");
    expect(
      await screen.findByText("You have used your free session"),
    ).toBeInTheDocument();
    expect(start()).toBeDisabled();
    expect(screen.getByText(/pay per session/)).toBeInTheDocument();
    const notice = within(
      screen.getByRole("region", { name: "You have used your free session" }),
    );
    expect(
      notice.getByRole("link", { name: "Invite friends" }),
    ).toHaveAttribute("href", "/referrals");
  });

  it("does not block while the count is loading or if it cannot be loaded; the server decides", async () => {
    mockApi(base()); // no billing route: the request fails
    open();
    await screen.findByRole("option", { name: "Acme" });
    await userEvent.selectOptions(screen.getByLabelText(/Which company/), "c1");
    expect(start()).toBeEnabled();
  });

  it("shows the server's message if it says payment is needed anyway", async () => {
    mockApi(
      base({
        "GET /api/billing": () => ({ json: credits() }),
        "POST /api/sessions": () => ({
          status: 402,
          json: {
            error: {
              code: "payment_required",
              message: "You have used your free session.",
              request_id: "r",
            },
          },
        }),
      }),
    );
    open();
    await screen.findByRole("option", { name: "Acme" });
    await userEvent.selectOptions(screen.getByLabelText(/Which company/), "c1");
    await userEvent.click(start());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You have used your free session.",
    );
  });
});
