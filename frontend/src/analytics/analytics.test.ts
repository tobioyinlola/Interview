import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { code, startCapture } from "./capture";
import {
  flush,
  persist,
  queued,
  resetClient,
  restore,
  setOptOut,
  track,
} from "./client";
import { formFactor, platform, viewport } from "./context";
import { cleanRoute, setScreen, startEngagement } from "./engagement";
import { resetIds } from "./ids";

const sent = () =>
  (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
    ([url, init]) => ({
      url: url as string,
      init: init as RequestInit,
      body: JSON.parse(String((init as RequestInit).body)),
    }),
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-26T10:00:00Z"));
  localStorage.clear();
  resetIds();
  resetClient();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ accepted: 1, rejected: 0 }), {
          status: 202,
        }),
    ),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (window as { interviewMeetDesktop?: unknown }).interviewMeetDesktop;
  delete (window as { Capacitor?: unknown }).Capacitor;
});

describe("what is sent", () => {
  it("sends a batch with the device, visit and what the event was, and nothing else", async () => {
    track("screen_view", undefined, "/dashboard");
    track("interaction", { ev: "nav.companies" }, "/dashboard");
    await flush();
    const [call] = sent();
    expect(call!.url).toMatch(/\/api\/analytics\/events$/);
    expect(call!.init.method).toBe("POST");
    expect(new Headers(call!.init.headers).get("x-requested-with")).toBe(
      "meet-practice",
    );
    const b = call!.body;
    expect(b.device_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(b.session_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(b).toMatchObject({
      platform: "web",
      form_factor: expect.any(String),
    });
    expect(b.events).toEqual([
      { name: "screen_view", ts: Date.now(), route: "/dashboard" },
      {
        name: "interaction",
        ts: Date.now(),
        route: "/dashboard",
        props: { ev: "nav.companies" },
      },
    ]);
    expect(queued()).toHaveLength(0);
  });

  it("sends on a timer, and at once when a lot has piled up", async () => {
    track("app_open");
    expect(sent()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(sent()).toHaveLength(1);
    for (let i = 0; i < 20; i++) track("app_foreground");
    await vi.advanceTimersByTimeAsync(0);
    expect(sent()).toHaveLength(2);
  });

  it("keeps the same device id across launches and starts a new visit after half an hour", async () => {
    track("app_open");
    await flush();
    track("app_open");
    await flush();
    const [a, b] = sent();
    expect(b!.body.device_id).toBe(a!.body.device_id);
    expect(b!.body.session_id).toBe(a!.body.session_id);
    vi.setSystemTime(Date.now() + 31 * 60_000);
    track("app_open");
    await flush();
    expect(sent()[2]!.body.session_id).not.toBe(a!.body.session_id);
  });
});

describe("when it must not send", () => {
  it("sends nothing after the person turned statistics off, and drops what was waiting", async () => {
    track("app_open");
    setOptOut(true);
    track("app_open");
    await flush();
    expect(sent()).toHaveLength(0);
    expect(queued()).toHaveLength(0);
    setOptOut(false);
    track("app_open");
    await flush();
    expect(sent()).toHaveLength(1);
  });

  it.each([
    ["Global Privacy Control", "globalPrivacyControl", true],
    ["Do Not Track", "doNotTrack", "1"],
  ])("honours %s", async (_n, key, value) => {
    Object.defineProperty(navigator, key, { value, configurable: true });
    track("app_open");
    await flush();
    expect(sent()).toHaveLength(0);
    delete (navigator as unknown as Record<string, unknown>)[key];
  });

  it("stops for the visit when the server says stop", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ accepted: 0, rejected: 1, stop: true }), {
        status: 202,
      }),
    );
    track("app_open");
    await flush();
    track("app_open");
    await flush();
    expect(sent()).toHaveLength(1);
  });
});

describe("a bad connection", () => {
  it("keeps events while offline and sends them when the connection is back", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    track("app_open");
    await flush();
    expect(sent()).toHaveLength(0);
    expect(queued()).toHaveLength(1);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(sent()).toHaveLength(1);
    expect(queued()).toHaveLength(0);
  });

  it("retries a failed send, with a growing wait, and does not resend what was refused", async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockRejectedValueOnce(new TypeError("network"));
    track("app_open");
    await flush();
    expect(queued()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(queued()).toHaveLength(0);
    f.mockResolvedValueOnce(new Response("{}", { status: 422 }));
    track("app_open");
    await flush();
    expect(queued()).toHaveLength(0); // refused for good: not sent again
  });

  it("is bounded: the oldest events go first", () => {
    for (let i = 0; i < 400; i++) track("app_foreground", { detail: `n${i}` });
    expect(queued().length).toBeLessThanOrEqual(300);
  });

  it("survives the app being closed: the queue is kept and picked up next launch", async () => {
    track("app_open");
    persist();
    resetClient();
    expect(queued()).toHaveLength(0);
    restore();
    expect(queued().map((e) => e.name)).toEqual(["app_open"]);
    await vi.advanceTimersByTimeAsync(2500);
    expect(sent()).toHaveLength(1);
  });
});

