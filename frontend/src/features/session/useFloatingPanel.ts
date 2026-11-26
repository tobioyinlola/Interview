import { useCallback, useEffect, useState } from "react";

import { isDesktopApp } from "../../app/desktop";
import { isMobileApp } from "../../app/native";

/** The name the desktop shell recognises as the answer panel's own window (desktop/src/policy.js). */
const FLOAT_FRAME = "im-float";
const WIDTH = 420;
const HEIGHT = 560;

/** Document Picture-in-Picture: a small always-on-top window that can hold real DOM (Chromium). */
interface DocumentPip {
  requestWindow: (o?: { width?: number; height?: number }) => Promise<Window>;
}
declare global {
  interface Window {
    documentPictureInPicture?: DocumentPip;
  }
}

/** Give the floating window the page's styles, since it starts as an empty document.
 *
 *  A stylesheet that has a URL (every one in the production build) is LINKED, never copied as inline
 *  text: a strict Content-Security-Policy (`style-src 'self'`) blocks inline <style> in the new
 *  window. Only a sheet with no URL (the development server's injected styles) is copied inline. */
export function copyStyles(
  from: Pick<Document, "styleSheets">,
  to: Document,
): void {
  for (const sheet of Array.from(from.styleSheets)) {
    if (sheet.href) {
      const link = to.createElement("link");
      link.rel = "stylesheet";
      link.href = sheet.href;
      to.head.appendChild(link);
      continue;
    }
    try {
      const css = Array.from(sheet.cssRules)
        .map((r) => r.cssText)
        .join("\n");
      const style = to.createElement("style");
      style.textContent = css;
      to.head.appendChild(style);
    } catch {
      /* an unreadable sheet without a URL cannot be copied */
    }
  }
}

/** Opens the answer panel in a small window that stays on top, so it is visible over Meet and the
 *  capture tab is not hidden (Chrome slows hidden tabs). It returns to the page when closed.
 *
 *  In the browser this is Chrome's Document Picture-in-Picture. The desktop app has that API but it
 *  cannot open the window there ("Internal error: no window"), so the app opens a small window of its
 *  own instead (the desktop shell makes it stay on top). The phone apps have no floating window. */
export function useFloatingPanel() {
  const [win, setWin] = useState<Window | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const desktop = isDesktopApp();
  const pip =
    typeof window !== "undefined" && !!window.documentPictureInPicture;
  const supported = desktop || (pip && !isMobileApp());

  const open = useCallback(async () => {
    if (win) return;
    setProblem(null);
    try {
      let w: Window | null;
      if (desktop) {
        w = window.open(
          "",
          FLOAT_FRAME,
          `popup=yes,width=${WIDTH},height=${HEIGHT}`,
        );
        if (!w) throw new Error("blocked");
        // the page going away takes its panel with it
        window.addEventListener("pagehide", () => w?.close(), { once: true });
      } else if (window.documentPictureInPicture) {
        w = await window.documentPictureInPicture.requestWindow({
          width: WIDTH,
          height: HEIGHT,
        });
      } else {
        return;
      }
      copyStyles(document, w.document);
      w.document.title = "Question and answer";
      w.addEventListener("pagehide", () => setWin(null)); // closed by the user: panel returns
      setWin(w);
    } catch (e) {
      // Dismissing the browser's own prompt is a choice, not a problem; anything else is said, so a
      // button never just does nothing.
      if (e instanceof DOMException && e.name === "NotAllowedError") return;
      setProblem(
        "The floating window could not open. The answer panel stays here on the page.",
      );
    }
  }, [win, desktop]);

  const close = useCallback(() => {
    win?.close();
    setWin(null);
  }, [win]);

  useEffect(() => () => win?.close(), [win]);

  return { supported, win, open, close, problem };
}
