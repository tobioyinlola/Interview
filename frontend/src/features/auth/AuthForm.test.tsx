import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import {
  ME,
  UNAUTH,
  mockApi,
  renderApp,
  stubSupportedBrowser,
} from "../../test-utils";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

const STRONG = "correct horse battery";

const api = (google: boolean, extra: Record<string, () => object> = {}) =>
  mockApi({
    "GET /api/me": () => UNAUTH,
    "GET /api/auth/providers": () => ({ json: { google } }),
    ...extra,
  });

const apiError = (status: number, code: string, message: string) => ({
  status,
  json: { error: { code, message, request_id: "r" } },
});

function captureNavigation() {
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign });
  return assign;
}

const typeEmail = async (v = "new@example.com") =>
  userEvent.type(await screen.findByLabelText("Email address"), v);
const password = () => screen.getByLabelText("Password");
const confirm = () => screen.getByLabelText("Confirm password");
const agree = () => screen.getByRole("checkbox", { name: /i agree/i });
const create = () => screen.getByRole("button", { name: "Create account" });

const fullName = () => screen.getByLabelText("Full name");

async function fillSignup() {
  await userEvent.type(
    await screen.findByLabelText("Full name"),
    "Jordan Reyes",
  );
  await typeEmail();
  await userEvent.type(password(), STRONG);
  await userEvent.type(confirm(), STRONG);
  await userEvent.click(agree());
}

