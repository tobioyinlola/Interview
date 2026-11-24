import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import { ME, mockApi, renderApp, stubSupportedBrowser } from "../../test-utils";

beforeEach(() => {
  stubSupportedBrowser();
  window.Capacitor = { isNativePlatform: () => true };
});
afterEach(() => {
  vi.restoreAllMocks();
  delete window.Capacitor;
});

const me = {
  ...ME,
  onboarded: true,
  tour_done: true,
  autoapply: true,
  full_name: "Jordan Reyes",
};

const posting = (title: string, company: string) => ({
  id: "p" + title,
  company,
  title,
  region: "Nigeria",
  arrangement: "remote",
  application_url: "https://jobs.example/1",
  source: "fixture",
});
const application = (id: string, title: string, company: string) => ({
  id,
  status: "submitted",
  channel: "form",
  posting: posting(title, company),
  score: 1,
  needs_input: [],
  skip_reason: null,
  recruiting_stage: null,
  created_at: "2026-11-10T09:00:00Z",
  updated_at: "2026-11-10T09:00:00Z",
});
const dash = (over: object = {}) => ({
  demo: false,
  state: "running",
  primary: { kind: "preferences", label: "View", href: "/auto-apply/setup" },
  campaign: {
    state: "active",
    day: 12,
    days_total: 30,
    activated_at: "2026-11-02T09:00:00Z",
    ends_at: "2026-12-01T23:00:00Z",
    timezone: "Africa/Lagos",
  },
  paused: false,
  mailbox: {
    connected: false,
    address: null,
    status: "none",
    can_connect: true,
  },
  channels: { form: true, email: false, outreach: false },
  last_run: null,
  usage: {
    applications_used: 2,
    applications_cap: 5,
    outreach_used: 0,
    outreach_cap: 3,
  },
  next_interview: null,
  open_invites: [],
  needs_input: [],
  recent: [application("a1", "Product Manager", "Acme")],
  counts: { submitted: 4, sent_email: 1 },
  review_count: 0,
  sources: ["Remotive"],
  ...over,
});

const api = (extra: Record<string, () => object> = {}, cv = "my cv") =>
  mockApi({
    "GET /api/me": () => ({ json: me }),
    "GET /api/notes": () => ({
      json: { role: "PM", content: cv, updated_at: null },
    }),
    "GET /api/companies": () => ({
      json: [
        {
          id: "c1",
          name: "Beta",
          job_status: "ready",
          last_researched_at: null,
        },
      ],
    }),
    "GET /api/sessions": () => ({ json: { items: [], next_cursor: null } }),
    "GET /api/autoapply/dashboard": () => ({ json: dash() }),
    "GET /api/billing": () => ({ status: 404, json: {} }),
    ...extra,
  });

describe("the phone home", () => {
  it("greets by first name and offers one number, a few shortcuts and a short list", async () => {
    api();
    renderApp(<App />, "/dashboard");
    expect(await screen.findByText("Jordan")).toBeInTheDocument();
    const summary = await screen.findByRole("link", {
      name: "Auto-Apply summary",
    });
    expect(within(summary).getByText("5")).toBeInTheDocument(); // 4 sent by form + 1 by email
    expect(within(summary).getByText("2 of 5 today")).toBeInTheDocument();
    expect(
      within(summary).getByRole("img", { name: "Day 12 of 30" }),
    ).toBeInTheDocument();
    const quick = within(screen.getByRole("region", { name: "Quick actions" }));
    for (const [name, href] of [
      ["Auto-Apply", "/auto-apply"],
      ["Companies", "/companies"],
      ["Interview", "/session/new"],
      ["History", "/sessions"],
    ])
      expect(quick.getByRole("link", { name })).toHaveAttribute("href", href);
    const recent = within(screen.getByRole("region", { name: "Recent" }));
    expect(recent.getByText("Product Manager")).toBeInTheDocument();
  });

  it("says the next step: the CV first", async () => {
    api({}, "");
    renderApp(<App />, "/dashboard");
    const step = await screen.findByRole("link", { name: "Add your CV" });
    expect(step).toHaveAttribute("href", "/settings/cv");
  });

  it("then Auto-Apply when it is not set up", async () => {
    api({
      "GET /api/autoapply/dashboard": () => ({
        json: dash({ campaign: { state: "none" } }),
      }),
    });
    renderApp(<App />, "/dashboard");
    expect(
      await screen.findByRole("link", { name: "Set up Auto-Apply" }),
    ).toHaveAttribute("href", "/auto-apply/setup");
  });

  it("and who is waiting on you, when someone is", async () => {
    api({
      "GET /api/autoapply/dashboard": () => ({
        json: dash({
          needs_input: [
            application("n1", "A", "B"),
            application("n2", "C", "D"),
          ],
        }),
      }),
    });
    renderApp(<App />, "/dashboard");
    expect(
      await screen.findByRole("link", { name: "2 waiting for you" }),
    ).toBeInTheDocument();
  });
});

