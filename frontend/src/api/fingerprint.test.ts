import { apiFetch } from "./client";
import {
  fingerprint,
  fingerprintInputs,
  initFingerprint,
  sha256Hex,
} from "./fingerprint";

afterEach(() => vi.restoreAllMocks());

describe("device fingerprint", () => {
  it("describes the device with plain facts and leaves the browser's name out", () => {
    const text = fingerprintInputs();
    expect(text.split("|")).toHaveLength(6);
    expect(text.toLowerCase()).not.toContain("mozilla");
    expect(text.toLowerCase()).not.toContain("chrome");
  });

  it("is the same whichever way a tablet is held", () => {
    const original = { width: screen.width, height: screen.height };
    const set = (w: number, h: number) =>
      vi.stubGlobal("screen", {
        ...original,
        width: w,
        height: h,
        colorDepth: 24,
      });
    set(1920, 1080);
    const landscape = fingerprintInputs();
    set(1080, 1920);
    expect(fingerprintInputs()).toBe(landscape);
  });

  it("hashes to 64 hex characters, so no raw value leaves the browser", async () => {
    const h = await sha256Hex("anything at all");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex("anything at all")).toBe(h);
    expect(await sha256Hex("something else")).not.toBe(h);
  });

  it("is sent with API requests once it has been worked out", async () => {
    await initFingerprint();
    expect(fingerprint()).toMatch(/^[0-9a-f]{64}$/);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch("/api/me");
    const sent = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(sent.get("x-device-fp")).toBe(fingerprint());
  });

  it("carries on without one when the browser cannot hash", async () => {
    vi.stubGlobal("crypto", {});
    await initFingerprint();
    expect(fingerprint()).toBeUndefined();
  });
});