describe("sign up page", () => {
  it("is its own page with its own heading, and links to sign in", async () => {
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

  it("asks for a password and a confirmation", async () => {
    api(false);
    renderApp(<App />, "/signup");
    await screen.findByLabelText("Email address");
    expect(password()).toHaveAttribute("autocomplete", "new-password");
    expect(confirm()).toHaveAttribute("autocomplete", "new-password");
  });

  it("puts the terms checkbox directly above the Create account button", async () => {
    api(true);
    renderApp(<App />, "/signup");
    await screen.findByLabelText("Email address");
    const label = agree().closest("label")!;
    expect(label.nextElementSibling).toBe(create());
    // and the Google button comes after both, so the one checkbox covers both ways in
    const google = await screen.findByRole("button", {
      name: /continue with google/i,
    });
    expect(
      create().compareDocumentPosition(google) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("names the Terms and Conditions and the Privacy Notice and links them", async () => {
    api(false);
    renderApp(<App />, "/signup");
    await screen.findByLabelText("Email address");
    expect(agree().closest("label")).toHaveTextContent(/partner who knows/i);
    expect(
      screen.getByRole("link", { name: "Terms and Conditions" }),
    ).toHaveAttribute("href", "/terms");
    expect(
      screen.getByRole("link", { name: "Privacy Notice" }),
    ).toHaveAttribute("href", "/privacy");
  });

  it("enables Create account only with a long enough, matching password and the terms accepted", async () => {
    api(false);
    renderApp(<App />, "/signup");
    await userEvent.type(
      await screen.findByLabelText("Full name"),
      "Jordan Reyes",
    );
    await typeEmail();
    expect(create()).toBeDisabled();
    await userEvent.type(password(), "short");
    await userEvent.type(confirm(), "short");
    await userEvent.click(agree());
    expect(create()).toBeDisabled(); // under 10 characters
    await userEvent.clear(password());
    await userEvent.clear(confirm());
    await userEvent.type(password(), STRONG);
    await userEvent.type(confirm(), STRONG + "x");
    expect(create()).toBeDisabled(); // does not match
    expect(screen.getByText("The passwords don't match.")).toBeInTheDocument();
    await userEvent.clear(confirm());
    await userEvent.type(confirm(), STRONG);
    expect(create()).toBeEnabled();
    await userEvent.click(agree());
    expect(create()).toBeDisabled(); // terms withdrawn
  });

  it("sends the email and password, then tells the person to confirm by email", async () => {
    const calls = api(false, {
      "POST /api/auth/signup": () => ({
        status: 202,
        json: { status: "sent" },
      }),
    });
    renderApp(<App />, "/signup");
    await fillSignup();
    await userEvent.click(create());
    expect(
      await screen.findByText(/confirm your address and finish creating/i),
    ).toBeInTheDocument();
    const sent = calls.find((c) => c.key === "POST /api/auth/signup")!;
    expect(sent.body).toEqual({
      email: "new@example.com",
      password: STRONG,
      full_name: "Jordan Reyes",
    });
    expect(sent.headers.get("x-requested-with")).toBe("meet-practice");
  });

  it("shows the server's reason when a password is refused", async () => {
    api(false, {
      "POST /api/auth/signup": () =>
        apiError(422, "weak_password", "That password is too easy to guess."),
    });
    renderApp(<App />, "/signup");
    await fillSignup();
    await userEvent.click(create());
    expect(await screen.findByRole("alert")).toHaveTextContent(/too easy/i);
  });

  it("does not submit with the keyboard when the form is not valid", async () => {
    const calls = api(false);
    renderApp(<App />, "/signup");
    await typeEmail();
    await userEvent.type(password(), "short{enter}");
    expect(calls.some((c) => c.key === "POST /api/auth/signup")).toBe(false);
  });
});

describe("sign up page: full name", () => {
  it("asks for the full name first, with the right autofill", async () => {
    api(false);
    renderApp(<App />, "/signup");
    const field = await screen.findByLabelText("Full name");
    expect(field).toHaveAttribute("autocomplete", "name");
    expect(field).toHaveAttribute("autocapitalize", "words");
    const inputs = screen.getAllByRole("textbox").map((e) => e.id);
    expect(inputs[0]).toBe("full-name"); // before the email address
  });

  it("will not create an account without a real name", async () => {
    const calls = api(false);
    renderApp(<App />, "/signup");
    await typeEmail();
    await userEvent.type(password(), STRONG);
    await userEvent.type(confirm(), STRONG);
    await userEvent.click(agree());
    expect(create()).toBeDisabled(); // no name yet
    await userEvent.type(fullName(), "J");
    expect(create()).toBeDisabled(); // one letter is not a full name
    await userEvent.clear(fullName());
    await userEvent.type(fullName(), "  Jo  ");
    expect(create()).toBeEnabled();
    expect(calls.some((c) => c.key === "POST /api/auth/signup")).toBe(false);
  });

  it("sends the name trimmed, and shows the server's message if it is refused", async () => {
    const calls = api(false, {
      "POST /api/auth/signup": () =>
        apiError(
          422,
          "invalid_name",
          "Please enter your full name, using letters only.",
        ),
    });
    renderApp(<App />, "/signup");
    await userEvent.type(
      await screen.findByLabelText("Full name"),
      "  Ada  Lovelace ",
    );
    await typeEmail();
    await userEvent.type(password(), STRONG);
    await userEvent.type(confirm(), STRONG);
    await userEvent.click(agree());
    await userEvent.click(create());
    expect(await screen.findByRole("alert")).toHaveTextContent(/full name/i);
    expect(
      calls.find((c) => c.key === "POST /api/auth/signup")!.body,
    ).toMatchObject({
      full_name: "Ada  Lovelace",
    });
  });

  it("does not ask for a name when logging in", async () => {
    api(false);
    renderApp(<App />, "/login");
    await screen.findByRole("heading", { name: "Sign in" });
    expect(screen.queryByLabelText("Full name")).toBeNull();
  });
});

describe("password reveal", () => {
  it("shows and hides each field on its own", async () => {
    api(false);
    renderApp(<App />, "/signup");
    await screen.findByLabelText("Email address");
    const showPassword = screen.getByRole("button", { name: "Show password" });
    expect(password()).toHaveAttribute("type", "password");
    await userEvent.click(showPassword);
    expect(password()).toHaveAttribute("type", "text");
    expect(confirm()).toHaveAttribute("type", "password"); // the other field is unaffected
    expect(
      screen.getByRole("button", { name: "Hide password" }),
    ).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(
      screen.getByRole("button", { name: "Hide password" }),
    );
    expect(password()).toHaveAttribute("type", "password");
    await userEvent.click(
      screen.getByRole("button", { name: "Show confirm password" }),
    );
    expect(confirm()).toHaveAttribute("type", "text");
  });

  it("is on the log in page too, and does not submit the form when clicked", async () => {
    const calls = api(false);
    renderApp(<App />, "/login");
    await screen.findByLabelText("Email address");
    await userEvent.click(
      screen.getByRole("button", { name: "Show password" }),
    );
    expect(password()).toHaveAttribute("type", "text");
    expect(calls.some((c) => c.key.startsWith("POST"))).toBe(false);
  });
});

describe("log in page", () => {
  it("links to sign up, forgot password and the terms", async () => {
    api(false);
    renderApp(<App />, "/login");
    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Create an account" }),
    ).toHaveAttribute("href", "/signup");
    expect(
      screen.getByRole("link", { name: "Forgot password?" }),
    ).toHaveAttribute("href", "/forgot-password");
    expect(password()).toHaveAttribute("autocomplete", "current-password");
  });

  it("signs in with email and password and goes to the dashboard", async () => {
    let signedIn = false;
    const calls = mockApi({
      "GET /api/me": () => (signedIn ? { json: ME } : UNAUTH),
      "GET /api/auth/providers": () => ({ json: { google: false } }),
      "POST /api/auth/login": () => {
        signedIn = true;
        return { json: ME };
      },
      "GET /api/notes": () => ({
        json: { role: "", content: "", updated_at: null },
      }),
      "GET /api/companies": () => ({ json: [] }),
      "GET /api/sessions": () => ({ json: { items: [], next_cursor: null } }),
    });
    renderApp(<App />, "/login");
    await typeEmail("me@example.com");
    await userEvent.type(password(), "my password here");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.key === "POST /api/auth/login")!.body).toEqual({
      email: "me@example.com",
      password: "my password here",
    });
  });

  it("shows the server's message for a wrong password", async () => {
    api(false, {
      "POST /api/auth/login": () =>
        apiError(401, "invalid_credentials", "Email or password is incorrect."),
    });
    renderApp(<App />, "/login");
    await typeEmail("me@example.com");
    await userEvent.type(password(), "wrong password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/incorrect/i);
    expect(
      screen.getByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
  });

  it("still offers an emailed sign-in link, and needs an email address for it", async () => {
    const calls = api(false, {
      "POST /api/auth/request-link": () => ({
        status: 202,
        json: { status: "sent" },
      }),
    });
    renderApp(<App />, "/login");
    const button = await screen.findByRole("button", {
      name: "Email me a sign-in link",
    });
    await userEvent.click(button);
    expect(calls.some((c) => c.key === "POST /api/auth/request-link")).toBe(
      false,
    );
    await typeEmail("me@example.com");
    await userEvent.click(button);
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
    expect(
      calls.find((c) => c.key === "POST /api/auth/request-link")!.body,
    ).toEqual({
      email: "me@example.com",
    });
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
    expect(screen.getByText(/accept the terms above/i)).toBeInTheDocument();
    await userEvent.click(google);
    expect(assign).not.toHaveBeenCalled();
    await userEvent.click(agree());
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
      await screen.findByRole("button", { name: "Sign in" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /continue with google/i }),
    ).toBeNull();
  });
});

describe("forgot and reset password", () => {
  it("asks for an email and answers the same for every address", async () => {
    const calls = api(false, {
      "POST /api/auth/request-reset": () => ({
        status: 202,
        json: { status: "sent" },
      }),
    });
    renderApp(<App />, "/forgot-password");
    await typeEmail("me@example.com");
    await userEvent.click(
      screen.getByRole("button", { name: "Send reset link" }),
    );
    expect(
      await screen.findByText(/if that address has an account/i),
    ).toBeInTheDocument();
    expect(
      calls.find((c) => c.key === "POST /api/auth/request-reset")!.body,
    ).toEqual({
      email: "me@example.com",
    });
  });

  it("sets a new password with the emailed link and signs the person in", async () => {
    let signedIn = false;
    const calls = mockApi({
      "GET /api/me": () => (signedIn ? { json: ME } : UNAUTH),
      "POST /api/auth/reset-password": () => {
        signedIn = true;
        return { json: ME };
      },
      "GET /api/notes": () => ({
        json: { role: "", content: "", updated_at: null },
      }),
      "GET /api/companies": () => ({ json: [] }),
      "GET /api/sessions": () => ({ json: { items: [], next_cursor: null } }),
    });
    renderApp(<App />, "/reset-password?token=abcdefghijklmnop");
    const save = await screen.findByRole("button", {
      name: "Save new password",
    });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText("New password"), STRONG);
    await userEvent.type(
      screen.getByLabelText("Confirm new password"),
      STRONG + "x",
    );
    expect(save).toBeDisabled();
    expect(screen.getByText("The passwords don't match.")).toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText("Confirm new password"),
      "{backspace}",
    );
    await userEvent.click(save);
    expect(
      await screen.findByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
    expect(
      calls.find((c) => c.key === "POST /api/auth/reset-password")!.body,
    ).toEqual({
      token: "abcdefghijklmnop",
      password: STRONG,
    });
  });

  it("shows the reason when the new password is refused, and lets the person try again", async () => {
    api(false, {
      "POST /api/auth/reset-password": () =>
        apiError(422, "weak_password", "That password is too easy to guess."),
    });
    renderApp(<App />, "/reset-password?token=abcdefghijklmnop");
    await userEvent.type(
      await screen.findByLabelText("New password"),
      "password123",
    );
    await userEvent.type(
      screen.getByLabelText("Confirm new password"),
      "password123",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save new password" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/too easy/i);
    expect(
      screen.getByRole("button", { name: "Save new password" }),
    ).toBeEnabled();
  });

  it("explains a missing, expired or used link and offers a new one", async () => {
    api(false);
    const { unmount } = renderApp(<App />, "/reset-password");
    expect(await screen.findByText(/didn't work/i)).toBeInTheDocument();
    expect(
      within(screen.getByRole("main")).getByRole("link", {
        name: "Request a new reset link",
      }),
    ).toHaveAttribute("href", "/forgot-password");
    unmount();
    vi.restoreAllMocks();
    stubSupportedBrowser();
    api(false, {
      "POST /api/auth/reset-password": () =>
        apiError(
          400,
          "invalid_link",
          "This reset link is invalid or has expired.",
        ),
    });
    renderApp(<App />, "/reset-password?token=abcdefghijklmnop");
    await userEvent.type(await screen.findByLabelText("New password"), STRONG);
    await userEvent.type(screen.getByLabelText("Confirm new password"), STRONG);
    await userEvent.click(
      screen.getByRole("button", { name: "Save new password" }),
    );
    expect(await screen.findByText(/didn't work/i)).toBeInTheDocument();
  });
});
