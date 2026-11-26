import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import { ME, mockApi, renderApp, stubSupportedBrowser } from "../../test-utils";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

const me = { ...ME, onboarded: true, tour_done: true };
const ticket = (over: object = {}) => ({
  id: "t1",
  subject: "My CV will not upload",
  category: "bug",
  status: "answered",
  unread: true,
  created_at: "2026-11-26T09:00:00Z",
  updated_at: "2026-11-26T10:00:00Z",
  last_message: "Export it as a PDF and retry.",
  ...over,
});
const detail = (over: object = {}) => ({
  ...ticket(),
  messages: [
    {
      id: "m1",
      kind: "user",
      author: "You",
      body: "It says it could not read the file.",
      created_at: "2026-11-26T09:00:00Z",
    },
    {
      id: "m2",
      kind: "staff",
      author: "Support team",
      body: "Export it as a PDF and retry.",
      created_at: "2026-11-26T10:00:00Z",
    },
  ],
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
    "GET /api/support/unread": () => ({ json: { count: 1 } }),
    ...routes,
  });

describe("Support", () => {
  it("shows an unread badge in the menu and lists the conversations", async () => {
    base({
      "GET /api/support/tickets": () => ({ json: { items: [ticket()] } }),
    });
    renderApp(<App />, "/support");
    const nav = within(await screen.findByRole("navigation", { name: "Main" }));
    expect(await nav.findByText(/1 new/)).toBeInTheDocument();
    const list = await screen.findByRole("link", {
      name: /My CV will not upload/,
    });
    expect(list).toHaveAttribute("href", "/support/t1");
    expect(within(list).getByText("We replied")).toBeInTheDocument();
    expect(
      within(list).getByRole("img", { name: "New reply" }),
    ).toBeInTheDocument();
  });

  it("sends a message with the app and page it came from, then opens the conversation", async () => {
    const calls = base({
      "GET /api/support/tickets": () => ({ json: { items: [] } }),
      "POST /api/support/tickets": () => ({
        status: 201,
        json: detail({ status: "open", unread: false }),
      }),
      "GET /api/support/tickets/t1": () => ({ json: detail() }),
    });
    renderApp(<App />, "/support");
    await userEvent.selectOptions(
      await screen.findByLabelText("What is it about?"),
      "bug",
    );
    const send = screen.getByRole("button", { name: "Send message" });
    expect(send).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText("Subject"),
      "My CV will not upload",
    );
    await userEvent.type(
      screen.getByLabelText("Message"),
      "It says it could not read.",
    );
    await userEvent.click(send);
    await screen.findByRole("heading", { name: "My CV will not upload" });
    const post = calls.find((c) => c.key === "POST /api/support/tickets");
    expect(post?.body).toMatchObject({
      subject: "My CV will not upload",
      category: "bug",
      context: { platform: "web" },
    });
  });

  it("shows the conversation and sends a reply", async () => {
    const calls = base({
      "GET /api/support/tickets/t1": () => ({ json: detail() }),
      "POST /api/support/tickets/t1/messages": () => ({
        status: 201,
        json: detail(),
      }),
    });
    renderApp(<App />, "/support/t1");
    const msgs = within(await screen.findByRole("list", { name: "Messages" }));
    expect(msgs.getByText(/Support team ·/)).toBeInTheDocument();
    expect(msgs.getByText("Export it as a PDF and retry.")).toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText("Add to this conversation"),
      "Thanks, that worked.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.key === "POST /api/support/tickets/t1/messages")
          ?.body,
      ).toEqual({ body: "Thanks, that worked." }),
    );
  });

  it("lets the person say it is sorted out", async () => {
    const calls = base({
      "GET /api/support/tickets/t1": () => ({ json: detail() }),
      "POST /api/support/tickets/t1/resolve": () => ({
        json: detail({ status: "resolved" }),
      }),
    });
    renderApp(<App />, "/support/t1");
    await userEvent.click(
      await screen.findByRole("button", { name: "This is sorted out" }),
    );
    await waitFor(() =>
      expect(
        calls.some((c) => c.key === "POST /api/support/tickets/t1/resolve"),
      ).toBe(true),
    );
  });

  it("is reachable from Help", async () => {
    base();
    renderApp(<App />, "/help");
    expect(
      await screen.findByRole("link", { name: "Write to support" }),
    ).toHaveAttribute("href", "/support");
  });
});
