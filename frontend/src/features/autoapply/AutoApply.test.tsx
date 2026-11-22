import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import { ME, mockApi, renderApp, stubSupportedBrowser } from "../../test-utils";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

const me = { ...ME, onboarded: true, tour_done: true, autoapply: true };
const base = (routes: Record<string, () => object> = {}) =>
  mockApi({
    "GET /api/me": () => ({ json: me }),
    "GET /api/billing": () => ({ status: 404, json: {} }),
    "GET /api/notes": () => ({
      json: { role: "", content: "x", updated_at: null },
    }),
    "GET /api/companies": () => ({ json: [] }),
    "GET /api/sessions": () => ({ json: { items: [], next_cursor: null } }),
    ...routes,
  });

const campaign = (over: object = {}) => ({
  state: "active",
  day: 12,
  days_total: 30,
  activated_at: "2026-11-02T09:00:00Z",
  ends_at: "2026-12-01T23:00:00Z",
  timezone: "Africa/Lagos",
  ...over,
});

const mailbox = {
  connected: true,
  address: "ada@example.com",
  status: "connected",
  can_connect: true,
};

const dash = (over: object = {}) => ({
  demo: false,
  state: "running",
  primary: {
    kind: "preferences",
    label: "View search preferences",
    href: "/auto-apply/setup",
  },
  campaign: campaign(),
  paused: false,
  mailbox,
  channels: { form: true, email: true, outreach: false },
  last_run: {
    local_day: "2026-11-13",
    status: "done",
    found: 8,
    new: 3,
    eligible: 2,
    needs_input: 1,
    skipped: 5,
    error: null,
    started_at: "2026-11-13T09:00:00Z",
    finished_at: "2026-11-13T09:01:00Z",
  },
  usage: {
    applications_used: 2,
    applications_cap: 5,
    outreach_used: 0,
    outreach_cap: 3,
  },
  next_interview: null,
  open_invites: [],
  needs_input: [],
  recent: [],
  counts: {},
  review_count: 0,
  ...over,
});

const app = (over: object = {}) => ({
  id: "a1",
  status: "submitted",
  channel: "form",
  posting: {
    id: "p1",
    company: "Acme",
    title: "Senior Product Manager",
    region: "Nigeria",
    arrangement: "remote",
    application_url: "https://jobs.example/1",
    source: "fixture",
  },
  score: 1,
  needs_input: [],
  skip_reason: null,
  recruiting_stage: null,
  created_at: "2026-11-10T09:00:00Z",
  updated_at: "2026-11-10T09:00:00Z",
  ...over,
});

const interview = (over: object = {}) => ({
  id: "i1",
  application_id: "a1",
  company: "Acme",
  title: "Senior Product Manager",
  round: 1,
  status: "scheduled",
  scheduling_url: null,
  meeting_url: "https://meet.google.com/abc-defg-hij",
  scheduled_at: "2026-12-03T14:00:00Z",
  time_zone_unclear: false,
  company_id: "c1",
  last_event_id: "e1",
  action: "prepare",
  history: [],
  ...over,
});

const onDash = (d: object, extra: Record<string, () => object> = {}) =>
  base({
    "GET /api/autoapply/dashboard": () => ({ json: d }),
    "GET /api/autoapply/recruiting": () => ({ json: [] }),
    ...extra,
  });

describe("navigation", () => {
  it("shows Auto-Apply in the menu only when the feature is on", async () => {
    base({ "GET /api/me": () => ({ json: { ...me, autoapply: false } }) });
    const { unmount } = renderApp(<App />, "/dashboard");
    await screen.findByRole("navigation", { name: "Main" });
    expect(screen.queryByRole("link", { name: "Auto-Apply" })).toBeNull();
    unmount();
    vi.restoreAllMocks();
    stubSupportedBrowser();
    base();
    renderApp(<App />, "/dashboard");
    expect(
      await screen.findByRole("link", { name: "Auto-Apply" }),
    ).toHaveAttribute("href", "/auto-apply");
  });
});

