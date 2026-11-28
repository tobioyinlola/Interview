import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../../app/App";
import {
  ME,
  mockApi,
  renderApp,
  stubSupportedBrowser,
} from "../../../test-utils";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

const me = { ...ME, onboarded: true, tour_done: true, autoapply: true };

const run = (over: object = {}) => ({
  state: "running",
  speed: "normal",
  execution_mode: "auto",
  forms_run_on: "cloud",
  desktop_open: false,
  executors: [],
  counters: {
    queued: 4,
    verified: 9,
    verified_today: 2,
    failed: 1,
    skipped: 6,
    needs_you: 3,
  },
  current: {
    company: "Acme",
    title: "Senior Product Manager",
    score: 0.82,
    ats: "greenhouse",
    ats_label: "Greenhouse",
    stage: "Filling in the form",
    fields_done: 6,
    fields_total: 12,
    step: 2,
    question: "Do you need visa sponsorship?",
    cv_version: "v2-1a2b3c4d",
    executor: "cloud",
    progress: 50,
  },
  events: [
    {
      id: 1,
      kind: "application_started",
      text: "Started an application",
      executor: "cloud",
      data: {},
      at: "2026-11-27T10:00:00Z",
    },
    {
      id: 2,
      kind: "field_completed",
      text: "Filled in a field",
      executor: "cloud",
      data: { label: "Email" },
      at: "2026-11-27T10:00:05Z",
    },
  ],
  last_seq: 2,
  ...over,
});

const base = (routes: Record<string, () => object> = {}) =>
  mockApi({
    "GET /api/me": () => ({ json: me }),
    "GET /api/billing": () => ({ status: 404, json: {} }),
    "GET /api/notes": () => ({
      json: { role: "", content: "x", updated_at: null },
    }),
    "GET /api/companies": () => ({ json: [] }),
    "GET /api/sessions": () => ({ json: { items: [], next_cursor: null } }),
    "GET /api/autoapply/run": () => ({ json: run() }),
    "GET /api/autoapply/run/events": () => ({
      json: { events: [], last_seq: 2 },
    }),
    ...routes,
  });

