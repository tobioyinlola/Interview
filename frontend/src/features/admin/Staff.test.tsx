import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import { mockApi, renderApp, stubSupportedBrowser } from "../../test-utils";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

const NO_STAFF = {
  status: 401,
  json: {
    error: { code: "staff_not_authenticated", message: "x", request_id: "r" },
  },
};
const STAFF = { json: { email: "boss@example.com", full_name: null } };

describe("back office sign-in", () => {
  it("is a separate page with its own sign-in form", async () => {
    mockApi({ "GET /api/admin/auth/me": () => NO_STAFF });
    renderApp(<App />, "/admin/login");
    expect(
      await screen.findByRole("heading", { name: "Staff sign in" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Work email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByText(/staff only/i)).toBeInTheDocument();
  });

  it("signs in with an email and password, then opens the console", async () => {
    let signedIn = false;
    const calls = mockApi({
      "GET /api/admin/auth/me": () => (signedIn ? STAFF : NO_STAFF),
      "POST /api/admin/auth/login": () => {
        signedIn = true;
        return STAFF;
      },
      "GET /api/admin/overview": () => ({ status: 500, json: {} }),
    });
    renderApp(<App />, "/admin/login");
    await userEvent.type(
      await screen.findByLabelText("Work email"),
      "boss@example.com",
    );
    await userEvent.type(screen.getByLabelText("Password"), "correct horse");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByRole("navigation", { name: "Admin sections" }),
    ).toBeInTheDocument();
    expect(
      calls.find((c) => c.key === "POST /api/admin/auth/login")?.body,
    ).toEqual({
      email: "boss@example.com",
      password: "correct horse",
    });
  });

  it("says plainly when the details are wrong", async () => {
    mockApi({
      "GET /api/admin/auth/me": () => NO_STAFF,
      "POST /api/admin/auth/login": () => ({
        status: 401,
        json: {
          error: {
            code: "invalid_credentials",
            message: "Email or password is incorrect.",
            request_id: "r",
          },
        },
      }),
    });
    renderApp(<App />, "/admin/login");
    await userEvent.type(
      await screen.findByLabelText("Work email"),
      "x@example.com",
    );
    await userEvent.type(screen.getByLabelText("Password"), "nope");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Email or password is incorrect.",
    );
  });

  it("can email a one-time link, and does not say whether the address is staff", async () => {
    const calls = mockApi({
      "GET /api/admin/auth/me": () => NO_STAFF,
      "POST /api/admin/auth/request-link": () => ({ json: { status: "sent" } }),
    });
    renderApp(<App />, "/admin/login");
    await userEvent.type(
      await screen.findByLabelText("Work email"),
      "boss@example.com",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Email me a sign-in link instead" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "If that address is on the staff list",
    );
    expect(
      calls.find((c) => c.key === "POST /api/admin/auth/request-link")?.body,
    ).toEqual({
      email: "boss@example.com",
    });
  });

  it("goes straight to the console when already signed in", async () => {
    mockApi({
      "GET /api/admin/auth/me": () => STAFF,
      "GET /api/admin/overview": () => ({ status: 500, json: {} }),
    });
    renderApp(<App />, "/admin/login");
    expect(
      await screen.findByRole("navigation", { name: "Admin sections" }),
    ).toBeInTheDocument();
  });
});

describe("back office link", () => {
  it("exchanges the emailed token once and opens the console", async () => {
    let signedIn = false;
    const calls = mockApi({
      "GET /api/admin/auth/me": () => (signedIn ? STAFF : NO_STAFF),
      "POST /api/admin/auth/verify": () => {
        signedIn = true;
        return STAFF;
      },
      "GET /api/admin/overview": () => ({ status: 500, json: {} }),
    });
    renderApp(<App />, "/admin/verify?token=abc");
    expect(
      await screen.findByRole("navigation", { name: "Admin sections" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        calls.filter((c) => c.key === "POST /api/admin/auth/verify"),
      ).toHaveLength(1),
    );
  });

  it("explains a dead link and offers the staff sign-in", async () => {
    mockApi({
      "GET /api/admin/auth/me": () => NO_STAFF,
      "POST /api/admin/auth/verify": () => ({
        status: 400,
        json: {
          error: { code: "invalid_link", message: "x", request_id: "r" },
        },
      }),
    });
    renderApp(<App />, "/admin/verify?token=bad");
    expect(
      await screen.findByText(/That link didn.t work/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to staff sign in" }),
    ).toHaveAttribute("href", "/admin/login");
  });
});
