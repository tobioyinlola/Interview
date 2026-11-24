import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import { ME, mockApi, renderApp, stubSupportedBrowser } from "../../test-utils";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

const me = { ...ME, onboarded: true, tour_done: true, startup_outreach: true };
const settings = {
  enabled: false,
  regions: ["us"],
  roles: ["Senior Product Manager"],
  pitch: "",
  daily_cap: 8,
  auto_send: false,
  sender_name: "Ada Okoye",
  postal_address: "",
  mailbox: "ada@example.com",
  ready: ["Add a postal address (required on commercial email)"],
  prefilled: true,
  paused: false,
};
const target = {
  id: "t1",
  startup: "Acme",
  website: "https://acme.io",
  one_liner: "Payments for marketplaces",
  region: "us",
  contact: "jobs@acme.io",
  contact_kind: "role",
  contact_source: "https://acme.io/careers",
  careers_url: "https://acme.io/careers",
  openings: [
    { title: "Senior Product Manager", url: "https://acme.io/careers/pm" },
  ],
  fit: 65,
  fit_reasons: ["They list a Senior Product Manager opening."],
  step: 1,
  subject: "Senior PM, payments",
  body: "Hi, I led payments.",
  status: "drafted",
  reason: null,
  sent_at: null,
};

const routes = (extra: Record<string, () => object> = {}) =>
  mockApi({
    "GET /api/me": () => ({ json: me }),
    "GET /api/billing": () => ({ status: 404, json: {} }),
    "GET /api/notes": () => ({
      json: { role: "", content: "x", updated_at: null },
    }),
    "GET /api/companies": () => ({ json: [] }),
    "GET /api/sessions": () => ({ json: { items: [], next_cursor: null } }),
    "GET /api/hunt/settings": () => ({ json: settings }),
    "GET /api/hunt/targets": () => ({ json: [target] }),
    ...extra,
  });

describe("Startups inside Auto-Apply", () => {
  it("starts on the setup steps when it is not set up, then walks through them", async () => {
    routes();
    renderApp(<App />, "/auto-apply/startups");
    expect(await screen.findByText(/Step 1 of 3/)).toBeVisible();
    expect(screen.getByDisplayValue("Senior Product Manager")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/Step 2 of 3/)).toBeVisible();
    // the next step needs a postal address before it lets you go on
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText(/Postal address/),
      "12 Marina, Lagos",
    );
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/Step 3 of 3/)).toBeVisible();
  });

  it("shows both the careers page and the email pitch on a card, and approves it", async () => {
    const approve = vi.fn(() => ({ json: { ...target, status: "approved" } }));
    routes({
      "GET /api/hunt/settings": () => ({
        json: { ...settings, enabled: true, ready: [] },
      }),
      "POST /api/hunt/targets/t1/approve": approve,
    });
    renderApp(<App />, "/auto-apply/startups");
    expect(await screen.findByText("1 · Careers page")).toBeVisible();
    expect(screen.getByText("2 · Email pitch")).toBeVisible();
    expect(screen.getByRole("link", { name: "View role" })).toHaveAttribute(
      "href",
      "https://acme.io/careers/pm",
    );
    expect(screen.getByText("jobs@acme.io")).toBeVisible();
    expect(screen.getByText(/Your CV is attached as a PDF/)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Send pitch" }));
    await waitFor(() => expect(approve).toHaveBeenCalled());
  });

  it("adds an opening to Auto-Apply", async () => {
    const add = vi.fn(() => ({ status: 201, json: {} }));
    routes({
      "GET /api/hunt/settings": () => ({
        json: { ...settings, enabled: true, ready: [] },
      }),
      "POST /api/autoapply/jobs": add,
    });
    renderApp(<App />, "/auto-apply/startups");
    await userEvent.click(
      await screen.findByRole("button", { name: "Add to Auto-Apply" }),
    );
    await waitFor(() => expect(add).toHaveBeenCalled());
  });

  it("shows the Jobs and Startups tabs only when the feature is on", async () => {
    routes({
      "GET /api/me": () => ({ json: { ...me, startup_outreach: false } }),
    });
    renderApp(<App />, "/auto-apply/startups");
    await screen.findByRole("heading", { name: "Startups" });
    expect(
      screen.queryByRole("navigation", { name: "Auto-Apply sections" }),
    ).toBeNull();
  });

  it("the old address still works", async () => {
    routes();
    renderApp(<App />, "/startups");
    expect(
      await screen.findByRole("heading", { name: "Startups" }),
    ).toBeVisible();
  });
});