describe("the application run panel", () => {
  it("shows what is happening now: job, match, system, stage, progress, CV and question", async () => {
    base();
    renderApp(<App />, "/auto-apply/run");
    const now = within(await screen.findByLabelText("Right now"));
    expect(now.getByText("Senior Product Manager at Acme")).toBeInTheDocument();
    expect(
      now.getByText(/Greenhouse · 82% match · on our servers/),
    ).toBeInTheDocument();
    expect(now.getByText("Filling in the form")).toBeInTheDocument();
    expect(now.getByText(/6 of 12 fields · step 2/)).toBeInTheDocument();
    expect(
      now.getByRole("progressbar", { name: "Application progress" }),
    ).toHaveAttribute("aria-valuenow", "50");
    expect(now.getByText("v2-1a2b3c4d")).toBeInTheDocument();
    expect(now.getByText("Do you need visa sponsorship?")).toBeInTheDocument();
  });

  it("shows the totals and the activity history", async () => {
    base();
    renderApp(<App />, "/auto-apply/run");
    const totals = within(await screen.findByLabelText("Totals"));
    for (const [label, n] of [
      ["Queued", "4"],
      ["Verified", "9"],
      ["Failed", "1"],
      ["Skipped", "6"],
      ["Needs you", "3"],
    ])
      expect(totals.getByText(label).nextSibling).toHaveTextContent(n);
    expect(totals.getByText("2 today")).toBeInTheDocument();
    const activity = within(screen.getByLabelText("Activity"));
    expect(activity.getByText("Filled in a field: Email")).toBeInTheDocument();
    expect(activity.getByText("Started an application")).toBeInTheDocument();
  });

  it("sends the control that was pressed to the server and shows the new state", async () => {
    let now = run();
    const calls = base({
      "GET /api/autoapply/run": () => ({ json: now }),
      "POST /api/autoapply/run/pause": () => ({
        json: (now = run({ state: "paused" })),
      }),
    });
    renderApp(<App />, "/auto-apply/run");
    await userEvent.click(await screen.findByRole("button", { name: "Pause" }));
    expect(
      await screen.findByRole("button", { name: "Resume" }),
    ).toBeInTheDocument();
    const said = screen.getAllByRole("status").map((e) => e.textContent);
    expect(said).toContain("Paused");
    // and it says what pausing does, in words
    expect(
      said.some((t) => /nothing new starts until you resume/.test(t ?? "")),
    ).toBe(true);
    expect(calls.some((c) => c.key === "POST /api/autoapply/run/pause")).toBe(
      true,
    );
  });

  it("tries failed ones again and says what happened", async () => {
    const calls = base({
      "POST /api/autoapply/applications/retry-failed": () => ({
        json: { retried: 1, queued: 1, need_you: 0, left_alone: 0 },
      }),
    });
    renderApp(<App />, "/auto-apply/run");
    await userEvent.click(
      await screen.findByRole("button", { name: "Try failed ones again (1)" }),
    );
    expect(await screen.findByText("1 back in the queue.")).toBeInTheDocument();
    expect(
      calls.some(
        (c) => c.key === "POST /api/autoapply/applications/retry-failed",
      ),
    ).toBe(true);
  });

  it("skips only what is running, and stops", async () => {
    let now = run();
    const calls = base({
      "GET /api/autoapply/run": () => ({ json: now }),
      "POST /api/autoapply/run/skip": () => ({ json: now }),
      "POST /api/autoapply/run/stop": () => ({
        json: (now = run({ state: "stopped", current: null })),
      }),
    });
    renderApp(<App />, "/auto-apply/run");
    await userEvent.click(
      await screen.findByRole("button", { name: "Skip this one" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(
      await screen.findByRole("button", { name: "Start" }),
    ).toBeInTheDocument();
    expect(
      calls
        .filter((c) => c.key.startsWith("POST /api/autoapply/run/"))
        .map((c) => c.key),
    ).toEqual(["POST /api/autoapply/run/skip", "POST /api/autoapply/run/stop"]);
  });

  it("cannot skip when nothing is running", async () => {
    base({
      "GET /api/autoapply/run": () => ({ json: run({ current: null }) }),
    });
    renderApp(<App />, "/auto-apply/run");
    expect(
      await screen.findByRole("button", { name: "Skip this one" }),
    ).toBeDisabled();
  });

  it("changes the speed and where forms are filled in", async () => {
    const calls = base({
      "PUT /api/autoapply/run/settings": () => ({
        json: run({ speed: "slow", execution_mode: "desktop" }),
      }),
    });
    renderApp(<App />, "/auto-apply/run");
    await userEvent.selectOptions(
      await screen.findByLabelText("Speed"),
      "slow",
    );
    await userEvent.selectOptions(
      screen.getByLabelText("Fill in forms on"),
      "desktop",
    );
    await waitFor(() =>
      expect(
        calls
          .filter((c) => c.key === "PUT /api/autoapply/run/settings")
          .map((c) => c.body),
      ).toEqual([{ speed: "slow" }, { execution_mode: "desktop" }]),
    );
  });

  it("says where forms are being filled in and whether the computer is open", async () => {
    base({
      "GET /api/autoapply/run": () =>
        json(
          run({
            forms_run_on: "desktop",
            desktop_open: true,
            executors: [
              { name: "Ada's PC", platform: "windows", online: true },
            ],
          }),
        ),
    });
    renderApp(<App />, "/auto-apply/run");
    expect(
      await screen.findByText(/filled in on your computer/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Ada's PC\) is open/)).toBeInTheDocument();
  });

  it("is reachable from the Auto-Apply page while a search is running", async () => {
    base({
      "GET /api/autoapply/dashboard": () => ({ json: dashboard() }),
      "GET /api/autoapply/recruiting": () => ({ json: [] }),
    });
    renderApp(<App />, "/auto-apply");
    expect(
      await screen.findByRole("link", { name: "Watch live" }),
    ).toHaveAttribute("href", "/auto-apply/run");
  });
});

const json = (j: object) => ({ json: j });

const dashboard = () => ({
  demo: false,
  state: "running",
  primary: {
    kind: "preferences",
    label: "View search preferences",
    href: "/auto-apply/setup",
  },
  campaign: {
    state: "active",
    day: 3,
    days_total: 30,
    activated_at: "2026-11-02T09:00:00Z",
    ends_at: "2026-12-01T23:00:00Z",
    timezone: "Africa/Lagos",
  },
  paused: false,
  mailbox: {
    connected: true,
    address: "a@b.c",
    status: "connected",
    can_connect: true,
  },
  channels: { form: true, email: true, outreach: false },
  last_run: null,
  usage: {
    applications_used: 0,
    applications_cap: 5,
    outreach_used: 0,
    outreach_cap: 0,
  },
  counts: {},
  recent: [],
  needs_input: [],
  open_invites: [],
  next_interview: null,
  review_count: 0,
  sources: [],
});
