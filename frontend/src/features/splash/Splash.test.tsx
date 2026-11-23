import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import {
  UNAUTH,
  mockApi,
  renderApp,
  stubSupportedBrowser,
} from "../../test-utils";

beforeEach(() => {
  stubSupportedBrowser();
  sessionStorage.clear();
  localStorage.setItem("im-welcome-done", "1");
  (window as { __splash?: boolean }).__splash = true; // the animation is off in tests unless asked for
  mockApi({
    "GET /api/me": () => UNAUTH,
    "GET /api/auth/providers": () => ({ json: { google: false } }),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (window as { __splash?: boolean }).__splash;
  delete window.interviewMeetDesktop;
  delete window.Capacitor;
  sessionStorage.clear();
  localStorage.clear();
});

const inDesktopApp = () => {
  window.interviewMeetDesktop = {
    isDesktop: true,
    platform: "win32",
    systemAudio: true,
  };
};

describe("the opening animation", () => {
  it("plays when an installed app opens, then gives way to sign-in", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    inDesktopApp();
    renderApp(<App />, "/");
    expect(screen.getByTestId("splash")).toBeInTheDocument();
    expect(screen.getByTestId("splash").textContent).toContain("InterviewMeet"); // the name, letter by letter
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2400); // the sequence plays, then it lifts away
    });
    expect(screen.getByTestId("splash").className).toContain("sp-out");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(screen.queryByTestId("splash")).toBeNull();
    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
  });

  it("can be skipped with a tap", async () => {
    inDesktopApp();
    renderApp(<App />, "/login");
    await userEvent.click(screen.getByTestId("splash"));
    await screen.findByRole("heading", { name: "Sign in" });
    await vi.waitFor(() => expect(screen.queryByTestId("splash")).toBeNull(), {
      timeout: 1500,
    });
  });

  it("plays once per launch, not again as the person moves around", async () => {
    inDesktopApp();
    const first = renderApp(<App />, "/login");
    expect(screen.getByTestId("splash")).toBeInTheDocument();
    first.unmount();
    renderApp(<App />, "/signup"); // same launch (the page was not reloaded)
    expect(screen.queryByTestId("splash")).toBeNull();
  });

  it("is not on the website", () => {
    renderApp(<App />, "/login");
    expect(screen.queryByTestId("splash")).toBeNull();
  });

  it("never delays the hand-back after signing in through the browser", () => {
    inDesktopApp();
    window.history.pushState({}, "", "/auth/app?code=" + "c".repeat(30)); // the page the shell loads
    renderApp(<App />, "/auth/app?code=" + "c".repeat(30));
    expect(screen.queryByTestId("splash")).toBeNull();
    window.history.pushState({}, "", "/");
  });

  it("is hidden from screen readers, who get the app straight away", () => {
    inDesktopApp();
    renderApp(<App />, "/login");
    expect(screen.getByTestId("splash")).toHaveAttribute("aria-hidden", "true");
  });
});
