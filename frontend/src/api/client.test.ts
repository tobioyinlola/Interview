import { ApiError, apiFetch } from "./client";

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
