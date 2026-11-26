import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import { mockApi, renderApp, stubSupportedBrowser } from "../../test-utils";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

const staff = {
  "GET /api/admin/auth/me": () => ({
    json: { email: "boss@example.com", full_name: null },
  }),
  "GET /api/billing": () => ({ status: 404, json: {} }),
};

const data = (over: object = {}) => ({
  days: 30,
  has_data: true,
  data_since: "2026-11-01T00:00:00Z",
  people: 120,
  people_prev: 100,
  devices: 210,
  sessions: 640,
  sessions_prev: 700,
  dau: 30,
  wau: 80,
  mau: 120,
  stickiness_pct: 25,
  median_session_seconds: 420,
  screens_per_session: 4.5,
  engaged_minutes_per_person: 38.5,
  error_session_pct: 3.1,
  offline_session_pct: 0.8,
  series: [
    {
      day: "2026-11-24",
      users: 20,
      devices: 30,
      sessions: 50,
      engaged_minutes: 300,
    },
    {
      day: "2026-11-25",
      users: 25,
      devices: 35,
      sessions: 60,
      engaged_minutes: 360,
    },
  ],
  platforms: [
    {
      key: "ios",
      devices: 90,
      users: 70,
      sessions: 300,
      engaged_minutes: 2000,
      share_pct: 46.9,
    },
    {
      key: "windows",
      devices: 30,
      users: 25,
      sessions: 120,
      engaged_minutes: 900,
      share_pct: 18.8,
    },
  ],
  form_factors: [
    {
      key: "phone",
      devices: 100,
      users: 80,
      sessions: 340,
      engaged_minutes: 2100,
      share_pct: 53.1,
    },
  ],
  versions: [{ platform: "ios", app_version: "1.4.2", devices: 80 }],
  screens: [{ route: "/dashboard", views: 900, people: 110, avg_seconds: 75 }],
  features: [
    { key: "cv_upload", kind: "feature", uses: 40, people: 38 },
    { key: "nav.companies", kind: "interaction", uses: 300, people: 90 },
  ],
  errors: [
    {
      kind: "typeerror",
      route: "/session/:id",
      count: 12,
      devices: 5,
      last_seen: "2026-11-25T10:00:00Z",
    },
  ],
  load: [{ platform: "ios", p50_ms: 1800, p95_ms: 4200, samples: 400 }],
  retention: [
    { day: 1, cohort: 50, returned: 20, pct: 40 },
    { day: 7, cohort: 30, returned: 9, pct: 30 },
    { day: 30, cohort: 0, returned: 0, pct: null },
  ],
  ...over,
});

describe("admin console: engagement", () => {
  it("shows who is active, where, what they use and what breaks, across devices", async () => {
    mockApi({
      ...staff,
      "GET /api/admin/engagement": () => ({ json: data() }),
    });
    renderApp(<App />, "/admin/engagement");
    const nums = within(await screen.findByLabelText("Engagement numbers"));
    expect(nums.getByText("120")).toBeInTheDocument(); // people active
    expect(nums.getByText("7 min 0 s")).toBeInTheDocument(); // a typical visit
    expect(nums.getByText("38.5 min")).toBeInTheDocument();
    expect(screen.getAllByText("iPhone app").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Windows app").length).toBeGreaterThan(0);
    expect(screen.getByText("Phone")).toBeInTheDocument();
    expect(screen.getByText("Day 1")).toBeInTheDocument();
    expect(screen.getByText("20 of 50 people")).toBeInTheDocument();
    expect(screen.getByText("too early to say")).toBeInTheDocument();
    const feats = within(screen.getByRole("table", { name: "Features" }));
    expect(feats.getByText("cv_upload")).toBeInTheDocument();
    expect(feats.getByText("Button")).toBeInTheDocument();
    const errs = within(
      screen.getByRole("table", { name: "Interface errors" }),
    );
    expect(errs.getByText("typeerror")).toBeInTheDocument();
    expect(screen.getByText("1.8 s", { exact: false })).toBeInTheDocument();
    // a link in the sidebar leads here
    expect(
      within(
        screen.getByRole("navigation", { name: "Admin sections" }),
      ).getByRole("link", { name: "Engagement" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("says so plainly before anything has been recorded", async () => {
    mockApi({
      ...staff,
      "GET /api/admin/engagement": () => ({
        json: data({
          has_data: false,
          data_since: null,
          people: 0,
          series: [],
        }),
      }),
    });
    renderApp(<App />, "/admin/engagement");
    expect(
      await screen.findByText(/nothing recorded yet/i),
    ).toBeInTheDocument();
  });

  it("asks again for another window", async () => {
    const calls = mockApi({
      ...staff,
      "GET /api/admin/engagement": () => ({ json: data() }),
    });
    renderApp(<App />, "/admin/engagement");
    await screen.findByLabelText("Engagement numbers");
    await userEvent.selectOptions(screen.getByRole("combobox"), "7");
    await screen.findByLabelText("Engagement numbers");
    expect(
      calls.filter((c) => c.key === "GET /api/admin/engagement").length,
    ).toBeGreaterThan(1);
  });
});