describe("the dashboard", () => {
  it("says where the search stands and what is happening today", async () => {
    onDash(dash({ recent: [app({ recruiting_stage: "shortlisted" })] }));
    renderApp(<App />, "/auto-apply");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "On · day 12 of 30",
    );
    expect(screen.getByText("2 of 5")).toBeInTheDocument();
    expect(screen.getByText(/8 found, 2 matched/)).toBeInTheDocument();
    expect(screen.getByText("Connected (ada@example.com)")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Senior Product Manager at Acme/ }),
    ).toHaveAttribute("href", "/auto-apply/applications/a1");
    expect(screen.getByText("Shortlisted")).toBeInTheDocument();
    expect(screen.getByText("Submitted")).toBeInTheDocument();
  });

  it("shows the demo notice on the dashboard too", async () => {
    onDash(dash({ demo: true }));
    renderApp(<App />, "/auto-apply");
    expect(await screen.findByRole("note")).toHaveTextContent(
      "sample jobs and sending is simulated",
    );
  });

  it("invites a new person to set up", async () => {
    onDash(
      dash({
        state: "setup",
        campaign: { state: "none" },
        usage: null,
        last_run: null,
        primary: {
          kind: "setup",
          label: "Set up Auto-Apply",
          href: "/auto-apply/setup",
        },
      }),
    );
    renderApp(<App />, "/auto-apply");
    expect(
      await screen.findByRole("link", { name: "Set up Auto-Apply" }),
    ).toHaveAttribute("href", "/auto-apply/setup");
    expect(screen.getByText("Not set up yet.")).toBeInTheDocument();
  });

  it("offers Book interview as the employer's own link when an invitation is open", async () => {
    const iv = interview({
      status: "invited",
      scheduling_url: "https://calendly.com/acme/pm",
      scheduled_at: null,
      action: "book",
    });
    onDash(
      dash({
        state: "book",
        primary: {
          kind: "book",
          label: "Book interview",
          href: iv.scheduling_url,
          interview_id: "i1",
        },
        open_invites: [iv],
      }),
    );
    renderApp(<App />, "/auto-apply");
    const links = await screen.findAllByRole("link", {
      name: "Book interview",
    });
    for (const l of links) {
      expect(l).toHaveAttribute("href", "https://calendly.com/acme/pm");
      expect(l).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("opens interview preparation from Prepare for interview", async () => {
    const calls = onDash(
      dash({
        state: "prepare",
        primary: {
          kind: "prepare",
          label: "Prepare for interview",
          interview_id: "i1",
        },
        next_interview: interview(),
      }),
      {
        "POST /api/autoapply/interviews/i1/prepare": () => ({
          json: {
            interview_id: "i1",
            company_id: "c1",
            session_url: "/session/new?interview=i1",
            research_started: true,
          },
        }),
      },
    );
    renderApp(<App />, "/auto-apply");
    const next = within(
      await screen.findByRole("region", { name: "Next interview" }),
    );
    expect(
      next.getByText("Senior Product Manager at Acme"),
    ).toBeInTheDocument();
    expect(
      next.getByRole("link", { name: "Open the meeting link" }),
    ).toHaveAttribute("href", "https://meet.google.com/abc-defg-hij");
    await userEvent.click(
      next.getByRole("button", { name: "Prepare for interview" }),
    );
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.key === "POST /api/autoapply/interviews/i1/prepare",
        ),
      ).toBe(true),
    );
    expect(
      await screen.findByRole("heading", { name: "Start an interview" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/starts from your Auto-Apply interview/),
    ).toBeInTheDocument();
  });

  it("asks for the time zone when the email did not give one", async () => {
    const calls = onDash(
      dash({
        state: "prepare",
        primary: {
          kind: "prepare",
          label: "Prepare for interview",
          interview_id: "i1",
        },
        next_interview: interview({
          time_zone_unclear: true,
          action: "confirm_time",
        }),
      }),
      {
        "POST /api/autoapply/recruiting/e1/confirm-time": () => ({ json: {} }),
      },
    );
    renderApp(<App />, "/auto-apply");
    const box = await screen.findByLabelText("Time zone it was written in");
    await userEvent.clear(box);
    await userEvent.type(box, "Europe/London");
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm time zone" }),
    );
    await waitFor(() =>
      expect(
        calls.find(
          (c) => c.key === "POST /api/autoapply/recruiting/e1/confirm-time",
        )?.body,
      ).toEqual({ timezone: "Europe/London" }),
    );
  });

  it("lists what needs the candidate, with the exact question", async () => {
    const waiting = app({
      status: "needs_input",
      needs_input: [
        {
          kind: "answer",
          field: "notice_period",
          question: "What is your notice period?",
          reason: "The form needs this and you have not answered it yet.",
        },
      ],
    });
    onDash(
      dash({
        state: "answer",
        primary: {
          kind: "answer",
          label: "Resolve the question",
          href: "/auto-apply/applications/a1",
        },
        needs_input: [waiting],
      }),
    );
    renderApp(<App />, "/auto-apply");
    const sec = within(
      await screen.findByRole("region", { name: "Needs your input" }),
    );
    expect(sec.getByText(/What is your notice period\?/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Resolve the question" }),
    ).toHaveAttribute("href", "/auto-apply/applications/a1");
  });

  it("lets the candidate choose where an ambiguous employer message belongs", async () => {
    const calls = onDash(dash({ review_count: 1 }), {
      "GET /api/autoapply/recruiting": () => ({
        json: [
          {
            id: "m1",
            kind: "invitation",
            status: "needs_review",
            received_at: "2026-11-14T09:00:00Z",
            sender: "people@acme.test",
            subject: "Your application",
            matched_by: "sender",
            application_id: null,
            scheduled_at: null,
            time_zone_unclear: false,
            links: {},
            candidates: [
              { id: "a1", company: "Acme", title: "Product Manager" },
              { id: "a2", company: "Acme", title: "Growth Analyst" },
            ],
          },
        ],
      }),
      "POST /api/autoapply/recruiting/m1/link": () => ({ json: {} }),
    });
    renderApp(<App />, "/auto-apply");
    await userEvent.click(
      await screen.findByRole("button", { name: "Growth Analyst at Acme" }),
    );
    await waitFor(() =>
      expect(
        calls.find((c) => c.key === "POST /api/autoapply/recruiting/m1/link")
          ?.body,
      ).toEqual({ application_id: "a2" }),
    );
  });

  it("pauses, resumes and searches on demand", async () => {
    let state = "active";
    const calls = base({
      "GET /api/autoapply/dashboard": () => ({
        json: dash({
          campaign: campaign({ state }),
          paused: state === "paused",
        }),
      }),
      "GET /api/autoapply/recruiting": () => ({ json: [] }),
      "POST /api/autoapply/campaign/pause": () => {
        state = "paused";
        return { json: campaign({ state }) };
      },
      "POST /api/autoapply/campaign/resume": () => {
        state = "active";
        return { json: campaign({ state }) };
      },
      "POST /api/autoapply/discovery/run": () => ({ json: null }),
    });
    renderApp(<App />, "/auto-apply");
    await userEvent.click(
      await screen.findByRole("button", { name: "Pause Auto-Apply" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Paused · day 12 of 30",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Resume Auto-Apply" }),
    );
    expect(
      await screen.findByRole("button", { name: "Pause Auto-Apply" }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Search for roles now" }),
    );
    await waitFor(() =>
      expect(
        calls.some((c) => c.key === "POST /api/autoapply/discovery/run"),
      ).toBe(true),
    );
  });

  it("adds a pasted job link", async () => {
    const calls = onDash(dash(), {
      "POST /api/autoapply/jobs": () => ({ json: app() }),
    });
    renderApp(<App />, "/auto-apply");
    await userEvent.type(
      await screen.findByLabelText("Job link"),
      "https://jobs.example/9",
    );
    await userEvent.click(screen.getByRole("button", { name: "Add job" }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.key === "POST /api/autoapply/jobs")?.body,
      ).toEqual({ url: "https://jobs.example/9" }),
    );
  });

  it("points a finished search at the results and a fresh 30 days", async () => {
    onDash(
      dash({
        state: "ended",
        campaign: campaign({ state: "ended" }),
        primary: {
          kind: "results",
          label: "View results or start another 30 days",
          href: "/auto-apply/applications",
        },
      }),
    );
    renderApp(<App />, "/auto-apply");
    expect(
      await screen.findByRole("link", {
        name: "View results or start another 30 days",
      }),
    ).toHaveAttribute("href", "/auto-apply/applications");
    expect(screen.getByRole("status")).toHaveTextContent("Finished on");
  });

  it("says plainly when email needs reconnecting", async () => {
    onDash(
      dash({
        state: "reconnect",
        mailbox: { ...mailbox, connected: false, status: "reauth_needed" },
        primary: {
          kind: "reconnect",
          label: "Reconnect email",
          href: "/auto-apply/setup#email",
        },
      }),
    );
    renderApp(<App />, "/auto-apply");
    expect(
      await screen.findByRole("link", { name: "Reconnect email" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Needs reconnecting")).toBeInTheDocument();
  });
});

describe("one application", () => {
  const detail = (over: object = {}) => ({
    ...app({
      status: "needs_input",
      needs_input: [
        {
          kind: "answer",
          field: "notice_period",
          question: "What is your notice period?",
          reason: "The form needs this.",
        },
      ],
    }),
    match: {
      decision: "eligible",
      rules: [
        {
          key: "role",
          label: "Target role",
          required: true,
          status: "pass",
          evidence: "'Senior Product Manager' matches",
        },
        {
          key: "location",
          label: "Location or region",
          required: true,
          status: "unknown",
          evidence: "remote, but the listing does not say who may apply",
        },
      ],
    },
    package: null,
    package_frozen_at: null,
    attempts: [],
    outreach: null,
    history: [
      { kind: "discovered", detail: {}, created_at: "2026-11-10T09:00:00Z" },
    ],
    ...over,
  });

  it("answers the exact question, optionally for reuse", async () => {
    const calls = base({
      "GET /api/autoapply/applications/a1": () => ({ json: detail() }),
      "POST /api/autoapply/applications/a1/answer": () => ({ json: app() }),
    });
    renderApp(<App />, "/auto-apply/applications/a1");
    expect(
      await screen.findByRole("heading", { name: "Senior Product Manager" }),
    ).toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText("What is your notice period?"),
      "Two weeks",
    );
    await userEvent.click(screen.getByLabelText("Reuse this answer next time"));
    await userEvent.click(
      screen.getByRole("button", { name: "Save and continue" }),
    );
    await waitFor(() =>
      expect(
        calls.find(
          (c) => c.key === "POST /api/autoapply/applications/a1/answer",
        )?.body,
      ).toEqual({
        field: "notice_period",
        value: "Two weeks",
        save_for_reuse: true,
      }),
    );
  });

  it("shows why it matched, with what each rule found", async () => {
    base({ "GET /api/autoapply/applications/a1": () => ({ json: detail() }) });
    renderApp(<App />, "/auto-apply/applications/a1");
    expect(await screen.findByText(/matches/)).toBeInTheDocument();
    expect(screen.getByText(/does not say who may apply/)).toBeInTheDocument();
  });

  it("lets the candidate approve an unclear rule or skip the role", async () => {
    const calls = base({
      "GET /api/autoapply/applications/a1": () => ({
        json: detail({
          needs_input: [
            {
              kind: "rule",
              field: "location",
              question: "Location or region",
              reason: "Remote, but the listing does not say who may apply.",
            },
          ],
        }),
      }),
      "POST /api/autoapply/applications/a1/approve": () => ({ json: app() }),
      "POST /api/autoapply/applications/a1/skip": () => ({ json: app() }),
    });
    renderApp(<App />, "/auto-apply/applications/a1");
    await userEvent.click(
      await screen.findByRole("button", { name: "I have checked. Go ahead" }),
    );
    await waitFor(() =>
      expect(
        calls.find(
          (c) => c.key === "POST /api/autoapply/applications/a1/approve",
        )?.body,
      ).toEqual({ rule: "location" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Skip this role" }),
    );
    await waitFor(() =>
      expect(
        calls.some((c) => c.key === "POST /api/autoapply/applications/a1/skip"),
      ).toBe(true),
    );
  });

  it("asks whether an unconfirmed application went through", async () => {
    const calls = base({
      "GET /api/autoapply/applications/a1": () => ({
        json: detail({
          status: "confirmation_pending",
          needs_input: [
            {
              kind: "confirm",
              field: "confirm",
              question: "Did this application go through?",
              reason: "We could not confirm it.",
            },
          ],
        }),
      }),
      "POST /api/autoapply/applications/a1/resolve": () => ({ json: app() }),
    });
    renderApp(<App />, "/auto-apply/applications/a1");
    await userEvent.click(
      await screen.findByRole("button", { name: "No, send it again" }),
    );
    await waitFor(() =>
      expect(
        calls.find(
          (c) => c.key === "POST /api/autoapply/applications/a1/resolve",
        )?.body,
      ).toEqual({ sent: false }),
    );
  });

  it("shows exactly what was sent", async () => {
    base({
      "GET /api/autoapply/applications/a1": () => ({
        json: detail({
          status: "submitted",
          needs_input: [],
          package_frozen_at: "2026-11-10T09:00:00Z",
          package: {
            cv: {
              submitted_text:
                "Ada Okoye\nSenior Product Manager, Northwind (2021 - 2025)",
              tailoring: { mode: "deterministic", reverted: [] },
            },
            cover_text: "Dear hiring team",
            answers: {
              notice_period: { value: "Two weeks", source: "this application" },
            },
            destination: { channel: "email", to: "jobs@acme.test" },
          },
          attempts: [
            {
              channel: "email",
              state: "confirmed",
              provider_ref: "x@interviewmeet.app",
              failure_message: null,
              claimed_at: "2026-11-10T09:00:00Z",
              finished_at: "2026-11-10T09:00:01Z",
            },
          ],
        }),
      }),
    });
    renderApp(<App />, "/auto-apply/applications/a1");
    expect(await screen.findByText("What was sent")).toBeInTheDocument();
    expect(screen.getByText("By email to jobs@acme.test")).toBeInTheDocument();
    expect(
      screen.getByText(/Senior Product Manager, Northwind/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/reference x@interviewmeet.app/),
    ).toBeInTheDocument();
  });

  it("can write to a hiring contact once the application is sent", async () => {
    const calls = base({
      "GET /api/autoapply/applications/a1": () => ({
        json: detail({ status: "submitted", needs_input: [] }),
      }),
      "POST /api/autoapply/applications/a1/outreach": () => ({ json: {} }),
    });
    renderApp(<App />, "/auto-apply/applications/a1");
    await userEvent.type(
      await screen.findByLabelText("Hiring contact's email"),
      "hana@acme.test",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Write to them" }),
    );
    await waitFor(() =>
      expect(
        calls.find(
          (c) => c.key === "POST /api/autoapply/applications/a1/outreach",
        )?.body,
      ).toEqual({ recipient: "hana@acme.test" }),
    );
  });

  it("says so when the application is not found", async () => {
    base({
      "GET /api/autoapply/applications/zz": () => ({
        status: 404,
        json: { error: { code: "not_found", message: "x", request_id: "r" } },
      }),
    });
    renderApp(<App />, "/auto-apply/applications/zz");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be found",
    );
  });
});

describe("the applications list", () => {
  it("filters by what happened and pages back through history", async () => {
    const seen: string[] = [];
    base({
      "GET /api/autoapply/applications": () => ({
        json: {
          items: [app({ skip_reason: "The listing has expired." })],
          next_cursor: "c1",
        },
      }),
    });
    const fetchSpy = vi.mocked(fetch);
    renderApp(<App />, "/auto-apply/applications");
    expect(
      await screen.findByRole("link", { name: "Senior Product Manager" }),
    ).toBeInTheDocument();
    expect(screen.getByText("The listing has expired.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Skipped" }));
    await waitFor(() =>
      fetchSpy.mock.calls.forEach((c) => seen.push(String(c[0]))),
    );
    expect(seen.some((u) => u.includes("status=skipped"))).toBe(true);
    await userEvent.click(
      await screen.findByRole("button", { name: "Show older" }),
    );
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some((c) => String(c[0]).includes("before=c1")),
      ).toBe(true),
    );
  });
});

