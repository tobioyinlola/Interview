import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import {
  UNAUTH,
  ME,
  mockApi,
  renderApp,
  stubSupportedBrowser,
} from "../../test-utils";
import { startNativeGoogle, takeVerifier } from "./nativeGoogle";

let webcrypto: Crypto;
beforeEach(async () => {
  stubSupportedBrowser();
  // the test browser has no Web Crypto of its own: borrow Node's
  webcrypto = ((await vi.importActual("node:crypto")) as { webcrypto: Crypto })
    .webcrypto;
  vi.stubGlobal("crypto", webcrypto);
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.interviewMeetDesktop;
  delete window.Capacitor;
});

const b64url = (b: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

describe("signing in with Google from an installed app", () => {
  it("opens the real browser with a challenge that matches a secret kept in the app", async () => {
    const open = vi.fn();
    window.interviewMeetDesktop = {
      isDesktop: true,
      platform: "win32",
      systemAudio: true,
      openInBrowser: open,
    };
    await startNativeGoogle(new URLSearchParams({ ref: "friend1" }));
    expect(open).toHaveBeenCalledTimes(1);
    const url = new URL(open.mock.calls[0][0]);
    expect(url.pathname).toBe("/api/auth/google/start");
    expect(url.searchParams.get("app")).toBe("1");
    expect(url.searchParams.get("ref")).toBe("friend1");
    const challenge = url.searchParams.get("challenge")!;
    expect(challenge).toMatch(/^[\w-]{43}$/);
    const verifier = takeVerifier()!;
    expect(verifier).toMatch(/^[\w-]{43,128}$/);
    const hash = await webcrypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier),
    );
    expect(b64url(hash)).toBe(challenge); // the server can check the app is the one that left
    expect(url.href).not.toContain(verifier); // the secret itself never leaves the app
  });

  it("uses the phone's in-app browser on the phone app", async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: { Browser: { open } },
    } as unknown as typeof window.Capacitor;
    await startNativeGoogle(new URLSearchParams());
    expect(open).toHaveBeenCalledWith({
      url: expect.stringContaining("app=1"),
    });
  });

  it("hands the secret back once, and not when it is old", () => {
    localStorage.setItem(
      "im-app-verifier",
      JSON.stringify({ v: "abc", t: 1000 }),
    );
    expect(takeVerifier(1000 + 60_000)).toBe("abc");
    expect(takeVerifier()).toBeNull(); // used up
    localStorage.setItem(
      "im-app-verifier",
      JSON.stringify({ v: "abc", t: 1000 }),
    );
    expect(takeVerifier(1000 + 11 * 60_000)).toBeNull(); // too old
  });

  it("shows the Google button in the apps and starts the browser sign-in", async () => {
    const open = vi.fn();
    window.interviewMeetDesktop = {
      isDesktop: true,
      platform: "win32",
      systemAudio: true,
      openInBrowser: open,
    };
    mockApi({
      "GET /api/me": () => UNAUTH,
      "GET /api/auth/providers": () => ({ json: { google: true } }),
    });
    renderApp(<App />, "/login");
    await userEvent.click(
      await screen.findByRole("button", { name: /Continue with Google/ }),
    );
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/opens in your browser/i)).toBeInTheDocument();
  });
});

describe("coming back into the app", () => {
  const verifier = "v".repeat(43);
  const seed = () =>
    localStorage.setItem(
      "im-app-verifier",
      JSON.stringify({ v: verifier, t: Date.now() }),
    );

  it("swaps the one-time code for a session and goes to the dashboard", async () => {
    seed();
    const seen: unknown[] = [];
    let signedIn = false;
    mockApi({
      "GET /api/me": () =>
        signedIn ? { json: { ...ME, onboarded: true } } : UNAUTH,
      "POST /api/auth/app-exchange": (req) => {
        seen.push(req);
        signedIn = true;
        return { json: { status: "ok" } };
      },
      "GET /api/notes": () => ({
        json: { role: "", content: "", updated_at: null },
      }),
      "GET /api/companies": () => ({ json: [] }),
      "GET /api/sessions": () => ({ json: { items: [], next_cursor: null } }),
    });
    renderApp(<App />, `/auth/app?code=${"c".repeat(30)}`);
    await screen.findAllByText(/Overview|Hello/);
    expect(seen).toHaveLength(1); // a code is sent once, never twice
    expect(localStorage.getItem("im-app-verifier")).toBeNull();
  });

  it("says so when the code has expired", async () => {
    seed();
    mockApi({
      "GET /api/me": () => UNAUTH,
      "POST /api/auth/app-exchange": () => ({
        status: 400,
        json: {
          error: { code: "invalid_code", message: "x", request_id: "r" },
        },
      }),
    });
    renderApp(<App />, `/auth/app?code=${"c".repeat(30)}`);
    expect(await screen.findByRole("alert")).toHaveTextContent(/expired/i);
    expect(
      screen.getByRole("link", { name: "Back to sign in" }),
    ).toHaveAttribute("href", "/login");
  });

  it("does not try the code when this app never started a sign-in", async () => {
    const exchange = vi.fn(() => ({ json: { status: "ok" } }));
    mockApi({
      "GET /api/me": () => UNAUTH,
      "POST /api/auth/app-exchange": exchange,
    });
    renderApp(<App />, `/auth/app?code=${"c".repeat(30)}`);
    expect(await screen.findByRole("alert")).toHaveTextContent(/expired/i);
    expect(exchange).not.toHaveBeenCalled();
  });

  it("reports a cancelled Google sign-in", async () => {
    mockApi({ "GET /api/me": () => UNAUTH });
    renderApp(<App />, "/auth/app?error=google_cancelled");
    expect(await screen.findByRole("alert")).toHaveTextContent(/cancelled/i);
  });
});
