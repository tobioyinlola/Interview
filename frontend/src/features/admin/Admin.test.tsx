import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import { mockApi, renderApp, stubSupportedBrowser } from "../../test-utils";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

const base = (routes: Record<string, () => object> = {}) =>
  mockApi({
    "GET /api/admin/auth/me": () => ({
      json: { email: "boss@example.com", full_name: null },
    }),
    "GET /api/billing": () => ({ status: 404, json: {} }),
    ...routes,
  });

const overview = {
  days: 30,
  total_users: 120,
  new_users: 40,
  new_users_prev: 20,
  dau: 9,
  wau: 30,
  mau: 60,
  sessions: 55,
  sessions_prev: 100,
  avg_session_seconds: 725,
  avg_questions_per_session: 4.2,
  funnel: [
    {
      key: "signed_up",
      label: "Signed up",
      users: 40,
      of_signups_pct: 100,
      from_previous_pct: null,
    },
    {
      key: "onboarded",
      label: "Finished onboarding",
      users: 30,
      of_signups_pct: 75,
      from_previous_pct: 75,
    },
    {
      key: "session",
      label: "Ran a first interview",
      users: 10,
      of_signups_pct: 25,
      from_previous_pct: 33.3,
    },
  ],
  series: [
    { day: "2026-11-19", signups: 2, sessions: 1, active_users: 3 },
    { day: "2026-11-20", signups: 5, sessions: 4, active_users: 6 },
  ],
  health: {
    research_failed_24h: 2,
    scoring_failed_24h: 0,
    emails_failed_24h: 0,
    blocked_no_credit_7d: 7,
    wrong_passwords_24h: 3,
  },
  referrals_counted: 12,
  referrals_held: 3,
  rewards_redeemed: 2,
};

