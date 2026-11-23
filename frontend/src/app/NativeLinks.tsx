import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { capacitorPlugins } from "../features/auth/nativeGoogle";
import { isMobileApp } from "./native";

/** The phone app hears the interviewmeet:// address the browser hands back after Google sign-in
 *  and carries on inside the app. (On desktop the app's main process does the same job.) */
export function NativeLinks() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!isMobileApp()) return;
    void Promise.resolve(
      capacitorPlugins()?.App?.addListener("appUrlOpen", ({ url }) => {
        let link: URL;
        try {
          link = new URL(url);
        } catch {
          return;
        }
        if (link.protocol !== "interviewmeet:" || link.hostname !== "auth")
          return;
        const code = link.searchParams.get("code");
        const error = link.searchParams.get("error");
        const next = new URLSearchParams();
        if (code && /^[\w-]{20,200}$/.test(code)) next.set("code", code);
        else if (error && /^[a-z_]{1,40}$/.test(error))
          next.set("error", error);
        else return;
        // close the in-app browser sheet if the phone left one open
        void (
          capacitorPlugins() as {
            Browser?: { close?: () => Promise<void> };
          }
        )?.Browser?.close?.()?.catch?.(() => undefined);
        navigate(`/auth/app?${next}`, { replace: true });
      }),
    );
  }, [navigate]);
  return null;
}