describe("the three icons", () => {
  it("are the only navigation, with Auto-Apply in the middle", async () => {
    api();
    renderApp(<App />, "/companies");
    const tabs = await screen.findByRole("navigation", { name: "Tabs" });
    expect(within(tabs).getAllByRole("link")).toHaveLength(3);
    expect(
      within(tabs).getByRole("link", { name: "Auto-Apply" }),
    ).toHaveAttribute("href", "/auto-apply");
    expect(
      within(tabs).getByRole("link", { name: "Companies" }),
    ).toHaveAttribute("aria-current", "page");
  });
});

describe("the profile page", () => {
  it("holds everything else, and signs out", async () => {
    let out = false;
    api({
      "POST /api/auth/logout": () => {
        out = true;
        return { json: { status: "ok" } };
      },
    });
    renderApp(<App />, "/me");
    expect(await screen.findByText("Jordan Reyes")).toBeInTheDocument();
    for (const [name, href] of [
      ["Settings", "/settings/profile"],
      ["Interview history", "/sessions"],
      ["Invite friends", "/referrals"],
      ["Help", "/help"],
      ["Privacy", "/privacy"],
      ["Terms", "/terms"],
    ])
      expect(
        screen.getByRole("link", { name: new RegExp(`^${name}`) }),
      ).toHaveAttribute("href", href);
    await userEvent.click(screen.getByRole("button", { name: /Sign out/ }));
    await screen
      .findByRole("heading", { name: "Sign in" })
      .catch(() => undefined);
    expect(out).toBe(true);
  });
});

describe("Auto-Apply on the phone", () => {
  const withWork = () =>
    api({
      "GET /api/autoapply/dashboard": () => ({
        json: dash({ needs_input: [application("n1", "Designer", "Gamma")] }),
      }),
      "GET /api/autoapply/review": () => ({ json: [] }),
    });

  it("is three short sections, one at a time", async () => {
    withWork();
    renderApp(<App />, "/auto-apply");
    const tabs = await screen.findByRole("tablist", {
      name: "Auto-Apply sections",
    });
    expect(within(tabs).getByRole("tab", { name: "To do" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByText(/Needs your input/i)).toBeInTheDocument();
    expect(screen.queryByText("Recent applications")).toBeNull();
    expect(screen.queryByText("Today")).toBeNull();

    await userEvent.click(within(tabs).getByRole("tab", { name: "Sent" }));
    expect(await screen.findByText("Recent applications")).toBeInTheDocument();
    expect(screen.queryByText(/Needs your input/i)).toBeNull();

    await userEvent.click(within(tabs).getByRole("tab", { name: "Search" }));
    expect(await screen.findByText("Today")).toBeInTheDocument();
    expect(screen.queryByText("Recent applications")).toBeNull();
  });

  it("stays one page on the website", async () => {
    delete window.Capacitor;
    withWork();
    renderApp(<App />, "/auto-apply");
    expect(await screen.findByText("Recent applications")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(
      screen.queryByRole("tablist", { name: "Auto-Apply sections" }),
    ).toBeNull();
  });
});
