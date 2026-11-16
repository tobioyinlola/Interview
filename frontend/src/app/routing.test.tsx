import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";

import {
  ME,
  UNAUTH,
  mockApi,
  renderApp,
  stubSupportedBrowser,
} from "../test-utils";
import { App } from "./App";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

describe("routing and auth guard", () => {
  it("sends a signed-out visitor to the sign-in page", async () => {
    mockApi({ "GET /api/me": () => UNAUTH });
    renderApp(<App />, "/notes");
    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
  });

  it("shows the app to a signed-in user and redirects /login to the dashboard", async () => {
    mockApi({ "GET /api/me": () => ({ json: ME }) });
    renderApp(<App />, "/login");
    expect(
      await screen.findByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
    expect(screen.getByText("me@example.com")).toBeInTheDocument();
  });

  it("requests a sign-in link and tells the user to check email", async () => {
    const calls = mockApi({
      "GET /api/me": () => UNAUTH,
      "POST /api/auth/request-link": () => ({
        status: 202,
        json: { status: "sent" },
      }),
    });
    renderApp(<App />, "/login");
    await userEvent.type(
      await screen.findByLabelText("Email address"),
      "a@example.com",
    );
    await userEvent.click(screen.getByRole("button", { name: /email me/i }));
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
    const sent = calls.find((c) => c.key === "POST /api/auth/request-link")!;
    expect(sent.body).toEqual({ email: "a@example.com" });
    expect(sent.headers.get("x-requested-with")).toBe("meet-practice");
  });

  it("verifies the emailed token exactly once, even under StrictMode, then signs in", async () => {
    let signedIn = false;
    const calls = mockApi({
      "GET /api/me": () => (signedIn ? { json: ME } : UNAUTH),
      "POST /api/auth/verify": () => {
        signedIn = true;
        return { json: ME };
      },
    });
    renderApp(
      <StrictMode>
        <App />
      </StrictMode>,
      "/login/verify?token=abcdefghijklmnop",
    );
    expect(
      await screen.findByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
    expect(calls.filter((c) => c.key === "POST /api/auth/verify")).toHaveLength(
      1,
    );
  });

  it("explains a bad or expired link", async () => {
    mockApi({
      "GET /api/me": () => UNAUTH,
      "POST /api/auth/verify": () => ({
        status: 400,
        json: {
          error: { code: "invalid_link", message: "bad", request_id: "r" },
        },
      }),
    });
    renderApp(<App />, "/login/verify?token=abcdefghijklmnop");
    expect(await screen.findByText(/didn't work/i)).toBeInTheDocument();
  });

  it("signs out and returns to the sign-in page", async () => {
    let signedIn = true;
    mockApi({
      "GET /api/me": () => (signedIn ? { json: ME } : UNAUTH),
      "POST /api/auth/logout": () => {
        signedIn = false;
        return { json: { status: "ok" } };
      },
    });
    renderApp(<App />, "/");
    await userEvent.click(
      await screen.findByRole("button", { name: "Sign out" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Sign in" }),
      ).toBeInTheDocument(),
    );
  });
});
