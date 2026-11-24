import { act, render, screen } from "@testing-library/react";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  delete (window as { Capacitor?: unknown }).Capacitor;
});

async function banner(app: boolean) {
  vi.resetModules();
  if (app) vi.stubEnv("VITE_APP_SHELL", "1");
  const { OfflineBanner } = await import("./OfflineBanner");
  return OfflineBanner;
}

describe("the offline banner", () => {
  it("tells people in the app, calmly, when the connection drops and goes away when it returns", async () => {
    const OfflineBanner = await banner(true);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<OfflineBanner />);
    expect(screen.queryByRole("status")).toBeNull();
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toHaveTextContent(/offline/i);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("is never shown on the website", async () => {
    const OfflineBanner = await banner(false);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<OfflineBanner />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
