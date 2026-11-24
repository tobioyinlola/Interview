import {
  dehydrate,
  hydrate,
  type DehydratedState,
  type QueryClient,
} from "@tanstack/react-query";

import { APP_SHELL } from "./session";

const KEY = "im-cache-v1";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CHARS = 3_000_000;

/** What the app last showed, kept on the device so it opens with real content and no internet. Only
 *  in the installed apps; the website never stores any of this. Cleared on sign-out. */
export function restoreCache(client: QueryClient): void {
  if (!APP_SHELL) return;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as { at: number; state: DehydratedState };
    if (Date.now() - saved.at > MAX_AGE_MS) return localStorage.removeItem(KEY);
    hydrate(client, saved.state);
  } catch {
    /* an unreadable cache is just an empty one */
  }
}

export function persistCache(client: QueryClient): () => void {
  if (!APP_SHELL) return () => undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    try {
      const state = dehydrate(client, {
        shouldDehydrateQuery: (q) => q.state.status === "success",
      });
      const raw = JSON.stringify({ at: Date.now(), state });
      if (raw.length <= MAX_CHARS) localStorage.setItem(KEY, raw);
    } catch {
      /* storage full or unavailable: nothing is lost but the offline copy */
    }
  };
  const stop = client.getQueryCache().subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(save, 1000);
  });
  return () => {
    clearTimeout(timer);
    stop();
  };
}

export function clearCache(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
