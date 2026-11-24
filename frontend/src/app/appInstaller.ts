/** The Android app's own installer plugin (mobile/android/.../AppInstallerPlugin.java): downloads the
 *  new app file inside the app, checks it, and hands it to Android's installer. */

interface Installer {
  status?: () => Promise<{ canInstall: boolean }>;
  openSettings?: () => Promise<void>;
  download?: (o: {
    url: string;
    sha256: string;
  }) => Promise<{ sameSigner: boolean; build: number }>;
  install?: () => Promise<void>;
  addListener?: (
    name: "progress",
    fn: (e: { received: number; total: number }) => void,
  ) => Promise<{ remove: () => void }> | { remove: () => void };
}
const installer = (): Installer | undefined =>
  (window.Capacitor as { Plugins?: { AppInstaller?: Installer } } | undefined)
    ?.Plugins?.AppInstaller;

export const installerAvailable = (): boolean => !!installer()?.download;

export type InstallFailure =
  | "permission"
  | "checksum"
  | "network"
  | "http"
  | "storage"
  | "missing"
  | "install"
  | "unknown";

export class InstallError extends Error {
  constructor(public reason: InstallFailure) {
    super(reason);
  }
}

const reason = (e: unknown): InstallFailure => {
  const m = String((e as { message?: string; code?: string })?.message ?? e);
  for (const r of [
    "permission",
    "checksum",
    "network",
    "http",
    "storage",
    "missing",
    "install",
  ] as const)
    if (m.includes(r)) return r;
  return "unknown";
};

export const canInstall = async (): Promise<boolean> =>
  (await installer()?.status?.())?.canInstall ?? false;

export const openInstallSettings = async (): Promise<void> => {
  await installer()?.openSettings?.();
};

/** Download and check the file. `onProgress` is 0 to 1 (or null while the size is unknown). */
export async function downloadUpdate(
  url: string,
  sha256: string,
  onProgress: (fraction: number | null) => void,
): Promise<{ sameSigner: boolean }> {
  const p = installer();
  if (!p?.download) throw new InstallError("unknown");
  const sub = await Promise.resolve(
    p.addListener?.("progress", (e) =>
      onProgress(e.total > 0 ? Math.min(1, e.received / e.total) : null),
    ),
  );
  try {
    const out = await p.download({ url, sha256 });
    return { sameSigner: out.sameSigner };
  } catch (e) {
    throw new InstallError(reason(e));
  } finally {
    sub?.remove?.();
  }
}

export async function installDownloaded(): Promise<void> {
  try {
    await installer()?.install?.();
  } catch (e) {
    throw new InstallError(reason(e));
  }
}
