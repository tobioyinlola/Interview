import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ME, mockApi, renderApp, stubSupportedBrowser } from "../test-utils";
import { App } from "./App";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

const signedIn = (me: object = ME) =>
  mockApi({
    "GET /api/me": () => ({ json: me }),
    "GET /api/notes": () => ({
      json: { role: "", content: "", updated_at: null },
    }),
    "GET /api/companies": () => ({ json: [] }),
    "GET /api/sessions": () => ({ json: { items: [], next_cursor: null } }),
  });

describe("app shell", () => {
  it("groups navigation into Menu, Account and Support and marks the current page", async () => {
    signedIn();
    renderApp(<App />, "/dashboard");
    const nav = within(await screen.findByRole("navigation", { name: "Main" }));
    for (const name of [
      "Overview",
      "CV",
      "Companies",
      "Practice",
      "Sessions",
      "Settings",
      "Privacy",
      "Terms",
    ]) {
      expect(nav.getByRole("link", { name })).toBeInTheDocument();
    }
    for (const group of ["Menu", "Account", "Support"])
      expect(nav.getByText(group)).toBeInTheDocument();
    expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(nav.getByRole("link", { name: "CV" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("shows the Usage link to administrators only", async () => {
    signedIn();
    const { unmount } = renderApp(<App />, "/dashboard");
    await screen.findByRole("navigation", { name: "Main" });
    expect(screen.queryByRole("link", { name: "Usage" })).toBeNull();
    unmount();
    vi.restoreAllMocks();
    stubSupportedBrowser();
    signedIn({ ...ME, is_admin: true });
    renderApp(<App />, "/dashboard");
    expect(await screen.findByRole("link", { name: "Usage" })).toHaveAttribute(
      "href",
      "/admin/usage",
    );
  });

  it("opens and closes the menu on small screens", async () => {
    signedIn();
    renderApp(<App />, "/dashboard");
    const toggle = await screen.findByRole("button", { name: "Open menu" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Close menu" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await userEvent.click(screen.getByRole("link", { name: "CV" }));
    expect(
      await screen.findByRole("button", { name: "Open menu" }),
    ).toBeInTheDocument(); // closed on navigation
  });

  it("shows who is signed in and a sign-out button", async () => {
    signedIn();
    renderApp(<App />, "/dashboard");
    expect(await screen.findByText("me@example.com")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
  });
});

describe("collapsible sidebar", () => {
  beforeEach(() => localStorage.removeItem("meet-practice-sidebar-collapsed"));

  it("collapses to icons and expands again, keeping every link reachable by name", async () => {
    signedIn();
    renderApp(<App />, "/dashboard");
    const side = (
      await screen.findByRole("navigation", { name: "Main" })
    ).closest("aside") as HTMLElement;
    expect(side.className).toMatch(/lg:w-64/);
    await userEvent.click(
      screen.getByRole("button", { name: "Collapse sidebar" }),
    );
    expect(side.className).toMatch(/lg:w-\[84px\]/);
    const expand = screen.getByRole("button", { name: "Expand sidebar" });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    // the names are still there for screen readers and as tooltips
    const nav = within(screen.getByRole("navigation", { name: "Main" }));
    expect(nav.getByRole("link", { name: "Companies" })).toHaveAttribute(
      "title",
      "Companies",
    );
    expect(nav.getByRole("link", { name: "Overview" })).toBeInTheDocument();
    await userEvent.click(expand);
    expect(side.className).toMatch(/lg:w-64/);
    expect(
      screen.getByRole("button", { name: "Collapse sidebar" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("remembers the choice for next time", async () => {
    signedIn();
    const { unmount } = renderApp(<App />, "/dashboard");
    await userEvent.click(
      await screen.findByRole("button", { name: "Collapse sidebar" }),
    );
    expect(localStorage.getItem("meet-practice-sidebar-collapsed")).toBe("1");
    unmount();
    vi.restoreAllMocks();
    stubSupportedBrowser();
    signedIn();
    renderApp(<App />, "/dashboard");
    expect(
      await screen.findByRole("button", { name: "Expand sidebar" }),
    ).toBeInTheDocument();
  });

  it("still works when the browser will not store the choice", async () => {
    signedIn();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderApp(<App />, "/dashboard");
    await userEvent.click(
      await screen.findByRole("button", { name: "Collapse sidebar" }),
    );
    expect(
      screen.getByRole("button", { name: "Expand sidebar" }),
    ).toBeInTheDocument();
  });
});
