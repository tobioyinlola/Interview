import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import {
  UNAUTH,
  mockApi,
  renderApp,
  stubSupportedBrowser,
} from "../../test-utils";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

const api = (google: boolean, extra: Record<string, () => object> = {}) =>
  mockApi({
    "GET /api/me": () => UNAUTH,
    "GET /api/auth/providers": () => ({ json: { google } }),
    ...extra,
  });

function captureNavigation() {
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign });
  return assign;
}

describe("sign up page", () => {
  it("is its own page with its own heading, and links to log in", async () => {
    api(false);
    renderApp(<App />, "/signup");
    expect(
      await screen.findByRole("heading", { name: "Create your account" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("will not send a link until the terms are accepted", async () => {
    const calls = api(false, {
      "POST /api/auth/request-link": () => ({
        status: 202,
        json: { status: "sent" },
      }),
    });
    renderApp(<App />, "/signup");
    await userEvent.type(
      await screen.findByLabelText("Email address"),
      "new@example.com",
    );
    const button = screen.getByRole("button", {
      name: "Create account with email",
    });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(calls.some((c) => c.key === "POST /api/auth/request-link")).toBe(
      false,
    );

    await userEvent.click(screen.getByRole("checkbox", { name: /i agree/i }));
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(
      await screen.findByText(/finish creating your account/i),
    ).toBeInTheDocument();
    expect(
      calls.find((c) => c.key === "POST /api/auth/request-link")!.body,
    ).toEqual({ email: "new@example.com" });
  });

  it("links the terms and privacy notice and names the consent rule", async () => {
    api(false);
    renderApp(<App />, "/signup");
    const box = await screen.findByRole("checkbox", { name: /i agree/i });
    expect(box.closest("label")).toHaveTextContent(/partner who knows/i);
    expect(screen.getByRole("link", { name: "terms" })).toHaveAttribute(
      "href",
      "/terms",
    );
    expect(
      screen.getByRole("link", { name: "privacy notice" }),
    ).toHaveAttribute("href", "/privacy");
  });
});

describe("log in page", () => {
  it("links to sign up and keeps the email-link flow", async () => {
    api(false);
    renderApp(<App />, "/login");
    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Create an account" }),
    ).toHaveAttribute("href", "/signup");
    expect(
      screen.getByRole("button", { name: "Email me a sign-in link" }),
    ).toBeEnabled();
  });

  it.each([
    ["google_failed", /didn't work/i],
    ["google_cancelled", /cancelled/i],
    ["google_unavailable", /isn't available/i],
  ])("explains a failed Google sign-in (%s)", async (code, text) => {
    api(true);
    renderApp(<App />, `/login?error=${code}`);
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
  });

  it("ignores an unknown error code instead of printing it", async () => {
    api(false);
    renderApp(<App />, "/login?error=<script>alert(1)</script>");
    await screen.findByRole("heading", { name: "Sign in" });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("continue with Google", () => {
  it("is offered only when the server has Google configured", async () => {
    api(false);
    const { unmount } = renderApp(<App />, "/login");
    await screen.findByRole("heading", { name: "Sign in" });
    expect(
      screen.queryByRole("button", { name: /continue with google/i }),
    ).toBeNull();
    unmount();
    vi.restoreAllMocks();
    stubSupportedBrowser();
    api(true);
    renderApp(<App />, "/login");
    expect(
      await screen.findByRole("button", { name: /continue with google/i }),
    ).toBeInTheDocument();
  });

  it("sends the browser to the API's Google start address from the login page", async () => {
    api(true);
    const assign = captureNavigation();
    renderApp(<App />, "/login");
    await userEvent.click(
      await screen.findByRole("button", { name: /continue with google/i }),
    );
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign.mock.calls[0][0]).toMatch(/\/api\/auth\/google\/start$/);
  });

  it("needs the terms accepted first on the sign up page", async () => {
    api(true);
    const assign = captureNavigation();
    renderApp(<App />, "/signup");
    const google = await screen.findByRole("button", {
      name: /continue with google/i,
    });
    expect(google).toBeDisabled();
    await userEvent.click(google);
    expect(assign).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("checkbox", { name: /i agree/i }));
    await waitFor(() => expect(google).toBeEnabled());
    await userEvent.click(google);
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("still lets people use email if the provider list cannot be loaded", async () => {
    mockApi({
      "GET /api/me": () => UNAUTH,
      "GET /api/auth/providers": () => ({ status: 500, json: {} }),
    });
    renderApp(<App />, "/login");
    expect(
      await screen.findByRole("button", { name: "Email me a sign-in link" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /continue with google/i }),
    ).toBeNull();
  });
});
