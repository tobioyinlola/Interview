import { screen, within } from "@testing-library/react";
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
  localStorage.clear();
  mockApi({
    "GET /api/me": () => UNAUTH,
    "GET /api/auth/providers": () => ({ json: { google: false } }),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete window.Capacitor;
  delete window.interviewMeetDesktop;
  localStorage.clear();
});

const phone = () => {
  window.Capacitor = { isNativePlatform: () => true };
};

describe("the first-run welcome", () => {
  it("is the first thing a new phone install shows", async () => {
    phone();
    renderApp(<App />, "/");
    const carousel = await screen.findByRole("group", {
      name: "What InterviewMeet does",
    });
    const slides = within(carousel).getAllByRole("group");
    expect(slides).toHaveLength(3);
    expect(screen.getByText("Know the company first")).toBeInTheDocument();
    expect(
      screen.getByText("Let Auto-Apply do the applying"),
    ).toBeInTheDocument();
    expect(screen.getByText("Walk in prepared")).toBeInTheDocument();
    expect(screen.getAllByRole("img").length).toBeGreaterThanOrEqual(3); // an illustration on each
  });

  it("steps through with Next and ends on Get started", async () => {
    phone();
    renderApp(<App />, "/welcome");
    expect(
      await screen.findByRole("button", { name: "Next" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Get started" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      screen.getByRole("button", { name: "Get started" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  });

  it("Get started goes to creating an account, and the welcome is not shown again", async () => {
    phone();
    const first = renderApp(<App />, "/welcome");
    await userEvent.click(await screen.findByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Get started" }));
    expect(
      await screen.findByRole("heading", { name: "Create your account" }),
    ).toBeInTheDocument();
    expect(localStorage.getItem("im-welcome-done")).toBe("1");
    first.unmount();
    renderApp(<App />, "/"); // the next launch
    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
  });

  it("Skip goes straight to signing in", async () => {
    phone();
    renderApp(<App />, "/welcome");
    await userEvent.click(await screen.findByRole("button", { name: "Skip" }));
    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(localStorage.getItem("im-welcome-done")).toBe("1");
  });

  it("someone with an account can go straight to signing in", async () => {
    phone();
    renderApp(<App />, "/welcome");
    await userEvent.click(await screen.findByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(
      screen.getByRole("link", { name: "I already have an account" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
  });

  it("is only for the phone app: the desktop app and the website skip it", async () => {
    window.interviewMeetDesktop = {
      isDesktop: true,
      platform: "win32",
      systemAudio: true,
    };
    renderApp(<App />, "/");
    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Know the company first")).toBeNull();
  });
});
