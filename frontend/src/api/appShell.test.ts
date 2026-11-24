import { QueryClient } from "@tanstack/react-query";

/** The installed apps are built with VITE_APP_SHELL=1: their own copy of the interface, a bearer
 *  token instead of the browser cookie, and a copy of the last screens kept on the device. */
async function inApp() {
  vi.resetModules();
  vi.stubEnv("VITE_APP_SHELL", "1");
  vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com");
  const session = await import("./session");
  const client = await import("./client");
  const persist = await import("./persist");
  return { ...session, ...client, ...persist };
}

const reply = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the website", () => {
  it("keeps using its cookie and sends nothing extra", async () => {
    vi.resetModules();
    const s = await import("./session");
    expect(s.APP_SHELL).toBe(false);
    const init = s.authInit({ method: "GET" });
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).has("authorization")).toBe(false);
    expect(new Headers(init.headers).has("x-client")).toBe(false);
  });
});

describe("the installed apps", () => {
  it("send the saved token as a bearer and never a cookie", async () => {
    localStorage.setItem("im-session-token", "tok-123");
    const a = await inApp();
    await a.loadSession();
    const init = a.authInit();
    const h = new Headers(init.headers);
    expect(h.get("authorization")).toBe("Bearer tok-123");
    expect(h.get("x-client")).toBe("app");
    expect(init.credentials).toBe("omit");
  });

  it("keep the token the server hands back on sign-in, and use it from then on", async () => {
    const a = await inApp();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        reply(200, { id: "u" }, { "x-session-token": "fresh-token" }),
      )
      .mockResolvedValueOnce(reply(200, { ok: true }));
    await a.apiFetch("/api/auth/login", { method: "POST", body: "{}" });
    expect(localStorage.getItem("im-session-token")).toBe("fresh-token");
    await a.apiFetch("/api/me");
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://api.example.com/api/me");
    expect(
      new Headers((init as RequestInit).headers).get("authorization"),
    ).toBe("Bearer fresh-token");
  });

  it("forget the token and the saved screens on sign-out", async () => {
    localStorage.setItem("im-session-token", "tok");
    localStorage.setItem("im-cache-v1", "{}");
    const a = await inApp();
    await a.loadSession();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      reply(200, { status: "ok" }),
    );
    await a.apiFetch("/api/auth/logout", { method: "POST" });
    expect(localStorage.getItem("im-session-token")).toBeNull();
    expect(localStorage.getItem("im-cache-v1")).toBeNull();
    expect(a.hasSessionToken()).toBe(false);
  });

  it("drop a token the server no longer accepts", async () => {
    localStorage.setItem("im-session-token", "stale");
    const a = await inApp();
    await a.loadSession();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      reply(401, {
        error: {
          code: "not_authenticated",
          message: "Please sign in.",
          request_id: "r",
        },
      }),
    );
    await expect(a.apiFetch("/api/me")).rejects.toMatchObject({ status: 401 });
    expect(localStorage.getItem("im-session-token")).toBeNull();
  });

  it("say plainly that there is no connection", async () => {
    const a = await inApp();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("Failed to fetch"),
    );
    await expect(a.apiFetch("/api/me")).rejects.toMatchObject({
      status: 0,
      code: "network",
      message: expect.stringMatching(/offline/i),
    });
  });

  it("keep the last screens on the device and bring them back, even offline", async () => {
    const a = await inApp();
    const first = new QueryClient();
    first.setQueryData(["me"], { email: "ada@example.com" });
    const stop = a.persistCache(first);
    first.setQueryData(["companies"], [{ id: 1 }]); // a cache change is saved a moment later
    await new Promise((r) => setTimeout(r, 1200));
    stop();
    const second = new QueryClient();
    a.restoreCache(second);
    expect(second.getQueryData(["me"])).toEqual({ email: "ada@example.com" });
    expect(second.getQueryData(["companies"])).toEqual([{ id: 1 }]);
    a.clearCache();
    const third = new QueryClient();
    a.restoreCache(third);
    expect(third.getQueryData(["me"])).toBeUndefined();
  });

  it("ignore a saved copy that is a week old or unreadable", async () => {
    const a = await inApp();
    localStorage.setItem("im-cache-v1", "not json");
    expect(() => a.restoreCache(new QueryClient())).not.toThrow();
    localStorage.setItem(
      "im-cache-v1",
      JSON.stringify({
        at: Date.now() - 8 * 86400_000,
        state: { queries: [], mutations: [] },
      }),
    );
    a.restoreCache(new QueryClient());
    expect(localStorage.getItem("im-cache-v1")).toBeNull();
  });
});
