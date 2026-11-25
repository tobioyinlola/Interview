import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import { AccessToast } from "./AccessToast";
import { ME, mockApi, renderApp, stubSupportedBrowser } from "../../test-utils";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

const me = {
  ...ME,
  onboarded: true,
  tour_done: true,
  startup_outreach: true,
  outreach_access: "active",
};
const mailbox = {
  connected: true,
  address: "ada@example.com",
  status: "connected",
  can_connect: true,
  smtp_providers: [],
};
const viaPassword = [
  { id: "gmail", label: "Gmail or Google Workspace", help: "" },
];
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
    "GET /api/autoapply/mailbox": () => ({ json: mailbox }),
    "GET /api/hunt/reach": () => ({
      json: { companies: 1234, label: "over 1,000" },
    }),
    "GET /api/hunt/settings": () => ({ json: settings }),
    "GET /api/hunt/targets": () => ({ json: [target] }),
    ...extra,
  });

describe("Startups inside Auto-Apply", () => {
  it("starts on the setup steps when it is not set up, then walks through them", async () => {
    routes();
    renderApp(<App />, "/startups");
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
    renderApp(<App />, "/startups");
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
    renderApp(<App />, "/startups");
    await userEvent.click(
      await screen.findByRole("button", { name: "Add to Auto-Apply" }),
    );
    await waitFor(() => expect(add).toHaveBeenCalled());
  });

  it("is by invitation: someone not let in can ask, once", async () => {
    const ask = vi.fn(() => ({ json: { access: "requested" } }));
    routes({
      "GET /api/me": () => ({ json: { ...me, outreach_access: "none" } }),
      "POST /api/hunt/access/request": ask,
    });
    renderApp(<App />, "/startups");
    expect(
      await screen.findByText("Startup outreach is by invitation"),
    ).toBeVisible();
    expect(screen.queryByText(/Step 1 of 3/)).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Request access" }),
    );
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Your request is in")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Request access" })).toBeNull();
  });

  it("shows a request that is waiting for the operator", async () => {
    routes({
      "GET /api/me": () => ({ json: { ...me, outreach_access: "requested" } }),
    });
    renderApp(<App />, "/startups");
    expect(await screen.findByText("Your request is in")).toBeVisible();
  });

  it("says what it does with the real number of companies, above everything else", async () => {
    routes();
    renderApp(<App />, "/startups");
    expect(
      await screen.findByRole("heading", {
        name: "Auto outreach to over 1,000 companies that need you",
      }),
    ).toBeVisible();
  });

  it("is honest when the count is small or not known yet", async () => {
    routes({
      "GET /api/hunt/reach": () => ({ json: { companies: 3, label: "3" } }),
    });
    renderApp(<App />, "/startups");
    expect(
      await screen.findByRole("heading", {
        name: "Auto outreach to companies that need you",
      }),
    ).toBeVisible();
  });

  it("shows the Gmail steps and the two fields, then confirms the connection", async () => {
    let connected = false;
    const connect = vi.fn(() => {
      connected = true;
      return { json: { ...mailbox, connected: true } };
    });
    routes({
      "GET /api/autoapply/mailbox": () => ({
        json: connected
          ? { ...mailbox, smtp_providers: viaPassword }
          : {
              ...mailbox,
              connected: false,
              address: null,
              status: null,
              smtp_providers: viaPassword,
            },
      }),
      "POST /api/autoapply/mailbox/connect-smtp": connect,
    });
    renderApp(<App />, "/startups");
    expect(
      await screen.findByRole("heading", {
        name: "Connect your Gmail to start sending",
      }),
    ).toBeVisible();
    expect(screen.getByText("Turn on 2-Step Verification")).toBeVisible();
    expect(screen.getByText("Make an app password")).toBeVisible();
    expect(screen.getByRole("link", { name: "App passwords" })).toHaveAttribute(
      "href",
      "https://myaccount.google.com/apppasswords",
    );
    expect(screen.queryByText(/Step 1 of 3/)).toBeNull();
    const go = screen.getByRole("button", { name: "Connect and confirm" });
    expect(go).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText("Gmail address"),
      "ada@gmail.com",
    );
    await userEvent.type(
      screen.getByLabelText("App password"),
      "abcd efgh ijkl mnop",
    );
    expect(go).toBeEnabled();
    await userEvent.click(go);
    await waitFor(() => expect(connect).toHaveBeenCalled());
    // confirmed, with the address, before going on
    const done = await screen.findByRole("region", { name: "Gmail connected" });
    expect(
      within(done).getByText("Gmail connected and confirmed"),
    ).toBeVisible();
    expect(within(done).getByText("ada@example.com")).toBeVisible();
    expect(within(done).getByText(/Nothing was sent/)).toBeVisible();
    await userEvent.click(
      within(done).getByRole("button", { name: "Continue" }),
    );
    expect(await screen.findByText(/Step 1 of 3/)).toBeVisible(); // now the outreach itself
  });

  it("sends the address and the password as typed, and shows why Google said no", async () => {
    const connect = vi.fn(() => ({
      status: 422,
      json: {
        error: {
          code: "mailbox_rejected",
          message:
            "Gmail or Google Workspace did not accept that address and app password.",
        },
      },
    }));
    routes({
      "GET /api/autoapply/mailbox": () => ({
        json: {
          ...mailbox,
          connected: false,
          address: null,
          status: null,
          smtp_providers: viaPassword,
        },
      }),
      "POST /api/autoapply/mailbox/connect-smtp": connect,
    });
    renderApp(<App />, "/startups");
    await userEvent.type(
      await screen.findByLabelText("Gmail address"),
      "ada@gmail.com",
    );
    await userEvent.type(
      screen.getByLabelText("App password"),
      "wrongwrongwrongwr",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Connect and confirm" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /did not accept that address and app password/,
    );
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          provider: "gmail",
          address: "ada@gmail.com",
          password: "wrongwrongwrongwr",
        },
      }),
    );
  });

  it("asks for a new app password when the old one stopped working", async () => {
    routes({
      "GET /api/autoapply/mailbox": () => ({
        json: {
          ...mailbox,
          connected: false,
          status: "reauth_needed",
          smtp_providers: viaPassword,
        },
      }),
    });
    renderApp(<App />, "/startups");
    expect(
      await screen.findByRole("heading", { name: "Reconnect your Gmail" }),
    ).toBeVisible();
  });

  it("falls back to the Google button when app passwords are not on", async () => {
    routes({
      "GET /api/autoapply/mailbox": () => ({
        json: { ...mailbox, connected: false, address: null, status: null },
      }),
    });
    renderApp(<App />, "/startups");
    expect(
      await screen.findByRole("heading", {
        name: "Connect your Gmail to start sending",
      }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Connect Gmail" })).toBeVisible();
    expect(screen.queryByLabelText("App password")).toBeNull();
  });

  it("shows a connected Gmail as confirmed on the page, and can check it again", async () => {
    const check = vi.fn(() => ({
      json: { ...mailbox, checked_at: "2026-11-25T10:00:00Z" },
    }));
    routes({
      "GET /api/hunt/settings": () => ({
        json: { ...settings, enabled: true, ready: [] },
      }),
      "POST /api/autoapply/mailbox/check": check,
    });
    renderApp(<App />, "/startups");
    const strip = await screen.findByRole("region", {
      name: "Gmail connected",
    });
    expect(within(strip).getByText("ada@example.com")).toBeVisible();
    await userEvent.click(
      within(strip).getByRole("button", { name: "Check again" }),
    );
    await waitFor(() => expect(check).toHaveBeenCalled());
    expect(await within(strip).findByText("Confirmed just now")).toBeVisible();
  });

  it("the old address still works", async () => {
    routes();
    renderApp(<App />, "/auto-apply/startups");
    expect(
      await screen.findByRole("heading", { name: /Auto outreach to/ }),
    ).toBeVisible();
  });
});

describe("the notice when access is granted", () => {
  afterEach(() => localStorage.clear());

  it("shows once when a waiting request becomes active", async () => {
    localStorage.setItem("im-outreach-access", "requested");
    mockApi({ "GET /api/me": () => ({ json: me }) });
    renderApp(<AccessToast />, "/dashboard");
    expect(
      await screen.findByText(/startup outreach is now open to you/i),
    ).toBeInTheDocument();
  });

  it("stays quiet for someone who was already in", async () => {
    localStorage.setItem("im-outreach-access", "active");
    mockApi({ "GET /api/me": () => ({ json: me }) });
    renderApp(<AccessToast />, "/dashboard");
    await waitFor(() =>
      expect(localStorage.getItem("im-outreach-access")).toBe("active"),
    );
    expect(screen.queryByText(/now open to you/i)).not.toBeInTheDocument();
  });
});
