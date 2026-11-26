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
  it("is on only while a private screen is open, and never during a live session", () => {
    expect(wanted({ enabled: true, live: false, open: 1 })).toBe(true);
    expect(wanted({ enabled: true, live: false, open: 0 })).toBe(false);
    expect(wanted({ enabled: false, live: false, open: 1 })).toBe(false);
    expect(wanted({ enabled: true, live: true, open: 1 })).toBe(false);
  });

  it("asks the desktop app's window for protection, and turns it off for a live session", async () => {
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
    privacy.setLive(true);
    await privacy.settled();
    expect(set).toHaveBeenLastCalledWith(false);
    expect(setLive).toHaveBeenCalledWith(true);
    expect(usePrivacy.getState().active).toBe(false);
    privacy.setLive(false);
    privacy.leavePrivate();
    await privacy.settled();
    expect(set).toHaveBeenLastCalledWith(false);
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
