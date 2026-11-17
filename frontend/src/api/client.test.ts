import { ApiError, apiFetch, socketBase } from "./client";

afterEach(() => vi.restoreAllMocks());

describe("apiFetch", () => {
  it("maps the shared error shape to ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: "invalid_url",
                message: "Bad link",
                request_id: "r1",
              },
            }),
            { status: 422 },
          ),
      ),
    );
    await expect(apiFetch("/api/x")).rejects.toMatchObject({
      status: 422,
      code: "invalid_url",
      requestId: "r1",
    });
    await expect(apiFetch("/api/x")).rejects.toBeInstanceOf(ApiError);
  });

  it("sends the CSRF header and cookies on mutations only", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch("/api/x", { method: "PUT", body: "{}" });
    await apiFetch("/api/x");
    const [, put] = fetchMock.mock.calls[0];
    const [, get] = fetchMock.mock.calls[1];
    expect(new Headers(put.headers).get("x-requested-with")).toBe(
      "meet-practice",
    );
    expect(new Headers(get.headers).get("x-requested-with")).toBeNull();
    expect(put.credentials).toBe("include");
  });
});

describe("socketBase", () => {
  it("turns an API address into its WebSocket address", () => {
    expect(socketBase("http://localhost:8000")).toBe("ws://localhost:8000");
    expect(socketBase("https://api.example.com")).toBe("wss://api.example.com");
  });

  it("uses this page's own origin when the API is on the same origin (empty base)", () => {
    expect(
      socketBase("", { protocol: "https:", host: "app.example.com" }),
    ).toBe("wss://app.example.com");
    expect(socketBase("", { protocol: "http:", host: "localhost:5173" })).toBe(
      "ws://localhost:5173",
    );
  });
});
