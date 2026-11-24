import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { mockApi, renderApp } from "../test-utils";
import { PhoneUpdates } from "./PhoneUpdates";

const SHA = "b".repeat(64);
const URL =
  "https://github.com/owner/repo/releases/download/android-latest/InterviewMeet-android.apk";
const UI_URL =
  "https://github.com/owner/repo/releases/download/interface-latest/interface.zip";
const releases = (over: object = {}) => ({
  desktop: null,
  android: { version: "0.2.30", url: URL, sha256: SHA, build: 100030 },
  ui: null,
  ...over,
});

interface Parts {
  installer?: object;
  updater?: object;
  build?: string;
}
function phone({ installer, updater, build = "100025" }: Parts = {}) {
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => "android",
    Plugins: {
      App: { getInfo: async () => ({ build }), addListener: vi.fn() },
      ...(installer ? { AppInstaller: installer } : {}),
      ...(updater ? { CapacitorUpdater: updater } : {}),
    },
  } as unknown as typeof window.Capacitor;
}
const installer = (over: object = {}) => ({
  status: vi.fn().mockResolvedValue({ canInstall: true }),
  openSettings: vi.fn().mockResolvedValue(undefined),
  download: vi.fn().mockResolvedValue({ sameSigner: true, build: 100030 }),
  install: vi.fn().mockResolvedValue(undefined),
  addListener: vi.fn().mockReturnValue({ remove: vi.fn() }),
  ...over,
});
const serve = (r: object) =>
  mockApi({ "GET /api/app/releases": () => ({ json: r }) });

afterEach(() => {
  delete window.Capacitor;
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("updating the Android app without leaving it", () => {
  it("downloads the new version inside the app, checks it, and opens Android's installer", async () => {
    const inst = installer();
    phone({ installer: inst });
    serve(releases());
    renderApp(<PhoneUpdates />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Update" }),
    );
    await waitFor(() => expect(inst.install).toHaveBeenCalled());
    expect(inst.download).toHaveBeenCalledWith({ url: URL, sha256: SHA });
  });

  it("asks the person to allow updates once, then carries on", async () => {
    const inst = installer({
      status: vi.fn().mockResolvedValue({ canInstall: false }),
    });
    phone({ installer: inst });
    serve(releases());
    renderApp(<PhoneUpdates />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Update" }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Open settings" }),
    );
    expect(inst.openSettings).toHaveBeenCalled();
    expect(inst.install).not.toHaveBeenCalled();
  });

  it("says so, instead of failing in Android, when the file is signed with a different key", async () => {
    const inst = installer({
      download: vi.fn().mockResolvedValue({ sameSigner: false, build: 100030 }),
    });
    phone({ installer: inst });
    serve(releases());
    renderApp(<PhoneUpdates />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Update" }),
    );
    expect(await screen.findByText(/different key/)).toBeVisible();
    expect(inst.install).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      URL,
    );
  });

  it("explains a download that did not match its checksum, and lets the person try again", async () => {
    const inst = installer({
      download: vi
        .fn()
        .mockRejectedValueOnce(new Error("checksum"))
        .mockResolvedValue({ sameSigner: true, build: 100030 }),
    });
    phone({ installer: inst });
    serve(releases());
    renderApp(<PhoneUpdates />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Update" }),
    );
    expect(await screen.findByText(/did not match/)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(inst.install).toHaveBeenCalled());
  });

  it("refuses to install a file it has no checksum for", async () => {
    const inst = installer();
    phone({ installer: inst });
    serve(
      releases({
        android: { version: "0.2.30", url: URL, sha256: null, build: 100030 },
      }),
    );
    renderApp(<PhoneUpdates />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Update" }),
    );
    expect(await screen.findByText(/cannot be checked/)).toBeVisible();
    expect(inst.download).not.toHaveBeenCalled();
  });

  it("says nothing when the app is already the newest", async () => {
    phone({ installer: installer(), build: "100030" });
    serve(releases());
    renderApp(<PhoneUpdates />);
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("updating the interface quietly", () => {
  const ui = {
    version: "0.2.30",
    url: UI_URL,
    sha256: SHA,
    native_min: 100020,
  };

  it("fetches a newer interface in the background, then offers a restart instead of a reinstall", async () => {
    const updater = {
      download: vi.fn().mockResolvedValue({ id: "b1" }),
      next: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    };
    phone({ installer: installer(), updater });
    serve(releases({ ui }));
    renderApp(<PhoneUpdates />);
    await waitFor(() =>
      expect(updater.download).toHaveBeenCalledWith({
        url: UI_URL,
        version: "0.2.30",
        checksum: SHA,
      }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Restart" }),
    );
    expect(updater.set).toHaveBeenCalledWith({ id: "b1" });
    // the whole app did not need replacing, so there is no download-and-install offer
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
  });

  it("asks for a full update when the new interface needs a newer app", async () => {
    const updater = { download: vi.fn(), next: vi.fn(), set: vi.fn() };
    phone({ installer: installer(), updater });
    serve(releases({ ui: { ...ui, native_min: 100030 } }));
    renderApp(<PhoneUpdates />);
    expect(await screen.findByRole("button", { name: "Update" })).toBeVisible();
    expect(updater.download).not.toHaveBeenCalled();
  });
});
