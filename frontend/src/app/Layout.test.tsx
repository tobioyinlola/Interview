import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ME, mockApi, renderApp, stubSupportedBrowser } from "../test-utils";
import { App } from "./App";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

const signedIn = (me: object = { ...ME, startup_outreach: true }) =>
  mockApi({
    "GET /api/me": () => ({ json: me }),
    "GET /api/notes": () => ({
      json: { role: "", content: "", updated_at: null },
    }),
    "GET /api/companies": () => ({ json: [] }),
    "GET /api/sessions": () => ({ json: { items: [], next_cursor: null } }),
  });

describe("app shell", () => {
  it("has a back button on every page except Overview, that returns to the page before", async () => {
    signedIn();
    renderApp(<App />, "/dashboard");
    const nav = within(await screen.findByRole("navigation", { name: "Main" }));
    expect(
      screen.queryByRole("button", { name: "Back to the previous page" }),
    ).toBeNull();
    await userEvent.click(nav.getByRole("link", { name: "Settings" }));
    const back = await screen.findByRole("button", {
      name: "Back to the previous page",
    });
    await userEvent.click(back);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Back to the previous page" }),
      ).toBeNull(),
    );
  });

  it("groups navigation into Menu, Account and Support and marks the current page", async () => {
    signedIn();
    renderApp(<App />, "/dashboard");
    const nav = within(await screen.findByRole("navigation", { name: "Main" }));
    for (const name of [
      "Overview",
      "Startup",
      "Interview",
      "History",
      "Settings",
      "Contact support",
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
    expect(nav.getByRole("link", { name: "Startup" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("has no CV item in the menu: the CV lives in Settings", async () => {
    signedIn();
    renderApp(<App />, "/dashboard");
    const nav = within(await screen.findByRole("navigation", { name: "Main" }));
    expect(nav.queryByRole("link", { name: "CV" })).toBeNull();
    expect(nav.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  it("has no link to the back office: it is a separate place", async () => {
    signedIn();
    renderApp(<App />, "/dashboard");
    await screen.findByRole("navigation", { name: "Main" });
    expect(
      screen.queryByRole("link", { name: /admin|back office/i }),
    ).toBeNull();
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
    await userEvent.click(
      within(screen.getByRole("navigation", { name: "Main" })).getByRole(
        "link",
        { name: "Startup" },
      ),
    );
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
    expect(nav.getByRole("link", { name: "Startup" })).toHaveAttribute(
      "title",
      "Startup",
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

  it.each([
    "/dashboard",
    "/settings/cv",
    "/companies",
    "/sessions",
    "/settings",
  ])("has the search box and the account button on %s", async (path) => {
    signedIn(withName);
    renderApp(<App />, path);
    expect(await screen.findByRole("combobox")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Account menu for Jordan Reyes" }),
    ).toBeInTheDocument();
  });

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

describe("the phone app's tab bar", () => {
  afterEach(() => {
    delete window.Capacitor;
  });

  it("shows three icons in the phone app, the middle one being Auto-Apply", async () => {
    window.Capacitor = { isNativePlatform: () => true };
    signedIn({
      ...ME,
      onboarded: true,
      autoapply: true,
      startup_outreach: true,
    });
    renderApp(<App />, "/dashboard");
    const tabs = await screen.findByRole("navigation", { name: "Tabs" });
    const links = within(tabs).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("aria-label"))).toEqual([
      "Home",
      "Auto-Apply",
      "Startups",
    ]);
    expect(within(tabs).getByRole("link", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // the website's sidebar and search box are not part of the phone app
    expect(screen.queryByRole("link", { name: "Invite friends" })).toBeNull();
  });

  it("has no tab bar on the website", async () => {
    signedIn({ ...ME, onboarded: true });
    renderApp(<App />, "/dashboard");
    await screen.findAllByText(/Overview/);
    expect(screen.queryByRole("navigation", { name: "Tabs" })).toBeNull();
  });
});
