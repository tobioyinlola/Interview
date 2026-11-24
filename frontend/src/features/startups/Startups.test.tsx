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

describe("Startup outreach", () => {
  it("shows what is missing and a note waiting for approval, with where the address came from", async () => {
    routes();
    renderApp(<App />, "/startups");
    expect(
      await screen.findByRole("heading", { name: "Startup outreach" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Still to do: Add a postal address/)).toBeVisible();
    expect(screen.getByText("jobs@acme.io")).toBeVisible();
    expect(screen.getByRole("link", { name: "here" })).toHaveAttribute(
      "href",
      "https://acme.io/careers",
    );
    expect(screen.getByText(/opening/)).toBeVisible();
  });

  it("approves a note", async () => {
    const approve = vi.fn(() => ({ json: { ...target, status: "approved" } }));
    routes({ "POST /api/hunt/targets/t1/approve": approve });
    renderApp(<App />, "/startups");
    await userEvent.click(
      await screen.findByRole("button", { name: "Approve and send" }),
    );
    await waitFor(() => expect(approve).toHaveBeenCalled());
  });

  it("offers the page in the menu only when the feature is on", async () => {
    routes({
      "GET /api/me": () => ({ json: { ...me, startup_outreach: false } }),
    });
    renderApp(<App />, "/dashboard");
    await screen.findAllByText(/Overview/);
    expect(screen.queryByRole("link", { name: /Startups/ })).toBeNull();
  });
});
