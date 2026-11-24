import { hideNativeSplash } from "./nativeSplash";

afterEach(() => {
  delete (window as { Capacitor?: unknown }).Capacitor;
});

describe("hiding the phone's own splash", () => {
  it("does nothing outside the phone app", () => {
    expect(() => hideNativeSplash()).not.toThrow();
  });

  it("asks the plugin to lift when the app has its first frame", () => {
    const hide = vi.fn();
    (window as { Capacitor?: unknown }).Capacitor = {
      Plugins: { SplashScreen: { hide } },
    };
    hideNativeSplash();
    expect(hide).toHaveBeenCalledWith({ fadeOutDuration: 150 });
  });

  it("falls back to the bridge call, and never throws if it fails", () => {
    const nativePromise = vi.fn(() => {
      throw new Error("no bridge");
    });
    (window as { Capacitor?: unknown }).Capacitor = { nativePromise };
    expect(() => hideNativeSplash()).not.toThrow();
    expect(nativePromise).toHaveBeenCalledWith("SplashScreen", "hide", {
      fadeOutDuration: 150,
    });
  });
});
