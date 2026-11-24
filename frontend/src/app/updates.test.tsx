import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ME, mockApi, renderApp, stubSupportedBrowser } from "../test-utils";
import { App } from "./App";
import { compareVersions, desktopVersion, notifyUpdate } from "./updates";

afterEach(() => {
  vi.restoreAllMocks();
  delete window.interviewMeetDesktop;
  delete window.Capacitor;
  localStorage.clear();
});

const RELEASES = {
  desktop: {
    version: "0.2.20",
    windows:
      "https://github.com/o/r/releases/download/desktop-v0.2.20/InterviewMeet-Setup.exe",
    mac_arm64:
      "https://github.com/o/r/releases/download/desktop-v0.2.20/InterviewMeet-mac-arm64.dmg",
    mac_x64:
      "https://github.com/o/r/releases/download/desktop-v0.2.20/InterviewMeet-mac-x64.dmg",
  },
  android: {
    version: "0.2.21",
    url: "https://github.com/o/r/releases/download/android-latest/InterviewMeet-android.apk",
  },
};

const api = () =>
  mockApi({
    "GET /api/me": () => ({ json: { ...ME, onboarded: true } }),
    "GET /api/app/releases": () => ({ json: RELEASES }),
    "GET /api/notes": () => ({
      json: { role: "", content: "", updated_at: null },
    }),
    "GET /api/companies": () => ({ json: [] }),
    "GET /api/sessions": () => ({ json: { items: [], next_cursor: null } }),
  });

const asMac = (version: string, arch: string) => {
  stubSupportedBrowser();
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
    `Mozilla/5.0 (Macintosh) Chrome/130.0 InterviewMeetDesktop/${version}`,
  );
  window.interviewMeetDesktop = {
    isDesktop: true,
    platform: "darwin",
    arch,
    systemAudio: true,
  };
};

describe("version numbers", () => {
  it("compare as numbers, not text", () => {
    expect(compareVersions("0.2.10", "0.2.9")).toBe(1);
    expect(compareVersions("0.2.9", "0.2.10")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
  it("the desktop version is read from the app's browser name", () => {
    expect(desktopVersion("x Chrome/1 InterviewMeetDesktop/0.2.7")).toBe(
      "0.2.7",
    );
    expect(desktopVersion("plain browser")).toBeNull();
  });
});

describe("the update banner", () => {
  it("offers a Mac the download for its own chip when a newer version exists", async () => {
    asMac("0.2.3", "arm64");
    api();
    renderApp(<App />, "/dashboard");
    const update = await screen.findByRole("link", { name: "Update" });
    expect(update).toHaveAttribute("href", RELEASES.desktop.mac_arm64);
    expect(screen.getByText(/0\.2\.20/)).toBeInTheDocument();
  });

  it("gives an Intel Mac the Intel file", async () => {
    asMac("0.2.3", "x64");
    api();
    renderApp(<App />, "/dashboard");
    expect(await screen.findByRole("link", { name: "Update" })).toHaveAttribute(
      "href",
      RELEASES.desktop.mac_x64,
    );
  });

  it("says nothing when the app is already the newest", async () => {
    asMac("0.2.20", "arm64");
    api();
    renderApp(<App />, "/dashboard");
    await screen.findAllByText(/Overview/);
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Update" })).toBeNull(),
    );
  });

  it("says nothing on Windows, which updates itself", async () => {
    stubSupportedBrowser();
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Chrome/130 InterviewMeetDesktop/0.2.3",
    );
    window.interviewMeetDesktop = {
      isDesktop: true,
      platform: "win32",
      arch: "x64",
      systemAudio: true,
    };
    api();
    renderApp(<App />, "/dashboard");
    await screen.findAllByText(/Overview/);
    expect(screen.queryByRole("link", { name: "Update" })).toBeNull();
  });

  it("offers the Android file in the Android app", async () => {
    stubSupportedBrowser();
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => "android",
      Plugins: {
        App: { getInfo: () => Promise.resolve({ version: "0.2.4" }) },
      },
    } as unknown as typeof window.Capacitor;
    api();
    renderApp(<App />, "/dashboard");
    expect(await screen.findByRole("link", { name: "Update" })).toHaveAttribute(
      "href",
      RELEASES.android.url,
    );
  });

  it("stays away for a version the person chose to skip", async () => {
    asMac("0.2.3", "arm64");
    api();
    renderApp(<App />, "/dashboard");
    await userEvent.click(await screen.findByRole("button", { name: "Later" }));
    expect(screen.queryByRole("link", { name: "Update" })).toBeNull();
    expect(localStorage.getItem("im-update-dismissed")).toBe("0.2.20");
  });

  it("is not there at all on the website", async () => {
    stubSupportedBrowser();
    api();
    renderApp(<App />, "/dashboard");
    await screen.findAllByText(/Overview/);
    expect(screen.queryByRole("link", { name: "Update" })).toBeNull();
  });
});

describe("the update pop-up notification", () => {
  const url =
    "https://github.com/o/r/releases/download/android-latest/InterviewMeet-android.apk";
  const plugin = (display = "granted") => ({
    requestPermissions: vi.fn().mockResolvedValue({ display }),
    schedule: vi.fn().mockResolvedValue({}),
    addListener: vi.fn(),
  });
  const withPlugin = (p: ReturnType<typeof plugin>) => {
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: { LocalNotifications: p },
    } as unknown as typeof window.Capacitor;
  };

  it("pops up once per version when notifications are allowed", async () => {
    const p = plugin();
    withPlugin(p);
    expect(await notifyUpdate("0.2.30", url)).toBe(true);
    expect(p.schedule).toHaveBeenCalledTimes(1);
    const sent = p.schedule.mock.calls[0][0].notifications[0];
    expect(sent.title).toMatch(/update/i);
    expect(sent.body).toContain("0.2.30");
    expect(sent.extra.url).toBe(url);
    expect(await notifyUpdate("0.2.30", url)).toBe(false); // not again for the same version
    expect(await notifyUpdate("0.2.31", url)).toBe(true); // but for the next one
  });

  it("stays quiet when the person said no to notifications", async () => {
    const p = plugin("denied");
    withPlugin(p);
    expect(await notifyUpdate("0.2.30", url)).toBe(false);
    expect(p.schedule).not.toHaveBeenCalled();
  });

  it("does nothing in an app build without the notification plugin", async () => {
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {},
    } as unknown as typeof window.Capacitor;
    expect(await notifyUpdate("0.2.30", url)).toBe(false);
  });
});
