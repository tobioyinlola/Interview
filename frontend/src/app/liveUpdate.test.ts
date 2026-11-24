import {
  applyReadyUi,
  confirmReady,
  needsAppInstall,
  pickUiUpdate,
  prepareUiUpdate,
  readyUi,
  type UiOffer,
} from "./liveUpdate";

const SHA = "a".repeat(64);
const offer = (over: Partial<UiOffer> = {}): UiOffer => ({
  version: "0.2.30",
  url: "https://github.com/owner/repo/releases/download/interface-latest/interface.zip",
  sha256: SHA,
  native_min: 100020,
  ...over,
});

afterEach(() => {
  delete window.Capacitor;
  localStorage.clear();
});

describe("which new interface a phone may switch to", () => {
  it("takes a newer one that the installed app can run", () => {
    expect(pickUiUpdate(offer(), "0.2.25", 100025)?.version).toBe("0.2.30");
  });
  it("ignores the same or an older one", () => {
    expect(
      pickUiUpdate(offer({ version: "0.2.25" }), "0.2.25", 100025),
    ).toBeNull();
    expect(
      pickUiUpdate(offer({ version: "0.2.9" }), "0.2.25", 100025),
    ).toBeNull();
  });
  it("leaves one that needs a newer app than the one installed", () => {
    expect(
      pickUiUpdate(offer({ native_min: 100030 }), "0.2.25", 100025),
    ).toBeNull();
  });
  it("refuses a link that is not this project's release download, or a bad checksum", () => {
    expect(
      pickUiUpdate(
        offer({ url: "https://evil.test/interface.zip" }),
        "0.2.1",
        100025,
      ),
    ).toBeNull();
    expect(
      pickUiUpdate(
        offer({ url: "https://github.com/owner/repo/archive/x.zip" }),
        "0.2.1",
        100025,
      ),
    ).toBeNull();
    expect(pickUiUpdate(offer({ sha256: "nope" }), "0.2.1", 100025)).toBeNull();
  });
  it("does nothing before the installed build is known", () => {
    expect(pickUiUpdate(offer(), "0.2.1", null)).toBeNull();
    expect(pickUiUpdate(null, "0.2.1", 100025)).toBeNull();
  });
});

describe("when the whole app has to be replaced", () => {
  const android = { build: 100030 };
  it("is not needed when the app is already the newest", () => {
    expect(needsAppInstall({ build: 100025 }, null, 100025, true)).toBe(false);
  });
  it("is not needed when a new interface covers it and the app can run that", () => {
    expect(
      needsAppInstall(android, offer({ native_min: 100020 }), 100025, true),
    ).toBe(false);
  });
  it("is needed when the new interface requires a newer app", () => {
    expect(
      needsAppInstall(android, offer({ native_min: 100030 }), 100025, true),
    ).toBe(true);
  });
  it("is needed when this app cannot switch interfaces itself, or none is published", () => {
    expect(needsAppInstall(android, offer(), 100025, false)).toBe(true);
    expect(needsAppInstall(android, null, 100025, true)).toBe(true);
  });
});

describe("switching interfaces", () => {
  const withPlugin = (u: object) => {
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: { CapacitorUpdater: u },
    } as unknown as typeof window.Capacitor;
  };

  it("downloads with the checksum, queues it for the next launch, and remembers it is waiting", async () => {
    const u = {
      download: vi.fn().mockResolvedValue({ id: "bundle-1" }),
      next: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    };
    withPlugin(u);
    expect(await prepareUiUpdate(offer())).toBe(true);
    expect(u.download).toHaveBeenCalledWith({
      url: offer().url,
      version: "0.2.30",
      checksum: SHA,
    });
    expect(u.next).toHaveBeenCalledWith({ id: "bundle-1" });
    expect(readyUi()).toEqual({ id: "bundle-1", version: "0.2.30" });
    await applyReadyUi();
    expect(u.set).toHaveBeenCalledWith({ id: "bundle-1" });
  });

  it("reports a failed download without throwing, and keeps nothing waiting", async () => {
    withPlugin({
      download: vi.fn().mockRejectedValue(new Error("checksum")),
      next: vi.fn(),
    });
    expect(await prepareUiUpdate(offer())).toBe(false);
    expect(readyUi()).toBeNull();
  });

  it("does nothing in a build without the updater", async () => {
    expect(await prepareUiUpdate(offer())).toBe(false);
    await expect(applyReadyUi()).resolves.toBeUndefined();
    await expect(confirmReady()).resolves.toBeUndefined();
  });

  it("tells the plugin the new interface started properly, so it is not rolled back", async () => {
    const notifyAppReady = vi.fn().mockResolvedValue({});
    withPlugin({ notifyAppReady });
    await confirmReady();
    expect(notifyAppReady).toHaveBeenCalled();
  });
});
