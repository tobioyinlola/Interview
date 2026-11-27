import { capability, privacy, usePrivacy, wanted } from "./privacy";

afterEach(() => {
  delete (window as { interviewMeetDesktop?: unknown }).interviewMeetDesktop;
  delete (window as { Capacitor?: unknown }).Capacitor;
  usePrivacy.setState({
    enabled: true,
    presentation: false,
    live: false,
    open: 0,
    active: false,
    captured: false,
    problem: null,
  });
});

describe("privacy controller", () => {
  it("is on only while a private screen is open, and never during a live session (mobile)", () => {
    // Mobile/web: respects live flag and open count
    expect(wanted({ enabled: true, live: false, open: 1 })).toBe(true);
    expect(wanted({ enabled: true, live: false, open: 0 })).toBe(false);
    expect(wanted({ enabled: false, live: false, open: 1 })).toBe(false);
    expect(wanted({ enabled: true, live: true, open: 1 })).toBe(false);
  });

  it("is always on when enabled on desktop, regardless of live state (AGENTS.md mandate)", () => {
    window.interviewMeetDesktop = {
      isDesktop: true,
      platform: "win32",
      systemAudio: true,
    };
    expect(wanted({ enabled: true, live: false, open: 0 })).toBe(true);
    expect(wanted({ enabled: true, live: true, open: 0 })).toBe(true);
    expect(wanted({ enabled: true, live: true, open: 1 })).toBe(true);
    expect(wanted({ enabled: false, live: false, open: 0 })).toBe(false);
  });

  it("keeps desktop protection on even during a live session (AGENTS.md mandate)", async () => {
    const set = vi.fn(async (on: boolean) => ({ active: on }));
    const setLive = vi.fn(async () => undefined);
    window.interviewMeetDesktop = {
      isDesktop: true,
      platform: "win32",
      systemAudio: true,
      privacy: { set, setLive },
    };
    privacy.enterPrivate();
    await privacy.settled();
    expect(set).toHaveBeenLastCalledWith(true);
    expect(usePrivacy.getState().active).toBe(true);
    // Going live must NOT turn off protection on desktop
    privacy.setLive(true);
    await privacy.settled();
    expect(set).toHaveBeenLastCalledWith(true);
    expect(usePrivacy.getState().active).toBe(true);
    privacy.setLive(false);
    privacy.leavePrivate();
    await privacy.settled();
    // Still on because desktop wanted() returns enabled regardless of open count
    expect(set).toHaveBeenLastCalledWith(true);
  });

  it("uses the phone app's Privacy plugin, and says so plainly when it fails", async () => {
    const setProtected = vi.fn(async () => {
      throw new Error("no");
    });
    (window as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => "android",
      Plugins: { Privacy: { setProtected } },
    };
    privacy.enterPrivate();
    await privacy.settled();
    expect(setProtected).toHaveBeenCalledWith({ on: true });
    expect(usePrivacy.getState().problem).toMatch(/could not be switched on/);
    privacy.leavePrivate();
    await privacy.settled();
  });

  it("describes each platform honestly", () => {
    expect(capability("ios").limits.join(" ")).toMatch(
      /cannot stop screenshots/,
    );
    expect(capability("macos").limits.join(" ")).toMatch(/can still show it/);
    expect(capability("windows").limits.join(" ")).toMatch(
      /Windows 10 version 2004/,
    );
    expect(capability("web").method).toBe("none");
  });
});