describe("admin console: access", () => {
  it("sends anyone without a staff sign-in to the staff sign-in page", async () => {
    mockApi({
      "GET /api/admin/auth/me": () => ({
        status: 401,
        json: {
          error: {
            code: "staff_not_authenticated",
            message: "x",
            request_id: "r",
          },
        },
      }),
    });
    renderApp(<App />, "/admin/users");
    expect(
      await screen.findByRole("heading", { name: "Staff sign in" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "Admin sections" }),
    ).toBeNull();
  });

  it("is a separate place from the app: its own sidebar, staff name and sign out", async () => {
    base({ "GET /api/admin/overview": () => ({ json: overview }) });
    renderApp(<App />, "/admin");
    expect(
      await screen.findByRole("navigation", { name: "Admin sections" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Back office").length).toBeGreaterThan(0);
    expect(screen.getByText("boss@example.com")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull(); // no customer sidebar
  });

  it("has a sidebar link for every section, with the current one marked", async () => {
    base({ "GET /api/admin/overview": () => ({ json: overview }) });
    renderApp(<App />, "/admin");
    const tabs = within(
      await screen.findByRole("navigation", { name: "Admin sections" }),
    );
    for (const name of [
      "Overview",
      "Users",
      "Activity log",
      "Referrals",
      "Marketing",
      "Quality",
      "Emails",
      "Cost",
    ])
      expect(tabs.getByRole("link", { name })).toBeInTheDocument();
    expect(tabs.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("admin console: overview", () => {
  it("shows the key numbers with how they compare with the period before", async () => {
    base({ "GET /api/admin/overview": () => ({ json: overview }) });
    renderApp(<App />, "/admin");
    const nums = within(
      await screen
        .findByRole("list", { hidden: true, name: "" })
        .catch(() => document.body),
    );
    void nums;
    expect(await screen.findByText("120")).toBeInTheDocument(); // people
    expect(screen.getByText(/New in 30 days/)).toBeInTheDocument();
    expect(screen.getByText(/▲ 100%/)).toBeInTheDocument(); // 40 against 20
    expect(screen.getByText(/▼ 45%/)).toBeInTheDocument(); // 55 against 100
    expect(screen.getByText("12 min 5 s")).toBeInTheDocument();
    expect(screen.getByText("4.2 answers each")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument(); // weekly over monthly actives
  });

  it("draws the funnel as shares of the people who signed up", async () => {
    base({ "GET /api/admin/overview": () => ({ json: overview }) });
    renderApp(<App />, "/admin");
    const bars = await screen.findAllByRole("meter");
    expect(bars.map((b) => b.getAttribute("aria-valuenow"))).toEqual([
      "100",
      "75",
      "25",
    ]);
    expect(
      screen.getByText(/10 · 25% of sign-ups · 33.3% of the step before/),
    ).toBeInTheDocument();
  });

  it("explains the chart in words and offers the numbers behind it", async () => {
    base({ "GET /api/admin/overview": () => ({ json: overview }) });
    renderApp(<App />, "/admin");
    const chart = await screen.findByRole("img", {
      name: /Sign-ups, interviews and active people per day/,
    });
    expect(chart).toHaveAccessibleName(/Sign-ups: 7 in total/);
    expect(screen.getByText("Show the numbers")).toBeInTheDocument();
  });

  it("flags what went wrong recently and points to where to look", async () => {
    base({ "GET /api/admin/overview": () => ({ json: overview }) });
    renderApp(<App />, "/admin");
    expect(
      await screen.findByText(/Something failed recently/),
    ).toBeInTheDocument();
    expect(screen.getByText("Research jobs failed")).toBeInTheDocument();
    expect(screen.getByText("Blocked: no interviews left")).toBeInTheDocument();
  });

  it("says nothing is wrong when nothing is", async () => {
    base({
      "GET /api/admin/overview": () => ({
        json: {
          ...overview,
          health: { ...overview.health, research_failed_24h: 0 },
        },
      }),
    });
    renderApp(<App />, "/admin");
    await screen.findByText("What needs attention");
    expect(screen.queryByText(/Something failed recently/)).toBeNull();
  });

  it("changes the window and asks again", async () => {
    const calls = base({
      "GET /api/admin/overview": () => ({ json: overview }),
    });
    renderApp(<App />, "/admin");
    await userEvent.selectOptions(await screen.findByLabelText("Window"), "7");
    await waitFor(() =>
      expect(calls.some((c) => c.key === "GET /api/admin/overview")).toBe(true),
    );
    expect(screen.getByLabelText("Window")).toHaveValue("7");
  });

  it("says plainly when it cannot load", async () => {
    base({
      "GET /api/admin/overview": () => ({
        status: 500,
        json: { error: { code: "x", message: "m", request_id: "r" } },
      }),
    });
    renderApp(<App />, "/admin");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load the overview",
    );
  });
});

const row = (over: object = {}) => ({
  id: "u1",
  email: "ann@example.com",
  full_name: "Ann Lee",
  created_at: "2026-11-10T10:00:00Z",
  last_active_at: "2026-11-20T10:00:00Z",
  sessions: 2,
  companies: 1,
  has_cv: true,
  onboarded: true,
  credits_available: 0,
  referrals_counted: 1,
  referrals_held: 0,
  signup_method: "password",
  utm_source: "linkedin",
  referred: false,
  is_admin: false,
  ...over,
});

describe("admin console: users", () => {
  it("lists people with their activity and where they came from", async () => {
    base({
      "GET /api/admin/users": () => ({
        json: {
          total: 2,
          items: [
            row(),
            row({
              id: "u2",
              email: "boss@example.com",
              full_name: null,
              is_admin: true,
              utm_source: null,
              signup_method: "google",
              referred: true,
            }),
          ],
        },
      }),
    });
    renderApp(<App />, "/admin/users");
    const table = within(await screen.findByRole("table", { name: "People" }));
    expect(table.getByRole("link", { name: "Ann Lee" })).toHaveAttribute(
      "href",
      "/admin/users/u1",
    );
    expect(table.getByText("ann@example.com")).toBeInTheDocument();
    expect(table.getByText("password · linkedin")).toBeInTheDocument();
    expect(table.getByText("google · invited")).toBeInTheDocument();
    expect(table.getByText("admin")).toBeInTheDocument();
    expect(screen.getByText("1–2 of 2")).toBeInTheDocument();
  });

  it("searches by name or email and sorts", async () => {
    const calls = base({
      "GET /api/admin/users": () => ({ json: { total: 0, items: [] } }),
    });
    renderApp(<App />, "/admin/users");
    await userEvent.type(
      await screen.findByLabelText("Search by name or email"),
      "stone",
    );
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(
      await screen.findByText("Nobody matches “stone”."),
    ).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Sort"), "sessions");
    await waitFor(() =>
      expect(
        calls.filter((c) => c.key === "GET /api/admin/users").length,
      ).toBeGreaterThan(1),
    );
  });

  it("pages through a long list", async () => {
    base({
      "GET /api/admin/users": () => ({ json: { total: 60, items: [row()] } }),
    });
    renderApp(<App />, "/admin/users");
    expect(await screen.findByText("1–25 of 60")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("26–50 of 60")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
  });
});

const detail = {
  user: row({
    id: "u9",
    email: "bob@example.com",
    full_name: "Bob Stone",
    credits_available: 1,
  }),
  credits: { trial: 1, gifted: 0, referral: 0, paid: 0, used: 0 },
  referral_code: "abc23xyz",
  referred_by: "ann@example.com",
  invited: 0,
  held: 0,
  emails_sent: 2,
  emails_failed: 1,
  onboarding: null,
  attribution: null,
  timeline: [
    {
      id: "t1",
      at: "2026-11-20T10:00:00Z",
      kind: "session.started",
      category: "interview",
      label: "Started an interview",
      detail: "used a trial credit",
    },
  ],
};

describe("admin console: one person", () => {
  it("shows their numbers, who invited them and their activity", async () => {
    base({ "GET /api/admin/users/u9": () => ({ json: detail }) });
    renderApp(<App />, "/admin/users/u9");
    expect(
      await screen.findByRole("heading", { name: "Bob Stone" }),
    ).toBeInTheDocument();
    expect(screen.getByText("invited by ann@example.com")).toBeInTheDocument();
    expect(screen.getByText("1 failed")).toBeInTheDocument();
    const log = within(
      screen.getByRole("heading", { name: "Activity" }).closest("section")!,
    );
    expect(log.getByText("Started an interview")).toBeInTheDocument();
    expect(log.getByText(/used a trial credit/)).toBeInTheDocument();
  });

  it("gives free interviews with a reason, and says it did", async () => {
    const after = {
      ...detail,
      credits: { ...detail.credits, gifted: 2 },
      user: { ...detail.user, credits_available: 3 },
    };
    const calls = base({
      "GET /api/admin/users/u9": () => ({ json: detail }),
      "POST /api/admin/users/u9/credits": () => ({ status: 201, json: after }),
    });
    renderApp(<App />, "/admin/users/u9");
    await screen.findByRole("heading", { name: "Bob Stone" });
    await userEvent.clear(screen.getByLabelText("How many"));
    await userEvent.type(screen.getByLabelText("How many"), "2");
    await userEvent.type(
      screen.getByLabelText(/Reason/),
      "Sorry about the bug",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Give free interviews" }),
    );
    expect(
      await screen.findByText("Added 2 free interviews and emailed them."),
    ).toBeInTheDocument();
    expect(
      calls.find((c) => c.key === "POST /api/admin/users/u9/credits")!.body,
    ).toEqual({
      count: 2,
      reason: "Sorry about the bug",
      notify: true,
    });
    expect(screen.getByText(/2 from the team/)).toBeInTheDocument();
  });

  it("can give them without sending an email", async () => {
    const calls = base({
      "GET /api/admin/users/u9": () => ({ json: detail }),
      "POST /api/admin/users/u9/credits": () => ({ status: 201, json: detail }),
    });
    renderApp(<App />, "/admin/users/u9");
    await userEvent.click(await screen.findByLabelText("Email them to say so"));
    await userEvent.click(
      screen.getByRole("button", { name: "Give free interviews" }),
    );
    expect(
      await screen.findByText("Added 1 free interview."),
    ).toBeInTheDocument();
    expect(
      calls.find((c) => c.key === "POST /api/admin/users/u9/credits")!.body,
    ).toMatchObject({ notify: false, reason: null });
  });

  it("shows the server's message if it is refused", async () => {
    base({
      "GET /api/admin/users/u9": () => ({ json: detail }),
      "POST /api/admin/users/u9/credits": () => ({
        status: 422,
        json: { error: { code: "x", message: "Too many.", request_id: "r" } },
      }),
    });
    renderApp(<App />, "/admin/users/u9");
    await userEvent.click(
      await screen.findByRole("button", { name: "Give free interviews" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many.");
  });
});

const item = (over: object = {}) => ({
  id: "e1",
  at: "2026-11-20T10:00:00Z",
  kind: "user.signed_up",
  category: "account",
  label: "Signed up",
  user_id: "u1",
  user_email: "ann@example.com",
  actor_email: null,
  detail: "google",
  ...over,
});

describe("admin console: activity log", () => {
  it("lists what happened with who did it, and links to the person", async () => {
    base({
      "GET /api/admin/activity": () => ({
        json: {
          items: [
            item(),
            item({
              id: "e2",
              kind: "admin.credit_granted",
              category: "admin",
              label: "Admin gave free interviews",
              actor_email: "boss@example.com",
              detail: "2 to ann@example.com: thanks",
            }),
          ],
          next_before: null,
          categories: {
            account: ["user.signed_up"],
            admin: ["admin.credit_granted"],
          },
        },
      }),
    });
    renderApp(<App />, "/admin/activity");
    const log = within(
      await screen.findByRole("list", { name: "Platform activity" }),
    );
    expect(
      log.getAllByRole("link", { name: "ann@example.com" })[0],
    ).toHaveAttribute("href", "/admin/users/u1");
    expect(log.getByText("by boss@example.com")).toBeInTheDocument();
    expect(log.getByText("Admin gave free interviews")).toBeInTheDocument();
  });

  it("filters by kind and offers the download with the same filters", async () => {
    const calls = base({
      "GET /api/admin/activity": () => ({
        json: {
          items: [item()],
          next_before: null,
          categories: { account: [], email: [] },
        },
      }),
    });
    renderApp(<App />, "/admin/activity");
    await screen.findByRole("option", { name: "Emails" }); // the filter fills in once the log loads
    await userEvent.selectOptions(screen.getByLabelText("Kind"), "email");
    await waitFor(() =>
      expect(
        calls.filter((c) => c.key === "GET /api/admin/activity").length,
      ).toBeGreaterThan(1),
    );
    expect(screen.getByRole("link", { name: "Download CSV" })).toHaveAttribute(
      "href",
      expect.stringContaining("/api/admin/activity/export.csv?category=email"),
    );
    expect(
      screen.getByRole("button", { name: "Clear filters" }),
    ).toBeInTheDocument();
  });

  it("loads older entries when there are more", async () => {
    let page = 0;
    const calls = base({
      "GET /api/admin/activity": () => {
        page += 1;
        return {
          json: {
            items: [
              item({
                id: `e${page}`,
                label: page === 1 ? "Signed up" : "Signed in",
              }),
            ],
            next_before: page === 1 ? "2026-11-20T10:00:00+00:00|abc" : null,
            categories: {},
          },
        };
      },
    });
    renderApp(<App />, "/admin/activity");
    await userEvent.click(
      await screen.findByRole("button", { name: "Load older entries" }),
    );
    expect(await screen.findByText("Signed in")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Load older entries" }),
    ).toBeNull();
    expect(
      calls.filter((c) => c.key === "GET /api/admin/activity"),
    ).toHaveLength(2);
  });

  it("says so when nothing matches", async () => {
    base({
      "GET /api/admin/activity": () => ({
        json: { items: [], next_before: null, categories: {} },
      }),
    });
    renderApp(<App />, "/admin/activity");
    expect(
      await screen.findByText("Nothing matches those filters."),
    ).toBeInTheDocument();
  });
});

describe("admin console: referrals", () => {
  const refs = {
    total: 4,
    counted: 3,
    held: 1,
    rewards_earned: 1,
    rewards_redeemed: 0,
    referred_signups_pct: 12.5,
    per_reward: 3,
    top_referrers: [
      {
        user_id: "u1",
        email: "ann@example.com",
        counted: 3,
        held: 1,
        rewards_earned: 1,
        rewards_redeemed: 0,
      },
    ],
    held_items: [
      {
        id: "r1",
        at: "2026-11-20T10:00:00Z",
        referrer_email: "ann@example.com",
        referred_email: "ann2@example.org",
        reason: "same_device",
      },
    ],
  };

  it("shows totals, top inviters and what is held and why", async () => {
    base({ "GET /api/admin/referrals": () => ({ json: refs }) });
    renderApp(<App />, "/admin/referrals");
    expect(
      await screen.findByText(/3 counted sign-ups earn one free interview/),
    ).toBeInTheDocument();
    const top = within(screen.getByRole("table", { name: "Top inviters" }));
    expect(top.getByRole("link", { name: "ann@example.com" })).toHaveAttribute(
      "href",
      "/admin/users/u1",
    );
    const held = within(screen.getByRole("table", { name: "Held sign-ups" }));
    expect(held.getByText("ann2@example.org")).toBeInTheDocument();
    expect(held.getByText("Same device")).toBeInTheDocument();
    expect(screen.getByText("12.5%")).toBeInTheDocument();
  });

  it("counts a held sign-up when an admin says so", async () => {
    let state = refs;
    const calls = base({
      "GET /api/admin/referrals": () => ({ json: state }),
      "POST /api/admin/referrals/r1/approve": () => {
        state = { ...refs, counted: 4, held: 0, held_items: [] };
        return { json: state };
      },
    });
    renderApp(<App />, "/admin/referrals");
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Count the sign-up of ann2@example.org",
      }),
    );
    expect(
      await screen.findByText("Nothing is being held."),
    ).toBeInTheDocument();
    expect(
      calls.some((c) => c.key === "POST /api/admin/referrals/r1/approve"),
    ).toBe(true);
  });
});

describe("admin console: marketing", () => {
  const mk = {
    days: 30,
    signups: 40,
    by_method: [
      {
        channel: "google",
        signups: 30,
        activated: 15,
        activation_pct: 50,
        second_session: 5,
      },
    ],
    by_source: [
      {
        channel: "linkedin",
        signups: 20,
        activated: 12,
        activation_pct: 60,
        second_session: 6,
      },
      {
        channel: "direct",
        signups: 15,
        activated: 3,
        activation_pct: 20,
        second_session: 0,
      },
    ],
    by_campaign: [],
    referred_pct: 12.5,
    k_factor: 0.13,
    median_hours_to_first_session: 3.5,
    trial_used_users: 11,
    hit_paywall_users: 6,
    second_session_users: 5,
    redeemed_rewards: 2,
  };

  it("shows each channel and how far it gets", async () => {
    base({ "GET /api/admin/marketing": () => ({ json: mk }) });
    renderApp(<App />, "/admin/marketing");
    const src = within(await screen.findByRole("table", { name: "By source" }));
    expect(
      src.getByRole("row", { name: /linkedin 20 12 60% 6/ }),
    ).toBeInTheDocument();
    expect(
      src.getByRole("row", { name: /direct 15 3 20% 0/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("0.13")).toBeInTheDocument();
    expect(screen.getByText("3.5 h")).toBeInTheDocument();
  });

  it("gives the signals for pricing and explains the wall", async () => {
    base({ "GET /api/admin/marketing": () => ({ json: mk }) });
    renderApp(<App />, "/admin/marketing");
    const sec = within(
      (
        await screen.findByRole("heading", { name: "Signals for pricing" })
      ).closest("section")!,
    );
    expect(sec.getByText("6")).toBeInTheDocument(); // hit the wall
    expect(
      sec.getByText(/clearest sign of demand for paid interviews/),
    ).toBeInTheDocument();
  });

  it("tells you how to add campaign tags when there are none", async () => {
    base({ "GET /api/admin/marketing": () => ({ json: mk }) });
    renderApp(<App />, "/admin/marketing");
    expect(await screen.findByText(/No campaign tags yet/)).toBeInTheDocument();
  });
});

describe("admin console: quality", () => {
  const ql = {
    days: 30,
    answers: 200,
    rated: 50,
    helpful_pct: 82,
    flagged_pct: 3.5,
    latency: {
      p50_first_token_ms: 900,
      p95_first_token_ms: 2400,
      p50_total_ms: 5200,
      p95_total_ms: 9000,
    },
    by_type: { behavioral: 120, technical: 60 },
    avg_scores: { structure: 71.5, overall: 68 },
    research_jobs: 10,
    research_failed_pct: 10,
    scoring_runs: 20,
    scoring_failed_pct: 0,
  };

  it("shows ratings, speed, failures and the mix of questions", async () => {
    base({ "GET /api/admin/quality": () => ({ json: ql }) });
    renderApp(<App />, "/admin/quality");
    expect(await screen.findByText("82%")).toBeInTheDocument();
    expect(screen.getByText("0.9 s")).toBeInTheDocument();
    expect(screen.getByText("9.0 s")).toBeInTheDocument();
    expect(screen.getByText("behavioral")).toBeInTheDocument();
    expect(screen.getByText("71.5 / 100")).toBeInTheDocument();
  });

  it("shows dashes, not zeros, when there is nothing to measure", async () => {
    base({
      "GET /api/admin/quality": () => ({
        json: {
          ...ql,
          answers: 0,
          rated: 0,
          helpful_pct: null,
          flagged_pct: null,
          latency: {
            p50_first_token_ms: null,
            p95_first_token_ms: null,
            p50_total_ms: null,
            p95_total_ms: null,
          },
          by_type: {},
          avg_scores: {},
        },
      }),
    });
    renderApp(<App />, "/admin/quality");
    expect(await screen.findByText("No answers yet.")).toBeInTheDocument();
    expect(screen.getByText("No scored interviews yet.")).toBeInTheDocument();
    expect(screen.getAllByText("–").length).toBeGreaterThanOrEqual(6);
  });
});

describe("admin console: emails", () => {
  const tpl = [
    {
      kind: "welcome",
      title: "Welcome",
      when: "An account is created.",
      audience: "The new person",
    },
    {
      kind: "reset",
      title: "Reset password",
      when: "Someone asks to reset.",
      audience: "Account owner",
    },
  ];
  const emails = {
    kinds: [
      { kind: "welcome", sent_7d: 5, failed_7d: 1, sent_30d: 9, failed_30d: 1 },
      { kind: "reset", sent_7d: 0, failed_7d: 0, sent_30d: 0, failed_30d: 0 },
    ],
    items: [
      {
        id: "m1",
        at: "2026-11-20T10:00:00Z",
        kind: "welcome",
        to: "cat@example.com",
        status: "failed",
        user_id: "u3",
      },
      {
        id: "m2",
        at: "2026-11-20T09:00:00Z",
        kind: "reset",
        to: "ann@example.com",
        status: "sent",
        user_id: "u1",
      },
    ],
  };

  it("shows each template with how many went out and how many failed", async () => {
    base({
      "GET /api/admin/emails": () => ({ json: emails }),
      "GET /api/admin/emails/templates": () => ({ json: tpl }),
    });
    renderApp(<App />, "/admin/emails");
    const table = within(
      await screen.findByRole("table", { name: "Email templates" }),
    );
    expect(
      table.getByRole("row", { name: /Welcome .* 5 1/ }),
    ).toBeInTheDocument();
    expect(table.getByText("Someone asks to reset.")).toBeInTheDocument();
  });

  it("previews a template in a sandboxed frame, and as plain text", async () => {
    base({
      "GET /api/admin/emails": () => ({ json: emails }),
      "GET /api/admin/emails/templates": () => ({ json: tpl }),
      "GET /api/admin/emails/templates/welcome": () => ({
        json: {
          kind: "welcome",
          subject: "Welcome to InterviewMeet, Jordan",
          html: "<p>Hello HTML</p>",
          text: "Hello plain",
        },
      }),
    });
    renderApp(<App />, "/admin/emails");
    await userEvent.click(
      await screen.findByRole("button", { name: "Preview Welcome" }),
    );
    const frame = await screen.findByTitle(
      "Preview of Welcome to InterviewMeet, Jordan",
    );
    expect(frame).toHaveAttribute("sandbox", ""); // no scripts, no access to this page
    expect(frame).toHaveAttribute("srcdoc", "<p>Hello HTML</p>");
    expect(
      screen.getByText("Sample data, not a real person."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Plain text" }));
    expect(screen.getByText("Hello plain")).toBeInTheDocument();
    expect(screen.queryByTitle(/Preview of/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("heading", { name: /Preview:/ })).toBeNull();
  });

  it("lists who was emailed and whether it worked, and filters by result", async () => {
    const calls = base({
      "GET /api/admin/emails": () => ({ json: emails }),
      "GET /api/admin/emails/templates": () => ({ json: tpl }),
    });
    renderApp(<App />, "/admin/emails");
    const log = within(
      await screen.findByRole("table", { name: "Emails sent" }),
    );
    expect(log.getByText("cat@example.com")).toBeInTheDocument();
    expect(log.getByText("Failed")).toBeInTheDocument();
    expect(log.getByText("Sent")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Result"), "failed");
    await waitFor(() =>
      expect(
        calls.filter((c) => c.key === "GET /api/admin/emails").length,
      ).toBeGreaterThan(1),
    );
  });

  it("collapses to icons on a large screen and opens as a drawer on a phone", async () => {
    base({ "GET /api/admin/overview": () => ({ json: overview }) });
    renderApp(<App />, "/admin");
    await screen.findByRole("navigation", { name: "Admin sections" });
    await userEvent.click(
      screen.getByRole("button", { name: "Collapse sidebar" }),
    );
    expect(
      screen.getByRole("button", { name: "Expand sidebar" }),
    ).toBeInTheDocument();
    // the names stay for screen readers and as tooltips
    expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute(
      "title",
      "Users",
    );
    const toggle = screen.getByRole("button", { name: "Open menu" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Close menu" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});

describe("admin console: Auto-Apply", () => {
  const data = (over: object = {}) => ({
    enabled: true,
    dispatch: { form: false, email: true, outreach: false },
    provider: "gmail",
    campaigns_active: 4,
    campaigns_paused: 1,
    campaigns_started: 6,
    campaigns_ended: 2,
    applications_by_status: { submitted: 30, needs_input: 3 },
    applications_sent: 30,
    interviews: 5,
    invitations_per_100: 12.5,
    cohort_size: 40,
    hours_to_first_application: 3.4,
    attempts_unresolved: 1,
    attempts_failed: 2,
    unresolved: [
      {
        application_id: "a1",
        person: "ada@example.com",
        company: "Acme",
        title: "PM",
        channel: "email",
        state: "ambiguous",
        age_hours: 7.5,
      },
    ],
    mailboxes: { connected: 3, reauth_needed: 1 },
    discovery_runs: { done: 4 },
    events_needing_review: 2,
    switches: [
      { name: "channel:email", on: true, reason: "testing", set_at: null },
    ],
    ...over,
  });

  it("shows how it is going and what is stuck", async () => {
    base({ "GET /api/admin/autoapply": () => ({ json: data() }) });
    renderApp(<App />, "/admin/auto-apply");
    const totals = within(
      await screen
        .findByRole("group", { name: "Auto-Apply totals" })
        .catch(() => screen.getByLabelText("Auto-Apply totals")),
    );
    expect(totals.getByText("12.5")).toBeInTheDocument();
    expect(
      totals.getByText("of 40 sent 30 to 60 days ago"),
    ).toBeInTheDocument();
    const stuck = within(
      screen.getByRole("table", { name: "Unknown outcomes" }),
    );
    expect(stuck.getByText("ada@example.com")).toBeInTheDocument();
    expect(stuck.getByText("7.5 h")).toBeInTheDocument();
    expect(screen.getByText(/1 reauth needed/)).toBeInTheDocument();
  });

  it("turns a switch on or off with a reason", async () => {
    const calls = base({
      "GET /api/admin/autoapply": () => ({ json: data() }),
      "PUT /api/admin/autoapply/switches/global": () => ({ json: {} }),
      "PUT /api/admin/autoapply/switches/channel:email": () => ({ json: {} }),
    });
    renderApp(<App />, "/admin/auto-apply");
    await userEvent.type(
      await screen.findByLabelText("Reason (shown to the team)"),
      "bad batch",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Turn on: Stop all new sends" }),
    );
    await waitFor(() =>
      expect(
        calls.find((c) => c.key === "PUT /api/admin/autoapply/switches/global")
          ?.body,
      ).toEqual({ on: true, reason: "bad batch" }),
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Turn off: Stop emailed applications",
      }),
    );
    await waitFor(() =>
      expect(
        calls.find(
          (c) => c.key === "PUT /api/admin/autoapply/switches/channel:email",
        )?.body,
      ).toEqual({ on: false, reason: "bad batch" }),
    );
  });

  it("says when the feature is off and when there is no rate yet", async () => {
    base({
      "GET /api/admin/autoapply": () => ({
        json: data({
          enabled: false,
          invitations_per_100: null,
          unresolved: [],
          switches: [],
        }),
      }),
    });
    renderApp(<App />, "/admin/auto-apply");
    expect(
      await screen.findByText(/switched off on this server/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Needs applications a month old"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Everything that went out has been confirmed/),
    ).toBeInTheDocument();
  });
});

describe("admin console: jump to", () => {
  it("opens with the button, finds a section and goes there", async () => {
    base({
      "GET /api/admin/overview": () => ({ json: overview }),
      "GET /api/admin/users": () => ({ json: { total: 0, items: [] } }),
    });
    renderApp(<App />, "/admin");
    await userEvent.click(
      await screen.findByRole("button", { name: "Jump to" }),
    );
    const box = screen.getByRole("dialog", { name: "Jump to" });
    await userEvent.type(
      within(box).getByLabelText("Where to?"),
      "users{Enter}",
    );
    expect(
      await screen.findByRole("heading", { name: "Users" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("looks a person up by what you type", async () => {
    base({
      "GET /api/admin/overview": () => ({ json: overview }),
      "GET /api/admin/users": () => ({ json: { total: 0, items: [] } }),
    });
    renderApp(<App />, "/admin");
    await screen.findByRole("navigation", { name: "Admin sections" });
    await userEvent.keyboard("{Control>}k{/Control}");
    const box = await screen.findByRole("dialog", { name: "Jump to" });
    await userEvent.type(within(box).getByLabelText("Where to?"), "ada@x.com");
    await userEvent.click(
      within(box).getByRole("button", { name: /Find people matching/ }),
    );
    expect(await screen.findByLabelText(/Search by name or email/)).toHaveValue(
      "",
    );
    expect(window.location.search).toBe("");
  });
});
