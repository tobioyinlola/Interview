import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import { markVerified } from "./VerifiedToast";
import { UNAUTH, mockApi, renderApp } from "../../test-utils";

const PHONE =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36";
const TOKEN = "t".repeat(30);

beforeEach(() => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(PHONE);
  sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("tapping the emailed link on a phone", () => {
  it("is verified, not 'browser not supported', and offers the app", async () => {
    const open = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign: open });
    mockApi({
      "GET /api/me": () => UNAUTH,
      "POST /api/auth/verify": () => ({ json: { app_code: "c".repeat(40) } }),
    });
    renderApp(<App />, `/login/verify?token=${TOKEN}`);
    expect(
      await screen.findByRole("heading", { name: "Your email is verified" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/isn't supported/i)).toBeNull();
    const button = screen.getByRole("link", { name: "Open InterviewMeet" });
    expect(button).toHaveAttribute(
      "href",
      `interviewmeet://auth?code=${"c".repeat(40)}`,
    );
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        `interviewmeet://auth?code=${"c".repeat(40)}`,
      ),
    );
    expect(
      screen.getByRole("link", { name: /Download it for Android/ }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("android-latest/InterviewMeet-android.apk"),
    );
  });

  it("tells a phone that signed up on the website to open the app and sign in", async () => {
    mockApi({
      "GET /api/me": () => UNAUTH,
      "POST /api/auth/verify": () => ({
        json: { id: "u", email: "a@b.c", onboarded: true },
      }),
    });
    renderApp(<App />, `/login/verify?token=${TOKEN}`);
    expect(
      await screen.findByRole("heading", { name: "Your email is verified" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Open the InterviewMeet app and sign in/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open InterviewMeet" }),
    ).toHaveAttribute("href", "interviewmeet://auth");
  });

  it("an expired link still says so, in any browser", async () => {
    mockApi({
      "GET /api/me": () => UNAUTH,
      "POST /api/auth/verify": () => ({
        status: 400,
        json: {
          error: { code: "invalid_link", message: "x", request_id: "r" },
        },
      }),
    });
    renderApp(<App />, `/login/verify?token=${TOKEN}`);
    expect(await screen.findByText(/didn't work/i)).toBeInTheDocument();
  });

  it("a password reset link opened on a phone says to sign in in the app", async () => {
    mockApi({
      "GET /api/me": () => UNAUTH,
      "POST /api/auth/reset-password": () => ({
        json: { id: "u", email: "a@b.c" },
      }),
    });
    renderApp(<App />, `/reset-password?token=${TOKEN}`);
    await userEvent.type(
      await screen.findByLabelText("New password"),
      "correct horse battery",
    );
    await userEvent.type(
      screen.getByLabelText("Confirm new password"),
      "correct horse battery",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save new password" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Your password is changed" }),
    ).toBeInTheDocument();
  });
});

describe("the phone browser's page for everything else", () => {
  it("points to the Android app instead of a different browser", async () => {
    mockApi({ "GET /api/me": () => UNAUTH });
    renderApp(<App />, "/signup");
    expect(
      await screen.findByRole("heading", { name: "Use the InterviewMeet app" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Download for Android" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Chrome or Edge on a desktop/)).toBeNull();
  });
});

describe("the welcome after verifying", () => {
  it("says the email is verified, once, and can be dismissed", async () => {
    mockApi({ "GET /api/me": () => UNAUTH });
    renderApp(<App />, "/terms");
    expect(screen.queryByText("Your email is verified")).toBeNull();
    markVerified();
    expect(
      await screen.findByText("Your email is verified"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByText("Your email is verified")).toBeNull();
    expect(sessionStorage.getItem("im-verified")).toBeNull();
  });
});
