import { useCallback, useEffect, useState } from "react";

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

/** Opens the answer panel in a small always-on-top window, so it stays visible over Meet and the
 *  capture tab is not hidden (Chrome slows hidden tabs). It returns to the page when closed. */
export function useFloatingPanel() {
  const [win, setWin] = useState<Window | null>(null);
  const supported =
    typeof window !== "undefined" && !!window.documentPictureInPicture;

  const open = useCallback(async () => {
    if (!window.documentPictureInPicture || win) return;
    try {
      const w = await window.documentPictureInPicture.requestWindow({
        width: 420,
        height: 560,
      });
      copyStyles(document, w.document);
      w.document.title = "Answer outline";
      w.addEventListener("pagehide", () => setWin(null)); // closed by the user: panel returns
      setWin(w);
    } catch {
      /* the browser refused (no user gesture, or the user dismissed it): stay in the page */
    }
  }, [win]);

  const close = useCallback(() => {
    win?.close();
    setWin(null);
  }, [win]);

  useEffect(() => () => win?.close(), [win]);

  return { supported, win, open, close };
}
