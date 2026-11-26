import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import { mockApi, renderApp, stubSupportedBrowser } from "../../test-utils";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

const row = (over: object = {}) => ({
  id: "t1",
  subject: "My CV will not upload",
  category: "bug",
  status: "open",
  unread: true,
  user_id: "u1",
  user_email: "ada@example.com",
  user_name: "Ada Okoye",
  platform: "desktop",
  created_at: "2026-11-26T09:00:00Z",
  updated_at: "2026-11-26T09:00:00Z",
  last_message: "It says it could not read the file.",
  messages: 1,
  ...over,
});
const detail = (over: object = {}) => ({
  ...row(),
  context: { platform: "desktop", app_version: "1.4.0", page: "/settings/cv" },
  user_joined: "2026-10-01T09:00:00Z",
  assigned_to: null,
  thread: [
    {
      id: "m1",
      kind: "user",
      author: "Ada Okoye",
      body: "It says it could not read the file.",
      created_at: "2026-11-26T09:00:00Z",
    },
    {
      id: "m2",
      kind: "note",
      author: "Boss",
      body: "Looks like a scanned PDF.",
      created_at: "2026-11-26T09:30:00Z",
    },
  ],
  ...over,
});
const base = (routes: Record<string, () => object> = {}) =>
  mockApi({
    "GET /api/admin/auth/me": () => ({
      json: { email: "boss@example.com", full_name: null },
    }),
    "GET /api/billing": () => ({ status: 404, json: {} }),
    "GET /api/admin/support": () => ({
      json: {
        items: [row()],
        counts: { open: 3, answered: 1, resolved: 2, closed: 0 },
      },
    }),
    ...routes,
  });

describe("Back office: support", () => {
  it("lists what people wrote, with the number waiting on a reply in the menu", async () => {
    base();
    renderApp(<App />, "/admin/support");
    const link = await screen.findByRole("link", {
      name: /My CV will not upload/,
    });
    expect(link).toHaveAttribute("href", "/admin/support/t1");
    expect(within(link).getByText("Needs a reply")).toBeInTheDocument();
    expect(
      within(link).getByText(/ada@example.com · desktop/),
    ).toBeInTheDocument();
    const nav = within(
      screen.getByRole("navigation", { name: "Admin sections" }),
    );
    expect(nav.getByText(/3 need a reply/)).toBeInTheDocument();
  });

  it("shows the whole conversation with where it was sent from, including private notes", async () => {
    base({ "GET /api/admin/support/t1": () => ({ json: detail() }) });
    renderApp(<App />, "/admin/support/t1");
    const msgs = within(await screen.findByRole("list", { name: "Messages" }));
    expect(msgs.getByText("Looks like a scanned PDF.")).toBeInTheDocument();
    expect(msgs.getByText(/Private note/)).toBeInTheDocument();
    expect(
      screen.getByText(/desktop · v1.4.0 · from \/settings\/cv/),
    ).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /ada@example.com/ });
    expect(
      links.some((l) => l.getAttribute("href") === "/admin/users/u1"),
    ).toBe(true);
  });

  it("replies to the person, saves a private note, and changes the status", async () => {
    const calls = base({
      "GET /api/admin/support/t1": () => ({ json: detail() }),
      "POST /api/admin/support/t1/reply": () => ({
        status: 201,
        json: detail({ status: "answered" }),
      }),
      "POST /api/admin/support/t1/note": () => ({
        status: 201,
        json: detail(),
      }),
      "POST /api/admin/support/t1/status": () => ({
        json: detail({ status: "resolved" }),
      }),
    });
    renderApp(<App />, "/admin/support/t1");
    const box = await screen.findByLabelText("Your reply");
    await userEvent.type(box, "Export it as a PDF and retry.");
    await userEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.key === "POST /api/admin/support/t1/reply")?.body,
      ).toEqual({
        body: "Export it as a PDF and retry.",
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Private note" }));
    await userEvent.type(
      screen.getByLabelText("Your note"),
      "Told them about PDFs.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.key === "POST /api/admin/support/t1/note"),
      ).toBe(true),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Mark resolved" }),
    );
    await waitFor(() =>
      expect(
        calls.find((c) => c.key === "POST /api/admin/support/t1/status")?.body,
      ).toEqual({
        status: "resolved",
      }),
    );
  });
});
