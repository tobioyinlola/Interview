import { compareVersions } from "./updates";

/** New copies of the phone app's interface, fetched from this project's releases and switched to
 *  without a new install. The running copy confirms it started cleanly; if it does not, the plugin
 *  puts the last good copy back by itself, so an update can never leave the app unable to open. */

export interface UiOffer {
  version: string;
  url: string;
  sha256: string;
  native_min: number;
}

/** The version of the interface that is running, set when the interface was built. */
export const RUNNING_UI: string = import.meta.env.VITE_UI_VERSION ?? "0.0.0";

interface Bundle {
  id: string;
}
interface Updater {
  notifyAppReady?: () => Promise<unknown>;
  download?: (o: {
    url: string;
    version: string;
    checksum?: string;
  }) => Promise<Bundle>;
  next?: (o: { id: string }) => Promise<unknown>;
  set?: (o: { id: string }) => Promise<unknown>;
}
const updater = (): Updater | undefined =>
  (window.Capacitor as { Plugins?: { CapacitorUpdater?: Updater } } | undefined)
    ?.Plugins?.CapacitorUpdater;

/** Can this app build switch interfaces by itself? Older installs cannot. */
export const canUpdateInterface = (): boolean =>
  !!updater()?.download && !!updater()?.set;

/** Only a release that is newer, only one this install can run, and only a link on this project's
 *  own release downloads. */
export function pickUiUpdate(
  offer: UiOffer | null | undefined,
  running: string,
  build: number | null,
  repoPrefix = "https://github.com/",
): UiOffer | null {
  if (!offer || build === null) return null;
  if (compareVersions(offer.version, running) <= 0) return null;
  if (build < offer.native_min) return null; // needs a newer app than this one: a full update
  if (
    !offer.url.startsWith(repoPrefix) ||
    !offer.url.includes("/releases/download/")
  )
    return null;
  if (!/^[0-9a-f]{64}$/.test(offer.sha256)) return null;
  return offer;
}

/** Does the whole app need replacing? Yes when the new interface needs a newer app than the one
 *  installed, or when this install cannot switch interfaces itself. */
export function needsAppInstall(
  android: { build?: number | null } | null | undefined,
  ui: UiOffer | null | undefined,
  build: number | null,
  otaCapable: boolean,
): boolean {
  if (!android?.build || build === null || android.build <= build) return false;
  if (!otaCapable || !ui) return true;
  return build < ui.native_min;
}

/** Tell the plugin this copy of the interface started properly (it would otherwise be rolled back). */
export async function confirmReady(): Promise<void> {
  try {
    await updater()?.notifyAppReady?.();
  } catch {
    /* nothing to confirm in this build */
  }
}

const READY = "im-ui-ready";

/** Download the offered interface in the background and queue it for the next launch. Returns
 *  whether it is ready to switch to. */
export async function prepareUiUpdate(offer: UiOffer): Promise<boolean> {
  const u = updater();
  if (!u?.download) return false;
  try {
    const bundle = await u.download({
      url: offer.url,
      version: offer.version,
      checksum: offer.sha256,
    });
    await u.next?.({ id: bundle.id });
    localStorage.setItem(
      READY,
      JSON.stringify({ id: bundle.id, version: offer.version }),
    );
    return true;
  } catch {
    return false;
  }
}

/** The interface that is downloaded and waiting, if any. */
export function readyUi(): { id: string; version: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(READY) ?? "null");
    return v &&
      typeof v.id === "string" &&
      compareVersions(v.version, RUNNING_UI) > 0
      ? v
      : null;
  } catch {
    return null;
  }
}

/** Switch to the waiting interface now (the app reloads itself). */
export async function applyReadyUi(): Promise<void> {
  const ready = readyUi();
  if (ready) await updater()?.set?.({ id: ready.id });
}
