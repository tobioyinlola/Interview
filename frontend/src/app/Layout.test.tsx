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
      "Interview",
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

  it("shows the Admin console link to administrators only", async () => {
    signedIn();
    const { unmount } = renderApp(<App />, "/dashboard");
    await screen.findByRole("navigation", { name: "Main" });
    expect(screen.queryByRole("link", { name: "Admin console" })).toBeNull();
    unmount();
    vi.restoreAllMocks();
    stubSupportedBrowser();
    signedIn({ ...ME, is_admin: true });
    renderApp(<App />, "/dashboard");
    expect(
      await screen.findByRole("link", { name: "Admin console" }),
    ).toHaveAttribute("href", "/admin");
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

describe("top bar on every page", () => {
  const withName = { ...ME, full_name: "Jordan Reyes", onboarded: true };

  it.each(["/dashboard", "/notes", "/companies", "/sessions", "/settings"])(
    "has the search box and the account button on %s",
    async (path) => {
      signedIn(withName);
      renderApp(<App />, path);
      expect(await screen.findByRole("combobox")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Account menu for Jordan Reyes" }),
      ).toBeInTheDocument();
    },
  );

  it("no longer has a New practice button on the dashboard", async () => {
    signedIn(withName);
    renderApp(<App />, "/dashboard");
    await screen.findByRole("combobox");
    expect(screen.queryByRole("link", { name: "New practice" })).toBeNull();
  });

  it("shows the person's initials and first name on the button", async () => {
    signedIn(withName);
    renderApp(<App />, "/dashboard");
    const btn = await screen.findByRole("button", {
      name: /Account menu for Jordan Reyes/,
    });
    expect(btn).toHaveTextContent("JR");
    expect(btn).toHaveTextContent("Jordan");
  });

  it("opens a menu with the account links, and closes it with Escape, returning focus", async () => {
    signedIn(withName);
    renderApp(<App />, "/dashboard");
    const btn = await screen.findByRole("button", {
      name: /Account menu/,
    });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    const menu = within(screen.getByRole("menu", { name: "Account" }));
    expect(menu.getByText("Jordan Reyes")).toBeInTheDocument();
    expect(menu.getByText("me@example.com")).toBeInTheDocument();
    expect(menu.getByRole("menuitem", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(
      menu.getByRole("menuitem", { name: "Update my focus" }),
    ).toHaveAttribute("href", "/onboarding");
    expect(
      menu.getByRole("menuitem", { name: "Sign out" }),
    ).toBeInTheDocument();
    expect(menu.getByRole("menuitem", { name: "Settings" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(btn).toHaveFocus();
  });

  it("moves through the menu with the arrow keys and wraps around", async () => {
    signedIn(withName);
    renderApp(<App />, "/dashboard");
    await userEvent.click(
      await screen.findByRole("button", { name: /Account menu/ }),
    );
    const names = [
      "Settings",
      "Update my focus",
      "Help",
      "Privacy",
      "Terms",
      "Take the tour",
      "Sign out",
    ];
    for (const n of names.slice(1)) {
      await userEvent.keyboard("{ArrowDown}");
      expect(screen.getByRole("menuitem", { name: n })).toHaveFocus();
    }
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Settings" })).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toHaveFocus();
  });

  it("closes when you click elsewhere", async () => {
    signedIn(withName);
    renderApp(<App />, "/dashboard");
    await userEvent.click(
      await screen.findByRole("button", { name: /Account menu/ }),
    );
    await userEvent.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("signs out from the menu and goes to the sign-in page", async () => {
    let out = false;
    mockApi({
      "GET /api/me": () =>
        out
          ? {
              status: 401,
              json: {
                error: {
                  code: "unauthenticated",
                  message: "x",
                  request_id: "r",
                },
              },
            }
          : { json: withName },
      "POST /api/auth/logout": () => {
        out = true;
        return { json: { status: "ok" } };
      },
      "GET /api/notes": () => ({
        json: { role: "", content: "", updated_at: null },
      }),
      "GET /api/companies": () => ({ json: [] }),
      "GET /api/sessions": () => ({ json: { items: [], next_cursor: null } }),
    });
    renderApp(<App />, "/dashboard");
    await userEvent.click(
      await screen.findByRole("button", { name: /Account menu/ }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
  });
});

describe("initials", () => {
  it.each([
    ["Jordan Reyes", "x@y.z", "JR"],
    ["  ada   king lovelace ", "", "AL"],
    ["Madonna", "", "MA"],
    [null, "tia@example.com", "T"],
    ["", "", "?"],
  ])("%j with %j is %j", async (name, email, expected) => {
    const { initials } = await import("./ProfileMenu");
    expect(initials(name, email)).toBe(expected);
  });
});
