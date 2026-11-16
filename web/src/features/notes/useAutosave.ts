import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

interface Options {
  /** False until the server value has loaded, so loading is never mistaken for an edit. */
  enabled: boolean;
  /** Milliseconds after the last change before saving. FR-02 requires within 2 s. */
  delayMs?: number;
}

/** Saves `value` shortly after it stops changing. Unsaved changes are also flushed on unmount,
 *  so navigating away inside the delay window does not lose them. */
export function useAutosave<T>(
  value: T,
  save: (v: T) => Promise<unknown>,
  opts: Options,
) {
  const { enabled, delayMs = 1500 } = opts;
  const [status, setStatus] = useState<SaveStatus>("idle");
  const key = JSON.stringify(value);
  const baseline = useRef<string | null>(null); // last value known to be on the server
  const latest = useRef({ value, key });
  const saveRef = useRef(save);

  useEffect(() => {
    latest.current = { value, key };
    saveRef.current = save;
  });

  const flush = useCallback(async () => {
    const { value: v, key: k } = latest.current;
    if (k === baseline.current) return;
    setStatus("saving");
    try {
      await saveRef.current(v);
      baseline.current = k;
      setStatus(latest.current.key === k ? "saved" : "dirty");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (baseline.current === null) {
      baseline.current = key; // first loaded value is the starting point, not an edit
      return;
    }
    if (key === baseline.current) return;
    setStatus("dirty");
    const timer = setTimeout(() => void flush(), delayMs);
    return () => clearTimeout(timer);
  }, [key, enabled, delayMs, flush]);

  useEffect(
    () => () => {
      if (
        baseline.current !== null &&
        latest.current.key !== baseline.current
      ) {
        void saveRef.current(latest.current.value).catch(() => undefined);
      }
    },
    [],
  );

  return { status, retry: flush };
}
