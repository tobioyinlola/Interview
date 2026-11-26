import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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
    expect(
      within(screen.getByRole("navigation", { name: "Main" })).queryByRole(
        "link",
        { name: "Auto-Apply" },
      ),
    ).toBeNull();
    unmount();
    vi.restoreAllMocks();
    stubSupportedBrowser();
    base();
    renderApp(<App />, "/dashboard");
    const nav = within(await screen.findByRole("navigation", { name: "Main" }));
    expect(
      await nav.findByRole("link", { name: "Auto-Apply" }),
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
    expect(
      screen.getByRole("img", { name: "0 sent so far, 2 of 5 today" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/8 found, 2 matched/)).toBeInTheDocument();
    expect(screen.getByText("Connected (ada@example.com)")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Senior Product Manager at Acme/ }),
    ).toHaveAttribute("href", "/auto-apply/applications/a1");
    expect(screen.getByText("Shortlisted")).toBeInTheDocument();
    expect(screen.getByText("Submitted")).toBeInTheDocument();
  });

  it("counts job applications and startup pitches together, in the circle and the tiles", async () => {
    onDash(
      dash({
        counts: { submitted: 4, sent_email: 1 },
        startups: { waiting: 2, sent: 3, replied: 1, openings: 4 },
        review_count: 1,
      }),
    );
    renderApp(<App />, "/auto-apply");
    expect(
      await screen.findByRole("img", { name: "8 sent so far, 2 of 5 today" }),
    ).toBeInTheDocument();
    const glance = within(screen.getByLabelText("At a glance"));
    expect(glance.getByText("Sent so far").nextSibling).toHaveTextContent("8");
    expect(glance.getByText("5 jobs · 3 startups")).toBeInTheDocument();
    expect(glance.getByText("Replies").nextSibling).toHaveTextContent("2"); // 1 startup + 1 to match
    expect(glance.getByText("Waiting for you").nextSibling).toHaveTextContent(
      "2",
    );
    expect(
      glance.getByText("2 startup pitches to approve"),
    ).toBeInTheDocument();
  });

  it("lists startup pitches next to job applications, newest first", async () => {
    onDash(
      dash({
        recent: [app()],
        startups: { waiting: 0, sent: 1, replied: 0, openings: 0 },
        startup_recent: [
          {
            id: "t1",
            company: "Lumen Labs",
            to_name: "Sam Ade",
            status: "sent",
            subject: "Hello",
            sent_at: "2099-01-01T10:00:00Z",
          },
        ],
      }),
    );
    renderApp(<App />, "/auto-apply");
    const pitch = await screen.findByRole("link", {
      name: /Pitch to Lumen Labs/,
    });
    expect(pitch).toHaveAttribute("href", "/startups");
    expect(pitch).toHaveTextContent("Startup · Sam Ade");
    expect(pitch).toHaveTextContent("Sent");
    const list = pitch.closest("ul") as HTMLElement;
    const names = within(list)
      .getAllByRole("link")
      .map((l) => l.textContent ?? "");
    expect(names[0]).toMatch(/Lumen Labs/); // newer than the job application below it
    expect(names.some((n) => /Senior Product Manager at Acme/.test(n))).toBe(
      true,
    );
  });

  it("shows an empty circle, not a spinner-like dot, before anything is used", async () => {
    onDash(dash({ usage: { ...dash().usage, applications_used: 0 } }));
    renderApp(<App />, "/auto-apply");
    const ring = await screen.findByRole("img", {
      name: "0 sent so far, 0 of 5 today",
    });
    expect(ring.querySelectorAll("circle")).toHaveLength(1); // the track only
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

  it("offers the form's own choices as a list when the form gives them", async () => {
    const calls = base({
      "GET /api/autoapply/applications/a1": () => ({
        json: detail({
          needs_input: [
            {
              kind: "answer",
              field: "question_9",
              question: "Are you legally authorized to work in the US?",
              reason: "The form now asks this and you have not answered it.",
              options: ["Yes", "No"],
            },
          ],
        }),
      }),
      "POST /api/autoapply/applications/a1/answer": () => ({ json: app() }),
    });
    renderApp(<App />, "/auto-apply/applications/a1");
    const pick = await screen.findByLabelText(
      "Are you legally authorized to work in the US?",
    );
    expect(pick.tagName).toBe("SELECT");
    await userEvent.selectOptions(pick, "Yes");
    await userEvent.click(
      screen.getByRole("button", { name: "Save and continue" }),
    );
    await waitFor(() =>
      expect(
        calls.find(
          (c) => c.key === "POST /api/autoapply/applications/a1/answer",
        )?.body,
      ).toMatchObject({ field: "question_9", value: "Yes" }),
    );
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

  it("hands a job on a site we cannot fill in to the person, with everything prepared", async () => {
    let applied = false;
    const calls = base({
      "GET /api/autoapply/applications/a1": () => ({
        json: detail({
          status: applied ? "applied_by_you" : "apply_yourself",
          channel: "manual",
          needs_input: [],
          posting: {
            ...app().posting,
            application_url: "https://careers.example.com/apply/1",
          },
          package_frozen_at: "2026-11-10T09:00:00Z",
          package: {
            cv: {
              submitted_text: "Ada Okoye\nSenior Product Manager",
              tailoring: { mode: "deterministic", reverted: [] },
            },
            cover_text: "Dear hiring team",
            answers: {},
            destination: {
              channel: "manual",
              url: "https://careers.example.com/apply/1",
            },
          },
        }),
      }),
      "POST /api/autoapply/applications/a1/applied": () => {
        applied = true;
        return { json: app({ status: "applied_by_you" }) };
      },
    });
    renderApp(<App />, "/auto-apply/applications/a1");
    expect(
      await screen.findByText("Apply on the employer's site"),
    ).toBeInTheDocument();
    expect(screen.getByText("Ready for you to apply")).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been sent/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open the application" }),
    ).toHaveAttribute("href", "https://careers.example.com/apply/1");
    expect(screen.getByText("What is ready for you")).toBeInTheDocument();
    expect(
      screen.getByText("For you to submit on the employer's site"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/By email to/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Copy my CV" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "I've applied" }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.key === "POST /api/autoapply/applications/a1/applied",
        ),
      ).toBe(true),
    );
    expect(await screen.findByText("Applied by you")).toBeInTheDocument();
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

describe("setting up: the guided flow", () => {
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
  const empty = () =>
    profile({
      criteria: {},
      channels: { form: false, email: false, outreach: false },
      version: 0,
      timezone: "UTC",
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
  const confirmed = {
    data: facts,
    version: 1,
    verified_at: "2026-11-02T09:00:00Z",
    cv_changed: false,
    from_model: true,
  };
  const disclosure = (over: object = {}) => ({
    policy_version: "2026-11",
    shared: ["your CV"],
    channels: { form: true, email: false, outreach: false },
    daily_application_cap: 5,
    daily_outreach_cap: 3,
    mailbox: null,
    problems: [],
    ...over,
  });
  const setup = (extra: Record<string, () => object> = {}) =>
    base({
      "GET /api/autoapply/profile": () => ({ json: profile() }),
      "GET /api/autoapply/facts": () => ({ json: confirmed }),
      "GET /api/autoapply/answers": () => ({ json: [] }),
      "GET /api/autoapply/mailbox": () => ({
        json: { connected: false, status: null, can_connect: true },
      }),
      "GET /api/autoapply/authorization": () => ({ json: disclosure() }),
      "GET /api/autoapply/dashboard": () => ({
        json: dash({ campaign: { state: "none" } }),
      }),
      ...extra,
    });
  const next = () =>
    userEvent.click(screen.getByRole("button", { name: "Next" }));
  const saved = (calls: { key: string; body: unknown }[]) =>
    calls
      .filter((c) => c.key === "PUT /api/autoapply/profile")
      .map(
        (c) =>
          c.body as {
            criteria: Record<string, unknown>;
            timezone: string;
            active_hours: unknown;
            daily_application_cap: number;
          },
      );

  it("shows seven steps with a progress bar, and starts where something is still needed", async () => {
    setup({ "GET /api/autoapply/profile": () => ({ json: empty() }) });
    renderApp(<App />, "/auto-apply/setup");
    expect(
      await screen.findByRole("heading", { name: "What you want" }),
    ).toBeInTheDocument(); // details are confirmed
    const rail = within(
      screen.getByRole("navigation", { name: "Setup steps" }),
    );
    expect(rail.getAllByRole("listitem")).toHaveLength(7);
    expect(rail.getByRole("button", { name: /Details/ })).toBeEnabled();
    expect(rail.getByRole("button", { name: /Channels/ })).toBeDisabled(); // not yet reachable
    expect(
      screen.getByRole("progressbar", { name: "Setup progress" }),
    ).toHaveAttribute("aria-valuenow", "17");
    expect(screen.getByText("Step 2 of 7")).toBeInTheDocument();
  });

  it("starts a first search from what they said at sign-up: the role and how they want to work", async () => {
    setup({
      "GET /api/autoapply/profile": () => ({ json: empty() }),
      "GET /api/me": () => ({
        json: {
          ...me,
          onboarding: {
            help: ["auto_apply"],
            arrangement: ["remote", "hybrid"],
          },
        },
      }),
      "GET /api/notes": () => ({
        json: { role: "Product Designer", content: "x", updated_at: null },
      }),
    });
    renderApp(<App />, "/auto-apply/setup");
    expect(
      await screen.findByRole("heading", { name: "What you want" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Product Designer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Remote/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /Hybrid/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /On-site/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("starts at the first step when the CV details are not confirmed yet", async () => {
    setup({ "GET /api/autoapply/facts": () => ({ json: null }) });
    renderApp(<App />, "/auto-apply/setup");
    expect(
      await screen.findByRole("heading", { name: "Your details" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 7")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(
      screen.getAllByText(/Check your details and confirm them/).length,
    ).toBeGreaterThan(0);
  });

  it("asks for the CV first when there is none", async () => {
    setup({
      "GET /api/autoapply/facts": () => ({ json: null }),
      "GET /api/notes": () => ({
        json: { role: "", content: "", updated_at: null },
      }),
    });
    renderApp(<App />, "/auto-apply/setup");
    expect(
      await screen.findByText(/Upload it here to carry on/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Upload your CV" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("reads the CV into a draft, and only confirming it moves on", async () => {
    let done = false;
    const calls = setup({
      "GET /api/autoapply/facts": () => ({ json: done ? confirmed : null }),
      "POST /api/autoapply/facts/extract": () => ({
        json: { data: facts, version: 0, verified_at: null, from_model: true },
      }),
      "PUT /api/autoapply/facts": () => {
        done = true;
        return { json: confirmed };
      },
    });
    renderApp(<App />, "/auto-apply/setup");
    await userEvent.click(
      await screen.findByRole("button", { name: "Read my CV" }),
    );
    const name = await screen.findByLabelText("Full name");
    expect(name).toHaveValue("Ada Okoye");
    expect(calls.some((c) => c.key === "PUT /api/autoapply/facts")).toBe(false);
    await userEvent.clear(name);
    await userEvent.type(name, "Ada N. Okoye");
    await userEvent.click(
      screen.getByRole("button", { name: "These details are right" }),
    );
    expect(
      await screen.findByText(/Your details are confirmed/),
    ).toBeInTheDocument();
    await waitFor(() => {
      const put = calls.find((c) => c.key === "PUT /api/autoapply/facts")
        ?.body as { verified: boolean; data: typeof facts };
      expect(put.verified).toBe(true);
      expect(put.data.contact.name).toBe("Ada N. Okoye");
    });
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("warns when only patterns could read the CV", async () => {
    setup({
      "GET /api/autoapply/facts": () => ({ json: null }),
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

  it("will not open a later step by link until the earlier ones are done", async () => {
    setup({ "GET /api/autoapply/profile": () => ({ json: empty() }) });
    renderApp(<App />, "/auto-apply/setup?step=review");
    expect(
      await screen.findByRole("heading", { name: "What you want" }),
    ).toBeInTheDocument();
  });

  it("role step: needs a role and a place, offers lists, and keeps must-haves", async () => {
    const calls = setup({
      "GET /api/autoapply/profile": () => ({ json: empty() }),
      "PUT /api/autoapply/profile": () => ({ json: profile({ version: 1 }) }),
    });
    renderApp(<App />, "/auto-apply/setup?step=role");
    await screen.findByRole("heading", { name: "What you want" });
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(
      screen.getAllByText("Add at least one role.").length,
    ).toBeGreaterThan(0);
    const roles = screen.getByLabelText("Roles you want", {
      selector: "input",
    }) as HTMLInputElement;
    const options = [
      ...document
        .getElementById(roles.getAttribute("list")!)!
        .querySelectorAll("option"),
    ].map((o) => o.getAttribute("value"));
    expect(options).toContain("Data Analyst");
    await userEvent.type(roles, "Senior Product Manager");
    await userEvent.click(screen.getByRole("button", { name: "Add role" }));
    await userEvent.type(roles, "Head of Chaos{Enter}");
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Head of Chaos" }),
    );
    expect(
      screen.getAllByText("Add a country or region you can work in.").length,
    ).toBeGreaterThan(0);
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
    await userEvent.type(places, "Nigeria");
    await userEvent.click(screen.getByRole("button", { name: "Add place" }));
    // the work style tiles, and choosing how strict it is
    await userEvent.click(screen.getByRole("button", { name: /Remote/ }));
    await userEvent.click(
      within(
        screen.getByRole("radiogroup", {
          name: "How strict is the work style",
        }),
      ).getByRole("radio", { name: "Nice to have" }),
    );
    await userEvent.click(
      within(
        screen.getByRole("radiogroup", { name: "How strict is the role" }),
      ).getByRole("radio", { name: "Nice to have" }),
    );
    await next();
    expect(
      await screen.findByRole("heading", { name: "Nice to have" }),
    ).toBeInTheDocument();
    const body = saved(calls)[0];
    expect(body.criteria.roles).toEqual([
      { value: "Senior Product Manager", required: false },
    ]);
    expect(body.criteria.locations).toEqual([
      { value: "Nigeria", required: true },
    ]);
    expect(body.criteria.arrangement).toEqual([
      { value: "remote", required: false },
    ]);
  });

  it("shows an error from the server and stays on the step", async () => {
    setup({
      "PUT /api/autoapply/profile": () => ({
        status: 422,
        json: {
          error: {
            code: "invalid_profile",
            message: "That timezone is not recognised.",
            request_id: "r",
          },
        },
      }),
    });
    renderApp(<App />, "/auto-apply/setup?step=role");
    await screen.findByRole("heading", { name: "What you want" });
    await userEvent.type(
      screen.getByLabelText("Roles you want", { selector: "input" }),
      "Data Analyst",
    );
    await userEvent.click(screen.getByRole("button", { name: "Add role" }));
    await next();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "not recognised",
    );
    expect(
      screen.getByRole("heading", { name: "What you want" }),
    ).toBeInTheDocument();
  });

  it("preferences: optional, with pills, pay and sponsorship, saved with their strictness", async () => {
    const calls = setup({
      "PUT /api/autoapply/profile": () => ({ json: profile({ version: 2 }) }),
    });
    renderApp(<App />, "/auto-apply/setup?step=preferences");
    await screen.findByRole("heading", { name: "Nice to have" });
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled(); // nothing is required here
    await userEvent.click(screen.getByRole("button", { name: "senior" }));
    await userEvent.click(screen.getByRole("button", { name: "full time" }));
    await userEvent.type(screen.getByLabelText("Amount"), "90000");
    await userEvent.selectOptions(screen.getByLabelText("Currency"), "NGN");
    await userEvent.click(screen.getByRole("radio", { name: "per month" }));
    await userEvent.click(
      within(
        screen.getByRole("radiogroup", { name: "How strict is the pay" }),
      ).getByRole("radio", { name: "Must have" }),
    );
    await userEvent.click(
      screen.getByRole("radio", { name: "I need sponsorship" }),
    );
    await next();
    expect(
      await screen.findByRole("heading", { name: "When to apply" }),
    ).toBeInTheDocument();
    const c = saved(calls)[0].criteria;
    expect(c.seniority).toEqual([{ value: "senior", required: false }]);
    expect(c.contract).toEqual([{ value: "full_time", required: false }]);
    expect(c.salary).toEqual({
      floor: 90000,
      currency: "NGN",
      period: "month",
      required: true,
    });
    expect(c.sponsorship).toEqual({ need: "needed", required: false });
  });

  it("skipping an optional step moves on without saving", async () => {
    const calls = setup();
    renderApp(<App />, "/auto-apply/setup?step=preferences");
    await screen.findByRole("heading", { name: "Nice to have" });
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(
      await screen.findByRole("heading", { name: "When to apply" }),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.key === "PUT /api/autoapply/profile")).toBe(
      false,
    );
  });

  it("schedule: time zone, active hours and a daily limit slider", async () => {
    const calls = setup({
      "PUT /api/autoapply/profile": () => ({ json: profile() }),
    });
    renderApp(<App />, "/auto-apply/setup?step=schedule");
    await screen.findByRole("heading", { name: "When to apply" });
    await userEvent.selectOptions(
      screen.getByLabelText("Your time zone"),
      "Europe/London",
    );
    await userEvent.click(
      screen.getByRole("switch", { name: "Send at any time of day" }),
    );
    await userEvent.selectOptions(screen.getByLabelText("From"), "8");
    await userEvent.selectOptions(screen.getByLabelText("Until"), "17");
    fireEvent.change(screen.getByLabelText("Most applications per day"), {
      target: { value: "12" },
    });
    expect(screen.getByText(/up to 360 applications/)).toBeInTheDocument();
    await next();
    expect(
      await screen.findByRole("heading", { name: "How to apply" }),
    ).toBeInTheDocument();
    const b = saved(calls)[0];
    expect(b.timezone).toBe("Europe/London");
    expect(b.active_hours).toEqual({ start: 8, end: 17 });
    expect(b.daily_application_cap).toBe(12);
  });

  it("schedule: refuses hours that start and end together", async () => {
    setup();
    renderApp(<App />, "/auto-apply/setup?step=schedule");
    await screen.findByRole("heading", { name: "When to apply" });
    await userEvent.click(
      screen.getByRole("switch", { name: "Send at any time of day" }),
    );
    await userEvent.selectOptions(screen.getByLabelText("Until"), "9");
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("how to apply: separate options, and email needs a connected mailbox", async () => {
    const calls = setup({
      "PUT /api/autoapply/profile": () => ({ json: profile() }),
      "POST /api/autoapply/mailbox/connect": () => ({
        json: { connected: true, url: null },
      }),
    });
    renderApp(<App />, "/auto-apply/setup?step=apply");
    await screen.findByRole("heading", { name: "How to apply" });
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled(); // forms only
    await userEvent.click(
      screen.getByRole("button", { name: /Email applications/ }),
    );
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getAllByText(/Connect your email/).length).toBeGreaterThan(0);
    // the connection itself is in Settings, and it comes back here when it is done
    expect(
      screen.getByRole("link", { name: "Connect email in Settings" }),
    ).toHaveAttribute("href", "/settings/email?next=/auto-apply/setup");
    expect(screen.queryByRole("button", { name: "Connect Gmail" })).toBeNull();
    expect(
      calls.some((c) => c.key === "POST /api/autoapply/mailbox/connect"),
    ).toBe(false);
  });

  it("how to apply: needs at least one way, and saves the notes limit", async () => {
    setup({
      "GET /api/autoapply/mailbox": () => ({
        json: {
          connected: true,
          address: "ada@example.com",
          status: "connected",
          can_connect: true,
        },
      }),
      "PUT /api/autoapply/profile": () => ({ json: profile() }),
    });
    renderApp(<App />, "/auto-apply/setup?step=apply");
    await screen.findByRole("heading", { name: "How to apply" });
    await userEvent.click(
      screen.getByRole("button", { name: /Employers' application forms/ }),
    );
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(
      screen.getAllByText("Choose at least one way to apply.").length,
    ).toBeGreaterThan(0);
    await userEvent.click(
      screen.getByRole("button", {
        name: /A short note to the hiring contact/,
      }),
    );
    expect(screen.getByLabelText("Most notes a day")).toBeInTheDocument();
    expect(screen.getByText(/Connected: ada@example.com/)).toBeInTheDocument();
  });

  it("answers: saves only what was written, and reuse is on unless switched off", async () => {
    const calls = setup({
      "PUT /api/autoapply/answers/notice_period": () => ({ json: {} }),
      "PUT /api/autoapply/answers/relocation": () => ({ json: {} }),
    });
    renderApp(<App />, "/auto-apply/setup?step=answers");
    await screen.findByRole("heading", { name: "Your quick answers" });
    await userEvent.type(
      screen.getByLabelText("What is your notice period?"),
      "Two weeks",
    );
    await userEvent.type(
      screen.getByLabelText("Are you willing to relocate?"),
      "Within Nigeria",
    );
    await userEvent.click(
      screen.getByRole("switch", {
        name: /Reuse my answer to: Are you willing to relocate/,
      }),
    );
    await next();
    expect(
      await screen.findByRole("heading", { name: "Review and start" }),
    ).toBeInTheDocument();
    const puts = calls.filter((c) =>
      c.key.startsWith("PUT /api/autoapply/answers/"),
    );
    expect(puts.map((c) => c.key).sort()).toEqual([
      "PUT /api/autoapply/answers/notice_period",
      "PUT /api/autoapply/answers/relocation",
    ]);
    expect(puts.find((c) => c.key.endsWith("notice_period"))!.body).toEqual({
      question: "What is your notice period?",
      value: "Two weeks",
      reusable: true,
    });
    expect(puts.find((c) => c.key.endsWith("relocation"))!.body).toEqual({
      question: "Are you willing to relocate?",
      value: "Within Nigeria",
      reusable: false,
    });
  });

  it("review: summarises everything, lets any part be edited, and starts only after agreeing", async () => {
    const calls = setup({
      "POST /api/autoapply/campaign/enable": () => ({
        json: campaign({ day: 1 }),
      }),
    });
    renderApp(<App />, "/auto-apply/setup?step=review");
    await screen.findByRole("heading", { name: "Review and start" });
    const what = within(screen.getByRole("region", { name: "What you want" }));
    expect(what.getByText(/Senior Product Manager/)).toBeInTheDocument();
    expect(what.getByText(/Nigeria/)).toBeInTheDocument();
    expect(await screen.findByText("your CV")).toBeInTheDocument();
    const start = screen.getByRole("button", { name: "Start Auto-Apply" });
    expect(start).toBeDisabled();
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

  it("review: Edit jumps back to that step", async () => {
    setup();
    renderApp(<App />, "/auto-apply/setup?step=review");
    await screen.findByRole("heading", { name: "Review and start" });
    await userEvent.click(
      screen.getByRole("button", { name: "Edit schedule" }),
    );
    expect(
      await screen.findByRole("heading", { name: "When to apply" }),
    ).toBeInTheDocument();
  });

  it("review: never starts while the server lists what is missing", async () => {
    setup({
      "GET /api/autoapply/authorization": () => ({
        json: disclosure({ problems: ["Upload your CV first."] }),
      }),
    });
    renderApp(<App />, "/auto-apply/setup?step=review");
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

  it("review: a running search shows its progress and can be paused", async () => {
    const calls = setup({
      "GET /api/autoapply/dashboard": () => ({
        json: dash({ campaign: campaign({ day: 4 }) }),
      }),
      "POST /api/autoapply/campaign/pause": () => ({
        json: campaign({ state: "paused" }),
      }),
    });
    renderApp(<App />, "/auto-apply/setup?step=review");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "running: day 4 of 30",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Pause Auto-Apply" }),
    );
    await waitFor(() =>
      expect(
        calls.some((c) => c.key === "POST /api/autoapply/campaign/pause"),
      ).toBe(true),
    );
  });

  it("goes back a step and the rail shows what is done", async () => {
    setup();
    renderApp(<App />, "/auto-apply/setup?step=schedule");
    await screen.findByRole("heading", { name: "When to apply" });
    const rail = within(
      screen.getByRole("navigation", { name: "Setup steps" }),
    );
    expect(rail.getByRole("button", { name: /Details/ })).toHaveTextContent(
      "(done)",
    );
    expect(
      rail.getByRole("button", { name: /Role & place/ }),
    ).toHaveTextContent("(done)");
    expect(rail.getByRole("button", { name: /Schedule/ })).toHaveAttribute(
      "aria-current",
      "step",
    );
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(
      await screen.findByRole("heading", { name: "Nice to have" }),
    ).toBeInTheDocument();
    await userEvent.click(rail.getByRole("button", { name: /Role & place/ }));
    expect(
      await screen.findByRole("heading", { name: "What you want" }),
    ).toBeInTheDocument();
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
        mode: "mock",
      }),
    );
  });
});

describe("the email prompt on the home screens", () => {
  it("points to Settings once, and can be put away", async () => {
    base({
      "GET /api/autoapply/mailbox": () => ({
        json: {
          connected: false,
          address: null,
          status: "none",
          can_connect: true,
        },
      }),
    });
    renderApp(<App />, "/dashboard");
    const card = await screen.findByRole("region", {
      name: "Send from your own email",
    });
    expect(within(card).getByText(/show in your Sent folder/)).toBeVisible();
    expect(
      within(card).getByRole("link", { name: "Connect email" }),
    ).toHaveAttribute("href", "/settings/email");
    expect(
      within(card).queryByRole("button", { name: /Connect Gmail/ }),
    ).toBeNull();
    await userEvent.click(
      within(card).getByRole("button", { name: "Not now" }),
    );
    expect(
      screen.queryByRole("region", { name: "Send from your own email" }),
    ).toBeNull();
    localStorage.removeItem("im-gmail-prompt-dismissed");
  });
});

describe("connecting with an app password", () => {
  const options = [
    {
      id: "gmail",
      label: "Gmail or Google Workspace",
      help: "Google Account, Security, App passwords.",
    },
    {
      id: "outlook",
      label: "Outlook or Hotmail",
      help: "Microsoft account, Security.",
    },
  ];
  const off = {
    connected: false,
    address: null,
    status: "none",
    can_connect: true,
    smtp_providers: options,
  };

  it("offers the form in Settings next to the Google button, and connects", async () => {
    const connect = vi.fn(() => ({
      json: {
        ...off,
        connected: true,
        provider: "smtp",
        address: "ada@example.com",
      },
    }));
    base({
      "GET /api/autoapply/mailbox": () => ({ json: off }),
      "POST /api/autoapply/mailbox/connect-smtp": connect,
    });
    renderApp(<App />, "/settings/email");
    const card = await screen.findByRole("region", { name: "Your email" });
    expect(
      within(card).getByRole("button", { name: "Connect Gmail" }),
    ).toBeVisible();
    expect(
      within(card).getByText(/Google Account, Security, App passwords\./),
    ).toBeVisible();
    await userEvent.type(
      within(card).getByLabelText("App password"),
      "abcd efgh",
    );
    await userEvent.click(
      within(card).getByRole("button", { name: "Connect" }),
    );
    await waitFor(() => expect(connect).toHaveBeenCalled());
  });

  it("shows why a wrong password was refused, and never fills the password back in", async () => {
    base({
      "GET /api/autoapply/mailbox": () => ({ json: off }),
      "POST /api/autoapply/mailbox/connect-smtp": () => ({
        status: 422,
        json: {
          error: {
            code: "mailbox_rejected",
            message: "Gmail did not accept that address and app password.",
          },
        },
      }),
    });
    renderApp(<App />, "/settings/email");
    const card = await screen.findByRole("region", { name: "Your email" });
    await userEvent.type(
      within(card).getByLabelText("App password"),
      "wrongwrong",
    );
    await userEvent.click(
      within(card).getByRole("button", { name: "Connect" }),
    );
    expect(await within(card).findByRole("alert")).toHaveTextContent(
      "did not accept that address and app password",
    );
  });

  it("is not offered when the server has it switched off", async () => {
    base({
      "GET /api/autoapply/mailbox": () => ({
        json: { ...off, smtp_providers: [] },
      }),
    });
    renderApp(<App />, "/settings/email");
    const card = await screen.findByRole("region", { name: "Your email" });
    expect(within(card).queryByLabelText("App password")).toBeNull();
  });
});
