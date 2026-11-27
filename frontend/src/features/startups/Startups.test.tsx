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

const template = {
  use_template: false,
  first_subject: "",
  first_body: "",
  follow_subject: "",
  follow_body: "",
  variables: {},
  follow_up_enabled: true,
  follow_up_days: 5,
  send_not_before: null,
  window_start: 8,
  window_end: 18,
  builtin: { company: "The startup's name", first_name: "First name" },
  starter: {
    first_subject: "{{role}} interested in {{company}}",
    first_body: "Hi {{first_name}}, I like {{company}}. {{portfolio_link}}",
    follow_subject: "Re: {{role}} interested in {{company}}",
    follow_body: "Following up. {{portfolio_link}}",
  },
  unknown: [],
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
    "GET /api/hunt/template": () => ({ json: template }),
    "GET /api/hunt/targets": () => ({ json: [target] }),
    "GET /api/hunt/delivery": () => ({ json: { approved: 0, blockers: [] } }),
    ...extra,
  });

describe("Startups inside Auto-Apply", () => {
  it("asks anyone with outreach who has not set up their emails to do it, and Later hides it", async () => {
    localStorage.clear();
    routes();
    renderApp(<App />, "/notes");
    const ask = await screen.findByRole("dialog", {
      name: "Set up your cold emails",
    });
    expect(
      within(ask).getByRole("link", { name: "Set it up" }),
    ).toHaveAttribute("href", "/startups?tab=emails");
    await userEvent.click(within(ask).getByRole("button", { name: "Later" }));
    expect(
      screen.queryByRole("dialog", { name: "Set up your cold emails" }),
    ).toBeNull();
  });

  it("does not ask people who are not let in, or who already turned their emails on", async () => {
    localStorage.clear();
    routes({
      "GET /api/me": () => ({ json: { ...me, outreach_access: "none" } }),
    });
    const a = renderApp(<App />, "/notes");
    await screen.findAllByText(/CV|notes/i);
    expect(
      screen.queryByRole("dialog", { name: "Set up your cold emails" }),
    ).toBeNull();
    a.unmount();
    routes({
      "GET /api/hunt/template": () => ({
        json: { ...template, use_template: true, first_body: "Hi" },
      }),
    });
    renderApp(<App />, "/notes");
    await screen.findAllByText(/CV|notes/i);
    expect(
      screen.queryByRole("dialog", { name: "Set up your cold emails" }),
    ).toBeNull();
  });

  it("turns outreach on from the emails tab with Save and turn on", async () => {
    localStorage.clear();
    const saveT = vi.fn((...args: unknown[]) => ({
      json: { ...template, ...(args[0] as { body: object }).body },
    }));
    const saveS = vi.fn((...args: unknown[]) => ({
      json: { ...settings, ...(args[0] as { body: object }).body },
    }));
    routes({
      "GET /api/hunt/settings": () => ({
        json: { ...settings, ready: [], postal_address: "12 Marina" },
      }),
      "PUT /api/hunt/template": saveT,
      "PUT /api/hunt/settings": saveS,
    });
    renderApp(<App />, "/startups?tab=emails");
    await userEvent.click(
      await screen.findByRole("button", { name: "Start from an example" }),
    );
    await userEvent.click(
      screen.getByRole("switch", {
        name: "Send automatically at the times above",
      }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save and turn on" }),
    );
    await waitFor(() => expect(saveS).toHaveBeenCalled());
    expect(
      (saveT.mock.calls[0][0] as { body: Record<string, unknown> }).body,
    ).toMatchObject({ use_template: true });
    expect(
      (saveS.mock.calls[0][0] as { body: Record<string, unknown> }).body,
    ).toMatchObject({ enabled: true, auto_send: true });
    expect(await screen.findByText(/Turned on/)).toBeVisible();
  });

  it("lets you write your own emails, set your details and timing, preview and save", async () => {
    const save = vi.fn((...args: unknown[]) => ({
      json: {
        ...template,
        ...(args[0] as { body: object }).body,
        unknown: [],
      },
    }));
    const preview = vi.fn(() => ({
      json: {
        subject: "Senior PM interested in Acme",
        body: "Hi Sam, I like Acme. https://me.example",
        company: "Acme",
        missing: [],
      },
    }));
    routes({
      "GET /api/hunt/settings": () => ({
        json: { ...settings, enabled: true, ready: [] },
      }),
      "PUT /api/hunt/template": save,
      "POST /api/hunt/template/preview": preview,
    });
    renderApp(<App />, "/startups");
    await userEvent.click(await screen.findByRole("radio", { name: "Emails" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Start from an example" }),
    );
    expect(screen.getByDisplayValue(/I like \{\{company\}\}/)).toBeVisible();
    await userEvent.type(
      screen.getByLabelText("Detail value"),
      "https://me.example",
    );
    await userEvent.click(
      screen.getAllByRole("button", { name: "Preview this email" })[0],
    );
    expect(
      await screen.findByText("Senior PM interested in Acme"),
    ).toBeVisible();
    const days = screen.getByLabelText("Days before the follow-up");
    await userEvent.clear(days);
    await userEvent.type(days, "7");
    await userEvent.click(
      screen.getByRole("switch", { name: "Use my own emails" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    const sent = (save.mock.calls[0][0] as { body: Record<string, unknown> })
      .body;
    expect(sent).toMatchObject({
      use_template: true,
      follow_up_days: 7,
      variables: { portfolio_link: "https://me.example" },
    });
  });

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

  it("sends someone with no email connected to Settings to connect it, and back once it is", async () => {
    let connected = false;
    const connect = vi.fn(() => {
      connected = true;
      return {
        json: { ...mailbox, connected: true, smtp_providers: viaPassword },
      };
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
    // not the startups page: Settings, on the Email tab, with a way back
    expect(
      await screen.findByRole("heading", { name: "Your email" }),
    ).toBeVisible();
    expect(screen.getByText(/Connect an email to carry on/)).toBeVisible();
    expect(screen.queryByText(/Auto outreach to/)).toBeNull();
    const go = screen.getByRole("button", { name: "Connect" });
    expect(go).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText("App password"),
      "abcd efgh ijkl mnop",
    );
    expect(go).toBeEnabled();
    await userEvent.click(go);
    await waitFor(() => expect(connect).toHaveBeenCalled());
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          provider: "gmail",
          address: "me@example.com",
          password: "abcd efgh ijkl mnop",
        },
      }),
    );
    const done = await screen.findByLabelText("Email connected");
    expect(within(done).getByText("ada@example.com")).toBeVisible();
    await userEvent.click(
      within(done).getByRole("link", { name: "Continue to startup outreach" }),
    );
    expect(await screen.findByText(/Step 1 of 3/)).toBeVisible(); // now the outreach itself
  });

  it("shows why a wrong app password was refused", async () => {
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
      "POST /api/autoapply/mailbox/connect-smtp": () => ({
        status: 422,
        json: {
          error: {
            code: "mailbox_rejected",
            message:
              "Gmail or Google Workspace did not accept that address and app password.",
          },
        },
      }),
    });
    renderApp(<App />, "/settings/email?next=/startups");
    await userEvent.type(
      await screen.findByLabelText("App password"),
      "wrongwrongwrongwr",
    );
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /did not accept that address and app password/,
    );
  });

  it("asks to connect again when the saved sign-in stopped working", async () => {
    routes({
      "GET /api/autoapply/mailbox": () => ({
        json: {
          ...mailbox,
          connected: true,
          status: "reauth_needed",
          smtp_providers: viaPassword,
        },
      }),
    });
    renderApp(<App />, "/settings/email?next=/startups");
    expect(
      await screen.findByText("Needs to be connected again"),
    ).toBeVisible();
    expect(screen.getByLabelText("App password")).toBeVisible(); // the form is open
    expect(
      screen.queryByRole("link", { name: "Continue to startup outreach" }),
    ).toBeNull(); // not until it works
  });

  it("offers the Google button, and no app password form, when app passwords are not on", async () => {
    routes({
      "GET /api/autoapply/mailbox": () => ({
        json: { ...mailbox, connected: false, address: null, status: null },
      }),
    });
    renderApp(<App />, "/settings/email");
    expect(
      await screen.findByRole("button", { name: "Connect Gmail" }),
    ).toBeVisible();
    expect(screen.queryByLabelText("App password")).toBeNull();
  });

  it("shows what is connected in Settings, with Disconnect and a way to use another", async () => {
    const disconnect = vi.fn(() => ({
      json: { ...mailbox, connected: false, status: "disconnected" },
    }));
    routes({
      "GET /api/autoapply/mailbox": () => ({
        json: { ...mailbox, smtp_providers: viaPassword },
      }),
      "POST /api/autoapply/mailbox/disconnect": disconnect,
    });
    renderApp(<App />, "/settings/email");
    const card = await screen.findByLabelText("Email connected");
    expect(within(card).getByText("ada@example.com")).toBeVisible();
    expect(screen.queryByLabelText("App password")).toBeNull(); // not shown while it works
    await userEvent.click(
      within(card).getByRole("button", { name: "Use a different email" }),
    );
    expect(screen.getByLabelText("App password")).toBeVisible();
    await userEvent.click(
      within(card).getByRole("button", { name: "Disconnect" }),
    );
    await waitFor(() => expect(disconnect).toHaveBeenCalled());
  });

  it("no longer connects or disconnects on the startups page itself, but says where to", async () => {
    routes({
      "GET /api/hunt/settings": () => ({
        json: { ...settings, enabled: true, ready: [] },
      }),
    });
    renderApp(<App />, "/startups");
    expect(await screen.findByText("ada@example.com")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
    expect(screen.getByRole("link", { name: "Change email" })).toHaveAttribute(
      "href",
      "/settings/email",
    );
  });

  it("only ever sends someone back to a page it knows", async () => {
    routes({
      "GET /api/autoapply/mailbox": () => ({
        json: { ...mailbox, smtp_providers: viaPassword },
      }),
    });
    renderApp(<App />, "/settings/email?next=https://evil.example/x");
    await screen.findByLabelText("Email connected");
    expect(screen.queryByRole("link", { name: /Continue to/ })).toBeNull();
  });

  it("says why approved notes are waiting, and where to fix it, instead of holding them in silence", async () => {
    routes({
      "GET /api/hunt/settings": () => ({
        json: { ...settings, enabled: true, ready: [] },
      }),
      "GET /api/hunt/delivery": () => ({
        json: {
          approved: 2,
          blockers: [
            {
              code: "address",
              text: "Add a postal address under Set up. Commercial email must carry one.",
              where: "setup",
            },
            {
              code: "reauth",
              text: "Your email needs to be connected again, in Settings.",
              where: "email",
            },
          ],
        },
      }),
    });
    renderApp(<App />, "/startups");
    const why = await screen.findByRole("status", {
      name: "Why your notes are waiting",
    });
    expect(
      within(why).getByText(/2 approved notes are not going out yet/),
    ).toBeVisible();
    expect(
      within(why).getByText(/Add a postal address under Set up/),
    ).toBeVisible();
    expect(
      within(why).getByRole("link", { name: "Open Settings" }),
    ).toHaveAttribute("href", "/settings/email?next=/startups");
    await userEvent.click(
      within(why).getByRole("button", { name: "Open Set up" }),
    );
    expect(await screen.findByText(/Step 1 of 3/)).toBeVisible();
  });

  it("does not promise 'Sending soon' for an approved note that something is holding back", async () => {
    const approved = { ...target, status: "approved" };
    const held = {
      approved: 1,
      blockers: [
        {
          code: "allowlist",
          text: "Only the test list is written to.",
          where: "",
        },
      ],
    };
    routes({
      "GET /api/hunt/settings": () => ({
        json: { ...settings, enabled: true, ready: [] },
      }),
      "GET /api/hunt/targets": () => ({ json: [approved] }),
      "GET /api/hunt/delivery": () => ({ json: held }),
    });
    renderApp(<App />, "/startups");
    await userEvent.click(await screen.findByRole("radio", { name: "Sent" }));
    expect(await screen.findByText("Held back")).toBeVisible();
    expect(screen.queryByText("Sending soon")).toBeNull();
  });

  it("says 'Sending soon' for an approved note when nothing is in the way", async () => {
    routes({
      "GET /api/hunt/settings": () => ({
        json: { ...settings, enabled: true, ready: [] },
      }),
      "GET /api/hunt/targets": () => ({
        json: [{ ...target, status: "approved" }],
      }),
    });
    renderApp(<App />, "/startups");
    await userEvent.click(await screen.findByRole("radio", { name: "Sent" }));
    expect(await screen.findByText("Sending soon")).toBeVisible();
  });

  it("says nothing when nothing is waiting or nothing is in the way", async () => {
    routes({
      "GET /api/hunt/settings": () => ({
        json: { ...settings, enabled: true, ready: [] },
      }),
    });
    renderApp(<App />, "/startups");
    await screen.findByText("ada@example.com");
    expect(
      screen.queryByRole("status", { name: "Why your notes are waiting" }),
    ).toBeNull();
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
