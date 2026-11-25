import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import { PLAN } from "../onboarding/content";
import { firstName } from "./DashboardPage";
import { greeting } from "../account/greeting";
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
    expect(c.getAllByText("Not done:").length).toBeGreaterThanOrEqual(1); // the CV
    expect(c.getByRole("link", { name: "Upload your CV" })).toHaveAttribute(
      "href",
      "/settings/cv",
    );
    // no company side: the interview page is where a company is chosen or added
    expect(screen.queryByText("Who is interviewing you?")).toBeNull();
    expect(screen.queryByRole("region", { name: "Companies" })).toBeNull();
    // one clear path: no chart or zero tiles yet
    await waitFor(() =>
      expect(screen.queryByText("Interview summary")).toBeNull(),
    );
  });

  it("ticks the CV and the browser", async () => {
    mockApi(base());
    renderApp(<App />, "/");
    const c = within(await card());
    expect(c.getByText(/CV uploaded/)).toBeInTheDocument();
    await waitFor(() =>
      expect(c.queryByRole("link", { name: "Upload your CV" })).toBeNull(),
    );
    expect(c.getByText("Browser can share tab audio")).toBeInTheDocument();
    expect(c.queryByText(/Partner consent/)).toBeNull(); // agreed at sign-up, not a step
    expect(c.getByRole("link", { name: "Start interview" })).toHaveAttribute(
      "href",
      "/session/new",
    );
  });

  it("has quick actions: Auto-Apply, Interview, History and Startup", async () => {
    mockApi(
      base({
        "GET /api/me": () => ({
          json: { ...ME, autoapply: true, startup_outreach: true },
        }),
        "GET /api/autoapply/dashboard": () => ({ status: 404, json: {} }),
      }),
    );
    renderApp(<App />, "/");
    const quick = within(
      await screen.findByRole("region", { name: "Quick actions" }),
    );
    for (const [name, href] of [
      ["Auto-Apply", "/auto-apply"],
      ["Interview", "/session/new"],
      ["History", "/sessions"],
      ["Startup", "/startups"],
    ])
      expect(quick.getByRole("link", { name })).toHaveAttribute("href", href);
    expect(quick.queryByRole("link", { name: "Companies" })).toBeNull();
  });

  it("shows interviews and applications together in Recent, newest first, with their links", async () => {
    mockApi(
      base({
        "GET /api/me": () => ({ json: { ...ME, autoapply: true } }),
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
        "GET /api/autoapply/dashboard": () => ({
          json: {
            demo: false,
            state: "running",
            primary: { kind: "preferences", label: "x", href: "/auto-apply" },
            campaign: { state: "active", day: 2, days_total: 30 },
            paused: false,
            mailbox: { connected: false, address: null, status: "none" },
            counts: {},
            channels: {},
            needs_input: [],
            open_invites: [],
            next_interview: null,
            review_count: 0,
            sources: [],
            startup_recent: [],
            usage: null,
            last_run: null,
            recent: [
              {
                id: "a1",
                status: "submitted",
                channel: "form",
                score: 1,
                needs_input: [],
                skip_reason: null,
                recruiting_stage: null,
                created_at: "2026-11-18T09:00:00Z",
                updated_at: "2026-11-18T09:00:00Z",
                posting: {
                  id: "p1",
                  company: "Acme",
                  title: "Product Manager",
                  region: null,
                  arrangement: null,
                  application_url: "https://jobs.example/pm",
                  source: "x",
                },
              },
            ],
          },
        }),
      }),
    );
    renderApp(<App />, "/");
    const recent = within(
      await screen.findByRole("region", { name: "Recent" }),
    );
    const app = await recent.findByRole("link", { name: /^Product Manager/ });
    expect(app).toHaveAttribute("href", "/auto-apply/applications/a1");
    expect(
      recent.getByRole("link", { name: "Open the job: Product Manager" }),
    ).toHaveAttribute("href", "https://jobs.example/pm");
    const interview = recent.getByRole("link", { name: /^Beta/ });
    expect(interview).toHaveAttribute("href", "/sessions/s1");
    // the application is newer, so it comes first
    const links = recent.getAllByRole("link").map((l) => l.textContent ?? "");
    expect(links.findIndex((t) => /^Product Manager/.test(t))).toBeLessThan(
      links.findIndex((t) => /^Beta/.test(t)),
    );
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

  it("greets the person by first name for the time of day, with a smile", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 10, 24, 9, 0) });
    try {
      mockApi(base({ "GET /api/me": () => ({ json: asJordan }) }));
      renderApp(<App />, "/dashboard");
      const hello = await screen.findByRole("heading", {
        name: /^Good morning, Jordan/,
      });
      expect(hello).toHaveTextContent("Good morning, Jordan 😊");
      expect(hello.querySelector("[aria-hidden=true]")).toHaveTextContent("😊");
      expect(screen.queryByText(/^Hello/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [8, "Good morning"],
    [13, "Good afternoon"],
    [20, "Good evening"],
  ])("at %i o'clock it says %s", (hour, words) => {
    expect(greeting(hour)).toBe(words);
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
    const hello = await screen.findByRole("heading", {
      name: /^Good (morning|afternoon|evening)/,
    });
    expect(hello).toHaveTextContent(
      /^Good (morning|afternoon|evening), there 😊$/,
    );
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
    await screen.findByText(/^Good (morning|afternoon|evening), Jordan/);
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