describe("which device it is", () => {
  it("tells apart the website, the desktop apps and the phone apps", () => {
    expect(platform()).toBe("web");
    (window as { interviewMeetDesktop?: unknown }).interviewMeetDesktop = {
      isDesktop: true,
      platform: "darwin",
    };
    expect(platform()).toBe("macos");
    expect(formFactor()).toBe("desktop");
    (window as { interviewMeetDesktop?: unknown }).interviewMeetDesktop = {
      isDesktop: true,
      platform: "win32",
    };
    expect(platform()).toBe("windows");
    delete (window as { interviewMeetDesktop?: unknown }).interviewMeetDesktop;
    (window as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => "ios",
    };
    expect(platform()).toBe("ios");
    (window as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => "android",
    };
    expect(platform()).toBe("android");
  });

  it("calls a screen a phone, tablet or computer by its width", () => {
    const at = (w: number) => {
      vi.stubGlobal("innerWidth", w);
      return [formFactor(), viewport(w)];
    };
    expect(at(390)).toEqual(["phone", "xs"]);
    expect(at(820)).toEqual(["tablet", "md"]);
    expect(at(1440)).toEqual(["desktop", "xl"]);
    vi.unstubAllGlobals();
  });
});

describe("routes and codes carry no ids and no words", () => {
  it("removes ids from a path", () => {
    expect(cleanRoute("/sessions/7c9e6679-7425-40de-944b-e07fc1f90ae7")).toBe(
      "/sessions/:id",
    );
    expect(cleanRoute("/companies/48213/?token=abc#x")).toBe("/companies/:id");
    expect(cleanRoute("/")).toBe("/");
    expect(cleanRoute("/auto-apply/applications")).toBe(
      "/auto-apply/applications",
    );
  });
  it("turns anything into a plain code", () => {
    expect(code("Tell me about yourself!")).toBe("tell_me_about_yourself_");
    expect(code("")).toBe("unknown");
    expect(code("x".repeat(90))).toHaveLength(40);
  });
});

describe("engagement", () => {
  const input = () => window.dispatchEvent(new Event("pointerdown"));
  const names = () => queued().map((e) => [e.name, e.route, e.props]);

  it("counts a screen view, and time only while the person is really there", async () => {
    const stop = startEngagement();
    setScreen("/dashboard");
    input();
    await vi.advanceTimersByTimeAsync(10_000); // active
    await vi.advanceTimersByTimeAsync(60_000); // walked away: the 30 s window ran out
    setScreen("/me");
    const engaged = queued().find((e) => e.name === "screen_engaged");
    expect(engaged).toMatchObject({ route: "/dashboard" });
    expect(engaged!.props!.seconds).toBeGreaterThanOrEqual(29); // the 30 s window, to the second
    expect(engaged!.props!.seconds).toBeLessThanOrEqual(30);
    expect(names()).toContainEqual(["screen_view", "/me", undefined]);
    stop();
  });

  it("the live interview counts as time even without touching the screen", async () => {
    const stop = startEngagement();
    setScreen("/session/:id");
    await vi.advanceTimersByTimeAsync(120_000);
    setScreen("/dashboard");
    const engaged = queued().find((e) => e.name === "screen_engaged");
    expect(engaged!.props!.seconds).toBe(120);
    stop();
  });

  it("reports the app going away and coming back, with the active time", async () => {
    const stop = startEngagement();
    setScreen("/dashboard");
    input();
    await vi.advanceTimersByTimeAsync(12_000);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    const events = sent().flatMap(
      (c) => c.body.events as { name: string; props?: object }[],
    );
    expect(events.find((e) => e.name === "app_background")!.props).toEqual({
      seconds: 12,
    });
    expect(events.map((e) => e.name)).toContain("screen_engaged"); // the screen's time is closed first
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(queued().map((e) => e.name)).toContain("app_foreground");
    stop();
  });
});

describe("capture", () => {
  it("records a marked control by its code and a menu link by its route, never its words", () => {
    const stop = startCapture();
    document.body.innerHTML = `
      <button data-ev="cv.upload">Upload my CV for Jane Smith</button>
      <nav><a href="/companies/7c9e6679-7425-40de-944b-e07fc1f90ae7">Acme private</a></nav>
      <button>Plain</button>`;
    document.querySelector<HTMLElement>("button")!.click();
    document
      .querySelector<HTMLElement>("nav a")!
      .dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    document.querySelectorAll<HTMLElement>("button")[1]!.click();
    const evs = queued()
      .filter((e) => e.name === "interaction")
      .map((e) => e.props!.ev);
    expect(evs).toEqual(["cv.upload", "nav:companies.:id"]);
    expect(JSON.stringify(queued())).not.toMatch(/Jane|Acme/);
    stop();
  });

  it("reports a crash by its type only, and not more than five a minute", () => {
    const stop = startCapture();
    for (let i = 0; i < 9; i++)
      window.dispatchEvent(
        new ErrorEvent("error", { error: new TypeError("secret text") }),
      );
    const errs = queued().filter((e) => e.name === "ui_error");
    expect(errs).toHaveLength(5);
    expect(errs[0]!.props).toEqual({ kind: "typeerror", source: "window" });
    expect(JSON.stringify(queued())).not.toMatch(/secret/);
    stop();
  });
});
