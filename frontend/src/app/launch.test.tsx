import { screen } from "@testing-library/react";

import { renderApp, stubSupportedBrowser } from "../test-utils";

/** Opening the installed desktop app. After the opening animation the person used to see a blank
 *  page for as long as the first server call took (a slow first connection, a cold network stack on
 *  a fresh install), and only then the sign-in page. */
async function installedApp() {
  vi.resetModules();
  vi.stubEnv("VITE_APP_SHELL", "1");
  vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com");
  const bridge = { isDesktop: true, platform: "win32", systemAudio: true };
  (
    window as unknown as { interviewMeetDesktop: unknown }
  ).interviewMeetDesktop = bridge;
  const session = await import("../api/session");
  const { App } = await import("./App");
  return { App, session };
}

/** A server that answers the sign-in page's own needs and never answers /api/me. */
function slowServer() {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url.includes("/api/auth/providers"))
      return Promise.resolve(
        new Response(JSON.stringify({ google: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    return new Promise<Response>(() => undefined); // waits forever
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  stubSupportedBrowser();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("opening the installed app", () => {
  it("shows the sign-in page straight away on a first launch, without waiting for the server", async () => {
    const { App } = await installedApp();
    const fetchMock = slowServer();
    renderApp(<App />, "/");
    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    // with no saved sign-in nobody can be signed in: the server would only say no
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/me")),
    ).toBe(false);
  });

  it("never shows a blank page to someone who is signed in while the server is slow", async () => {
    localStorage.setItem("im-session-token", "saved-token");
    const { App, session } = await installedApp();
    await session.loadSession();
    slowServer();
    const { container } = renderApp(<App />, "/");
    // something visible says it is working, instead of an empty page
    expect(container.querySelector("[aria-busy=true]")).not.toBeNull();
    expect(container.textContent?.trim()).not.toBe("");
  });
});