describe("setting up", () => {
  const profile = (over: object = {}) => ({
    criteria: {
      roles: [{ value: "Senior Product Manager", required: true }],
      locations: [{ value: "Nigeria", required: true }],
    },
    timezone: "Africa/Lagos",
    active_hours: {},
    channels: { form: true, email: false, outreach: false },
    daily_application_cap: 5,
    daily_outreach_cap: 3,
    paused: false,
    version: 1,
    ...over,
  });
  const facts = {
    contact: {
      name: "Ada Okoye",
      email: "ada@example.com",
      phone: "",
      location: "Lagos",
    },
    links: [],
    skills: ["SQL"],
    history: [
      {
        title: "Senior PM",
        company: "Northwind",
        start: "2021",
        end: "2025",
        summary: "Led payments.",
      },
    ],
    education: [],
  };
  const setup = (extra: Record<string, () => object> = {}) =>
    base({
      "GET /api/autoapply/profile": () => ({ json: profile() }),
      "GET /api/autoapply/facts": () => ({ json: null }),
      "GET /api/autoapply/answers": () => ({ json: [] }),
      "GET /api/autoapply/mailbox": () => ({
        json: { connected: false, status: null, can_connect: true },
      }),
      "GET /api/autoapply/authorization": () => ({
        json: {
          policy_version: "2026-11",
          shared: ["your CV"],
          channels: { form: true, email: false, outreach: false },
          daily_application_cap: 5,
          daily_outreach_cap: 3,
          mailbox: null,
          problems: [],
        },
      }),
      "GET /api/autoapply/dashboard": () => ({
        json: dash({ campaign: { state: "none" } }),
      }),
      ...extra,
    });

  it("reads the CV into a draft the candidate checks, and only then confirms it", async () => {
    const calls = setup({
      "POST /api/autoapply/facts/extract": () => ({
        json: { data: facts, version: 0, verified_at: null, from_model: true },
      }),
      "PUT /api/autoapply/facts": () => ({
        json: { data: facts, version: 1, verified_at: "2026-11-02T09:00:00Z" },
      }),
    });
    renderApp(<App />, "/auto-apply/setup");
    await userEvent.click(
      await screen.findByRole("button", { name: "Read my CV" }),
    );
    const name = await screen.findByLabelText("Full name");
    expect(name).toHaveValue("Ada Okoye");
    expect(calls.some((c) => c.key === "PUT /api/autoapply/facts")).toBe(false); // nothing confirmed yet
    await userEvent.clear(name);
    await userEvent.type(name, "Ada N. Okoye");
    await userEvent.click(
      screen.getByRole("button", { name: "These details are right" }),
    );
    await waitFor(() => {
      const put = calls.find((c) => c.key === "PUT /api/autoapply/facts");
      expect((put?.body as { verified: boolean }).verified).toBe(true);
      expect((put?.body as { data: typeof facts }).data.contact.name).toBe(
        "Ada N. Okoye",
      );
      expect(
        (put?.body as { data: typeof facts }).data.history[0].company,
      ).toBe("Northwind");
    });
  });

  it("warns when only patterns could read the CV", async () => {
    setup({
      "POST /api/autoapply/facts/extract": () => ({
        json: {
          data: { ...facts, history: [] },
          version: 0,
          verified_at: null,
          from_model: false,
        },
      }),
    });
    renderApp(<App />, "/auto-apply/setup");
    await userEvent.click(
      await screen.findByRole("button", { name: "Read my CV" }),
    );
    expect(
      await screen.findByText(/only read your contact details/),
    ).toBeInTheDocument();
  });

  it("picks roles and places from lists, and saves them with the must-haves and a salary floor", async () => {
    const calls = setup({
      "PUT /api/autoapply/profile": () => ({ json: profile({ version: 2 }) }),
    });
    renderApp(<App />, "/auto-apply/setup");
    const chosen = within(
      await screen.findByRole("list", { name: "Roles you want: chosen" }),
    );
    expect(chosen.getByText("Senior Product Manager")).toBeInTheDocument();
    // a role from the dropdown list, then one typed by hand
    const roles = screen.getByLabelText("Roles you want", {
      selector: "input",
    }) as HTMLInputElement;
    const options = [
      ...document
        .getElementById(roles.getAttribute("list")!)!
        .querySelectorAll("option"),
    ].map((o) => o.getAttribute("value"));
    expect(options).toContain("Data Analyst");
    await userEvent.type(roles, "Data Analyst");
    await userEvent.click(screen.getByRole("button", { name: "Add role" }));
    await userEvent.type(roles, "Head of Chaos{Enter}");
    expect(
      within(
        screen.getByRole("list", { name: "Roles you want: chosen" }),
      ).getAllByRole("listitem"),
    ).toHaveLength(3);
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Head of Chaos" }),
    );
    // places: countries and wider regions are both offered
    const places = screen.getByLabelText(
      "Where you can work: a country or region",
      { selector: "input" },
    ) as HTMLInputElement;
    const placeOptions = [
      ...document
        .getElementById(places.getAttribute("list")!)!
        .querySelectorAll("option"),
    ].map((o) => o.getAttribute("value"));
    expect(placeOptions).toEqual(
      expect.arrayContaining([
        "Kenya",
        "Africa",
        "Worldwide",
        "United Kingdom",
      ]),
    );
    await userEvent.type(places, "Kenya");
    await userEvent.click(screen.getByRole("button", { name: "Add place" }));
    await userEvent.click(screen.getByLabelText("remote"));
    await userEvent.click(
      screen.getByLabelText("This is a must (work arrangement)"),
    );
    await userEvent.type(screen.getByLabelText("Amount"), "90000");
    await userEvent.click(
      screen.getByLabelText(/This is a must\. Jobs that do not say/),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save my search" }),
    );
    await waitFor(() => {
      const body = calls.find((c) => c.key === "PUT /api/autoapply/profile")
        ?.body as {
        criteria: Record<string, unknown>;
        timezone: string;
        daily_application_cap: number;
      };
      expect(body.criteria.roles).toEqual([
        { value: "Senior Product Manager", required: true },
        { value: "Data Analyst", required: true },
      ]);
      expect(body.criteria.locations).toEqual([
        { value: "Nigeria", required: true },
        { value: "Kenya", required: true },
      ]);
      expect(body.criteria.arrangement).toEqual([
        { value: "remote", required: true },
      ]);
      expect(body.criteria.salary).toEqual({
        floor: 90000,
        currency: "USD",
        period: "year",
        required: true,
      });
      expect(body.timezone).toBe("Africa/Lagos");
      expect(body.daily_application_cap).toBe(5);
    });
  });

  it("says plainly when the server is in demo mode", async () => {
    setup({
      "GET /api/autoapply/dashboard": () => ({
        json: dash({ demo: true, campaign: { state: "none" } }),
      }),
    });
    renderApp(<App />, "/auto-apply/setup");
    expect(await screen.findByRole("note")).toHaveTextContent("Demo mode");
    expect(screen.getByRole("note")).toHaveTextContent(
      "Nothing is sent to a real employer",
    );
  });

  it("chooses each way to apply separately and connects email", async () => {
    const calls = setup({
      "PUT /api/autoapply/profile": () => ({ json: profile() }),
      "POST /api/autoapply/mailbox/connect": () => ({
        json: { connected: true, url: null },
      }),
    });
    renderApp(<App />, "/auto-apply/setup");
    await userEvent.click(
      await screen.findByLabelText(/Email applications from my own email/),
    );
    await waitFor(() =>
      expect(
        (
          calls.find((c) => c.key === "PUT /api/autoapply/profile")?.body as {
            channels: object;
          }
        ).channels,
      ).toEqual({ form: true, email: true, outreach: false }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Connect my email" }),
    );
    await waitFor(() =>
      expect(
        calls.some((c) => c.key === "POST /api/autoapply/mailbox/connect"),
      ).toBe(true),
    );
  });

  it("saves a reusable answer only as ticked", async () => {
    const calls = setup({
      "PUT /api/autoapply/answers/notice_period": () => ({ json: {} }),
    });
    renderApp(<App />, "/auto-apply/setup");
    await userEvent.type(
      await screen.findByLabelText("Your answer"),
      "Two weeks",
    );
    await userEvent.click(screen.getByLabelText("Reuse this answer"));
    await userEvent.click(screen.getByRole("button", { name: "Save answer" }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.key === "PUT /api/autoapply/answers/notice_period")
          ?.body,
      ).toEqual({
        question: "What is your notice period?",
        value: "Two weeks",
        reusable: false,
      }),
    );
  });

  it("starts only after the candidate agrees, and never while something is missing", async () => {
    const calls = setup({
      "POST /api/autoapply/campaign/enable": () => ({
        json: campaign({ day: 1 }),
      }),
    });
    renderApp(<App />, "/auto-apply/setup");
    const start = await screen.findByRole("button", {
      name: "Start Auto-Apply",
    });
    expect(start).toBeDisabled();
    expect(screen.getByText("your CV")).toBeInTheDocument();
    await userEvent.click(
      screen.getByLabelText(/I agree that InterviewMeet may apply/),
    );
    expect(start).toBeEnabled();
    await userEvent.click(start);
    await waitFor(() =>
      expect(
        calls.find((c) => c.key === "POST /api/autoapply/campaign/enable")
          ?.body,
      ).toEqual({ policy_version: "2026-11", accept: true }),
    );
  });

  it("blocks starting while the server lists what is missing", async () => {
    setup({
      "GET /api/autoapply/authorization": () => ({
        json: {
          policy_version: "2026-11",
          shared: [],
          channels: { form: true, email: false, outreach: false },
          daily_application_cap: 5,
          daily_outreach_cap: 3,
          mailbox: null,
          problems: ["Upload your CV first."],
        },
      }),
    });
    renderApp(<App />, "/auto-apply/setup");
    expect(
      await screen.findByText("Upload your CV first."),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByLabelText(/I agree that InterviewMeet may apply/),
    );
    expect(
      screen.getByRole("button", { name: "Start Auto-Apply" }),
    ).toBeDisabled();
  });
});

describe("starting an interview from Auto-Apply", () => {
  it("sends the interview, not a company, and the server supplies the CV and job", async () => {
    const calls = base({
      "POST /api/sessions": () => ({
        json: {
          session_id: "s1",
          status: "active",
          consent_confirmed_at: "2026-11-02T09:00:00Z",
          audio_token: "t",
          sample_rate: 24000,
        },
      }),
    });
    renderApp(<App />, "/session/new?interview=i1");
    await screen.findByText(/starts from your Auto-Apply interview/);
    await userEvent.click(screen.getByRole("button", { name: /Start/ }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === "POST /api/sessions")?.body).toEqual({
        interview_id: "i1",
      }),
    );
  });
});
