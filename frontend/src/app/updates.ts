import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { apiFetch } from "../api/client";
import { isDesktopApp } from "./desktop";
import { isMobileApp } from "./native";

interface AppReleases {
  desktop: {
    version: string;
    windows?: string | null;
    mac_arm64?: string | null;
    mac_x64?: string | null;
  } | null;
  android: { version: string; url: string } | null;
}

const DISMISSED = "im-update-dismissed";

/** 1 when a is newer than b, -1 when older, 0 when equal (x.y.z, compared as numbers). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** The version of the desktop app we are running in (its shell adds it to the browser name). */
export function desktopVersion(ua = navigator.userAgent): string | null {
  return /InterviewMeetDesktop\/(\d+\.\d+\.\d+)/.exec(ua)?.[1] ?? null;
}

interface AppPlugin {
  getInfo?: () => Promise<{ version?: string }>;
}
const phoneApp = (): AppPlugin | undefined =>
  (window.Capacitor as { Plugins?: { App?: AppPlugin } } | undefined)?.Plugins
    ?.App;

const dismissedVersion = (): string | null => {
  try {
    return localStorage.getItem(DISMISSED);
  } catch {
    return null;
  }
};

/** A newer version of the installed app than the one running, with where to get it. Only where the
 *  app cannot update itself: a Mac app that is not yet signed and an Android app installed from a
 *  file. Windows apps update themselves, and an iPhone app will come through the App Store. */
export function useAppUpdate(): {
  version: string;
  url: string;
  dismiss: () => void;
} | null {
  const desktop = isDesktopApp();
  const phone = isMobileApp();
  const native = desktop || phone;
  const [installed, setInstalled] = useState<string | null>(
    desktop ? desktopVersion() : null,
  );
  const [dismissed, setDismissed] = useState<string | null>(dismissedVersion);

  useEffect(() => {
    if (!phone) return;
    phoneApp()
      ?.getInfo?.()
      .then((i) => setInstalled(i.version ?? null))
      .catch(() => undefined);
  }, [phone]);

  const releases = useQuery<AppReleases>({
    queryKey: ["app-releases"],
    queryFn: () => apiFetch<AppReleases>("/api/app/releases"),
    enabled: native && !!installed,
    staleTime: 30 * 60_000,
    retry: false,
  });

  if (!native || !installed || !releases.data) return null;
  let latest: string | null = null;
  let url: string | null = null;
  if (desktop && window.interviewMeetDesktop?.platform === "darwin") {
    const d = releases.data.desktop;
    latest = d?.version ?? null;
    url =
      (window.interviewMeetDesktop.arch === "arm64"
        ? d?.mac_arm64
        : d?.mac_x64) ?? null;
  } else if (phone && window.Capacitor?.getPlatform?.() === "android") {
    latest = releases.data.android?.version ?? null;
    url = releases.data.android?.url ?? null;
  }
  if (!latest || !url || compareVersions(latest, installed) <= 0) return null;
  if (dismissed === latest) return null;
  return {
    version: latest,
    url,
    dismiss: () => {
      try {
        localStorage.setItem(DISMISSED, latest!);
      } catch {
        /* the banner just comes back next time */
      }
      setDismissed(latest);
    },
  };
}

const NOTIFIED = "im-update-notified";

interface LocalNotifications {
  requestPermissions?: () => Promise<{ display?: string }>;
  schedule?: (o: {
    notifications: {
      id: number;
      title: string;
      body: string;
      schedule: { at: Date };
      extra: { url: string };
    }[];
  }) => Promise<unknown>;
}
const notifications = (): LocalNotifications | undefined =>
  (
    window.Capacitor as
      { Plugins?: { LocalNotifications?: LocalNotifications } } | undefined
  )?.Plugins?.LocalNotifications;

/** Pop up a phone notification saying a newer version can be downloaded: once per version, only if
 *  the person allowed notifications, and only in an app build that has the notification plugin
 *  (older builds quietly do nothing and keep the banner). Returns whether one was shown. */
export async function notifyUpdate(
  version: string,
  url: string,
): Promise<boolean> {
  const plugin = notifications();
  if (!plugin?.schedule) return false;
  try {
    if (localStorage.getItem(NOTIFIED) === version) return false;
  } catch {
    /* no memory: at worst it shows again */
  }
  try {
    const allowed = await plugin.requestPermissions?.();
    if (allowed?.display && allowed.display !== "granted") return false;
    await plugin.schedule({
      notifications: [
        {
          id: 4201,
          title: "InterviewMeet update",
          body: `Version ${version} is ready. Tap to update.`,
          schedule: { at: new Date(Date.now() + 1500) },
          extra: { url },
        },
      ],
    });
    try {
      localStorage.setItem(NOTIFIED, version);
    } catch {
      /* see above */
    }
    return true;
  } catch {
    return false;
  }
}
