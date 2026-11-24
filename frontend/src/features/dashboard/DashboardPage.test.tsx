import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import { PLAN } from "../onboarding/content";
import { firstName } from "./DashboardPage";
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
    expect(c.getAllByText("Not done:").length).toBeGreaterThanOrEqual(2); // CV and brief
    expect(c.getByRole("link", { name: "Upload your CV" })).toHaveAttribute(
      "href",
      "/settings/cv",
    );
    expect(c.getByRole("link", { name: "Add a company" })).toHaveAttribute(
      "href",
      "/companies",
    );
    expect(await screen.findByText("No companies yet.")).toBeInTheDocument();
    expect(await screen.findByText("No sessions yet.")).toBeInTheDocument();
  });

  it("ticks the CV, a fresh brief and the browser", async () => {
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
    expect(c.getByText(/CV uploaded/)).toBeInTheDocument();
    expect(c.queryByRole("link", { name: "Upload your CV" })).toBeNull();
    expect(c.getByText("Browser can share tab audio")).toBeInTheDocument();
    expect(c.queryByText(/Partner consent/)).toBeNull(); // agreed at sign-up, not a step
    expect(c.getByRole("link", { name: "Start interview" })).toHaveAttribute(
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

  it("summarises the user's own sessions in the stat cards", async () => {
    const item = (id: string, q: number, secs: number) => ({
      id,
      started_at: "2026-11-16T10:00:00Z",
      ended_at: "x",
      duration_seconds: secs,
      status: "ended",
      company_id: null,
      company_name: null,
      question_count: q,
    });
    mockApi(
      base({
        "GET /api/sessions": () => ({
          json: {
            items: [item("a", 3, 600), item("b", 4, 1200)],
            next_cursor: null,
          },
        }),
      }),
    );
    renderApp(<App />, "/");
    const stat = async (hint: string, value: string) =>
      waitFor(() =>
        expect(
          within(screen.getByText(hint).parentElement!).getByText(value),
        ).toBeInTheDocument(),
      );
    await stat("Interviews", "2");
    await stat("Questions answered", "7");
    await stat("Across your sessions", "30 min");
  });

  it("shows zeros, not placeholders, for a new user", async () => {
    mockApi(base());
    renderApp(<App />, "/");
    const sessions = (await screen.findByText("Interviews")).parentElement!;
    expect(within(sessions).getByText("0")).toBeInTheDocument();
    expect(screen.getByText(/after two sessions/i)).toBeInTheDocument();
  });
});

describe("DashboardPage: greeting and focus", () => {
  const asJordan = {
    ...ME,
    full_name: "Jordan Reyes",
    onboarded: true,
    onboarding: {
      goal: "new_job",
      level: "senior",
      timeline: "this_week",
      focus: ["structure", "company"],
    },
  };

  it("greets the person by first name with a wave", async () => {
    mockApi(base({ "GET /api/me": () => ({ json: asJordan }) }));
    renderApp(<App />, "/dashboard");
    const hello = await screen.findByText(/^Hello, Jordan/);
    expect(hello).toHaveTextContent("Hello, Jordan 👋");
    expect(hello.querySelector("[aria-hidden=true]")).toHaveTextContent("👋");
    expect(screen.queryByText(/Good (morning|afternoon|evening)/)).toBeNull();
  });

  it("just says hello when there is no name yet, never guessing one from the email", async () => {
    mockApi(
      base({
        "GET /api/me": () => ({
          json: { ...ME, onboarded: true, full_name: null },
        }),
      }),
    );
    renderApp(<App />, "/dashboard");
    const hello = await screen.findByText(/^Hello/);
    expect(hello).toHaveTextContent(/^Hello 👋$/);
    expect(hello.textContent).not.toMatch(/me@|example/i);
  });

  it.each([
    ["Jordan Reyes", "Jordan"],
    ["  ada   lovelace ", "ada"],
    ["Madonna", "Madonna"],
    ["O\u2019Neil Smith", "O\u2019Neil"],
    ["李小龍", "李小龍"],
    [null, ""],
    ["", ""],
  ])("takes the first word of %j as the first name", (full, first) => {
    expect(firstName(full)).toBe(first);
  });

  it("shows the chosen focus areas and advice for the timeline, with a way to change them", async () => {
    mockApi(base({ "GET /api/me": () => ({ json: asJordan }) }));
    renderApp(<App />, "/dashboard");
    const card = within(
      await screen.findByRole("region", { name: "Your focus" }),
    );
    expect(card.getByText(/Structuring my answers/)).toBeInTheDocument();
    expect(card.getByText(/Company questions/)).toBeInTheDocument();
    expect(card.getByText(PLAN.this_week)).toBeInTheDocument();
    expect(card.getByRole("link", { name: "Update" })).toHaveAttribute(
      "href",
      "/onboarding",
    );
  });

  it("has no focus card for someone who skipped onboarding", async () => {
    mockApi(
      base({
        "GET /api/me": () => ({ json: { ...asJordan, onboarding: null } }),
      }),
    );
    renderApp(<App />, "/dashboard");
    await screen.findByText(/^Hello, Jordan/);
    expect(screen.queryByRole("region", { name: "Your focus" })).toBeNull();
  });
});

describe("DashboardPage: sessions card", () => {
  const credits = (over: Record<string, unknown> = {}) => ({
    sessions_available: 1,
    trial_available: true,
    referral_credits_available: 0,
    paid_credits_available: 0,
    payments_enabled: false,
    referral_code: "abc23xyz",
    referral_link: "x",
    referrals_qualified: 1,
    referrals_per_reward: 3,
    referrals_to_next_reward: 2,
    rewards_earned: 0,
    rewards_redeemable: 0,
    ...over,
  });

  it("shows the sessions available and progress toward a free one", async () => {
    mockApi(base({ "GET /api/billing": () => ({ json: credits() }) }));
    renderApp(<App />, "/dashboard");
    const card = within(
      await screen.findByRole("region", { name: "Your sessions" }),
    );
    expect(await card.findByText(/session available/)).toBeInTheDocument();
    expect(card.getByText(/1 of 3 friends invited/)).toBeInTheDocument();
    expect(card.getByRole("link", { name: "Invite friends" })).toHaveAttribute(
      "href",
      "/referrals",
    );
  });

  it("offers to redeem an earned session, and says payments are coming when none are left", async () => {
    mockApi(
      base({
        "GET /api/billing": () => ({
          json: credits({
            sessions_available: 0,
            trial_available: false,
            rewards_earned: 1,
            rewards_redeemable: 1,
          }),
        }),
      }),
    );
    renderApp(<App />, "/dashboard");
    const card = within(
      await screen.findByRole("region", { name: "Your sessions" }),
    );
    expect(
      await card.findByRole("link", { name: "Redeem your free session" }),
    ).toBeInTheDocument();
    expect(card.getByText(/Payments are coming soon/)).toBeInTheDocument();
  });
});

describe("DashboardPage: who is interviewing you", () => {
  const created = {
    status: 201,
    json: {
      company: { id: "c-new", name: "Northwind", role: "PM", known_text: "" },
      job_id: "j1",
    },
  };
  const none = (over: Record<string, () => object> = {}) =>
    base({
      "GET /api/companies": () => ({ json: [] }),
      "GET /api/notes": () => ({
        json: {
          role: "Product Manager",
          content: "Led a launch.",
          updated_at: "x",
        },
      }),
      "GET /api/billing": () => ({ status: 404, json: {} }),
      ...over,
    });

  it("asks which company is interviewing you, not where you have worked", async () => {
    mockApi(none());
    renderApp(<App />, "/dashboard");
    const card = within(
      await screen.findByRole("region", { name: "Who is interviewing you?" }),
    );
    expect(
      card.getByText(/not an employer you have worked for/),
    ).toBeInTheDocument();
    expect(card.getByLabelText("Company interviewing you")).toBeInTheDocument();
    expect(card.getByLabelText("Role you're interviewing for")).toHaveValue(
      "Product Manager",
    );
  });

  it("starts the research straight away and opens the company page", async () => {
    const calls = mockApi(none({ "POST /api/companies": () => created }));
    renderApp(<App />, "/dashboard");
    const card = within(
      await screen.findByRole("region", { name: "Who is interviewing you?" }),
    );
    const go = card.getByRole("button", { name: "Research this company" });
    expect(go).toBeDisabled(); // a name is needed
    await userEvent.type(
      card.getByLabelText("Company interviewing you"),
      "  Northwind  ",
    );
    await userEvent.type(
      card.getByLabelText(/Company website/),
      "https://northwind.example",
    );
    await userEvent.click(go);
    await waitFor(() =>
      expect(calls.some((c) => c.key === "POST /api/companies")).toBe(true),
    );
    const post = calls.find((c) => c.key === "POST /api/companies")!;
    expect(post.body).toMatchObject({
      name: "Northwind",
      website_url: "https://northwind.example",
      role: "Product Manager",
    });
    expect(post.headers.get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("is not shown once a company has been added", async () => {
    mockApi(
      none({
        "GET /api/companies": () => ({
          json: [
            {
              id: "c1",
              name: "Acme",
              last_researched_at: null,
              job_status: "searching",
            },
          ],
        }),
      }),
    );
    renderApp(<App />, "/dashboard");
    await screen.findByRole("region", { name: "Readiness" });
    expect(
      screen.queryByRole("region", { name: "Who is interviewing you?" }),
    ).toBeNull();
  });

  it("shows the server's message and keeps what was typed, with a fresh key for the retry", async () => {
    const calls = mockApi(
      none({
        "POST /api/companies": () => ({
          status: 422,
          json: {
            error: {
              code: "bad_url",
              message: "That link is not allowed.",
              request_id: "r",
            },
          },
        }),
      }),
    );
    renderApp(<App />, "/dashboard");
    const card = within(
      await screen.findByRole("region", { name: "Who is interviewing you?" }),
    );
    await userEvent.type(
      card.getByLabelText("Company interviewing you"),
      "Northwind",
    );
    await userEvent.click(
      card.getByRole("button", { name: "Research this company" }),
    );
    expect(await card.findByRole("alert")).toHaveTextContent(
      "That link is not allowed.",
    );
    expect(card.getByLabelText("Company interviewing you")).toHaveValue(
      "Northwind",
    );
    await userEvent.click(
      card.getByRole("button", { name: "Research this company" }),
    );
    await waitFor(() =>
      expect(calls.filter((c) => c.key === "POST /api/companies")).toHaveLength(
        2,
      ),
    );
    const [a, b] = calls.filter((c) => c.key === "POST /api/companies");
    expect(a.headers.get("idempotency-key")).not.toBe(
      b.headers.get("idempotency-key"),
    );
  });
});

describe("inside the desktop app", () => {
  afterEach(() => {
    delete window.interviewMeetDesktop;
  });

  it("says the app listens to the computer's audio, not a browser tab", async () => {
    window.interviewMeetDesktop = {
      isDesktop: true,
      platform: "darwin",
      systemAudio: true,
    };
    mockApi(base());
    renderApp(<App />, "/dashboard");
    expect(
      await screen.findByText("App can listen to your computer's audio"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Browser can share tab audio")).toBeNull();
  });
});

describe("inside the phone app", () => {
  afterEach(() => {
    delete window.Capacitor;
  });

  it("shows the phone home instead of the live-interview dashboard", async () => {
    window.Capacitor = { isNativePlatform: () => true };
    mockApi(base());
    renderApp(<App />, "/dashboard");
    expect(
      await screen.findByRole("heading", { name: "Home" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Readiness" })).toBeNull();
    expect(screen.queryByText("Interview summary")).toBeNull();
  });

  it("lets the phone app start an interview, listening through the microphone", async () => {
    window.Capacitor = { isNativePlatform: () => true };
    mockApi(base());
    renderApp(<App />, "/session/new");
    expect(
      await screen.findByRole("heading", { name: "Start an interview" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/listens through its microphone/),
    ).toBeInTheDocument();
  });
});
