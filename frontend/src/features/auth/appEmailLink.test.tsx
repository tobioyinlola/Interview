import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import {
  UNAUTH,
  mockApi,
  renderApp,
  stubSupportedBrowser,
} from "../../test-utils";

const STRONG = "correct horse battery";

beforeEach(async () => {
  stubSupportedBrowser();
  // the test browser has no Web Crypto of its own: borrow Node's
  const { webcrypto } = (await vi.importActual("node:crypto")) as {
    webcrypto: Crypto;
  };
  vi.stubGlobal("crypto", webcrypto);
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.interviewMeetDesktop;
  delete window.Capacitor;
});

const inTheApp = () => {
  window.interviewMeetDesktop = {
    isDesktop: true,
    platform: "win32",
    systemAudio: true,
  };
};

async function fillAndSubmit() {
  await userEvent.type(
    await screen.findByLabelText("Full name"),
    "Jordan Reyes",
  );
  await userEvent.type(
    screen.getByLabelText("Email address"),
    "new@example.com",
  );
  await userEvent.type(screen.getByLabelText("Password"), STRONG);
  await userEvent.type(screen.getByLabelText("Confirm password"), STRONG);
  await userEvent.click(screen.getByRole("checkbox", { name: /i agree/i }));
  await userEvent.click(screen.getByRole("button", { name: "Create account" }));
}

describe("creating an account in an installed app", () => {
  it("asks for the emailed link to hand the person back to the app", async () => {
    inTheApp();
    const calls = mockApi({
      "GET /api/me": () => UNAUTH,
      "GET /api/auth/providers": () => ({ json: { google: false } }),
      "POST /api/auth/signup": () => ({
        status: 202,
        json: { status: "sent" },
      }),
    });
    renderApp(<App />, "/signup");
    await fillAndSubmit();
    expect(await screen.findByText(/bring you back here/i)).toBeInTheDocument();
    const sent = calls.find((c) => c.key === "POST /api/auth/signup")!;
    expect((sent.body as { app_challenge: string }).app_challenge).toMatch(
      /^[\w-]{43}$/,
    );
    expect(localStorage.getItem("im-app-verifier")).not.toBeNull(); // the secret stays in the app
  });

  it("a sign-in link asked for in the app does the same", async () => {
    inTheApp();
    const calls = mockApi({
      "GET /api/me": () => UNAUTH,
      "GET /api/auth/providers": () => ({ json: { google: false } }),
      "POST /api/auth/request-link": () => ({
        status: 202,
        json: { status: "sent" },
      }),
    });
    renderApp(<App />, "/login");
    await userEvent.type(
      await screen.findByLabelText("Email address"),
      "me@example.com",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Email me a sign-in link" }),
    );
    await screen.findByText(/check your email/i);
    const sent = calls.find((c) => c.key === "POST /api/auth/request-link")!;
    expect((sent.body as { app_challenge: string }).app_challenge).toMatch(
      /^[\w-]{43}$/,
    );
  });

  it("on the website nothing about an app is sent", async () => {
    const calls = mockApi({
      "GET /api/me": () => UNAUTH,
      "GET /api/auth/providers": () => ({ json: { google: false } }),
      "POST /api/auth/signup": () => ({
        status: 202,
        json: { status: "sent" },
      }),
    });
    renderApp(<App />, "/signup");
    await fillAndSubmit();
    await screen.findByText(/confirm your address/i);
    const sent = calls.find((c) => c.key === "POST /api/auth/signup")!;
    expect(sent.body).not.toHaveProperty("app_challenge");
  });
});

describe("opening the emailed link in the browser", () => {
  const TOKEN = "t".repeat(30);

  it("hands the app a code and leaves the browser signed out", async () => {
    const calls = mockApi({
      "GET /api/me": () => UNAUTH,
      "POST /api/auth/verify": () => ({ json: { app_code: "c".repeat(40) } }),
    });
    const open = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign: open });
    renderApp(<App />, `/login/verify?token=${TOKEN}`);
    const button = await screen.findByRole("link", {
      name: "Open InterviewMeet",
    });
    expect(button).toHaveAttribute(
      "href",
      `interviewmeet://auth?code=${"c".repeat(40)}`,
    );
    expect(open).toHaveBeenCalledWith(
      `interviewmeet://auth?code=${"c".repeat(40)}`,
    );
    expect(screen.getByText(/you're confirmed/i)).toBeInTheDocument();
    expect(calls.filter((c) => c.key === "POST /api/auth/verify")).toHaveLength(
      1,
    ); // a token works once
  });

  it("a normal link still signs the browser in", async () => {
    mockApi({
      "GET /api/me": () => ({
        json: { id: "u", email: "a@b.c", onboarded: true },
      }),
      "POST /api/auth/verify": () => ({
        json: { id: "u", email: "a@b.c", onboarded: true },
      }),
      "GET /api/notes": () => ({
        json: { role: "", content: "", updated_at: null },
      }),
      "GET /api/companies": () => ({ json: [] }),
      "GET /api/sessions": () => ({ json: { items: [], next_cursor: null } }),
    });
    renderApp(<App />, `/login/verify?token=${TOKEN}`);
    await screen.findAllByText(/Overview|Hello/);
    expect(screen.queryByText(/you're confirmed/i)).toBeNull();
  });
});
