import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { apiFetch } from "../../../api/client";
import type { AutoRun, AutoRunEvent } from "../../../api/types";

const P = "/api/autoapply/run";

export const useRun = (enabled = true) =>
  useQuery<AutoRun>({
    queryKey: ["aa", "run"],
    queryFn: () => apiFetch(P),
    enabled,
    // the live feed below refreshes it the moment something happens; this is the safety net
    refetchInterval: 8000,
  });

/** Follows the run as it happens: holds a request open until there is a new event, then refreshes
 *  the picture. Plain HTTP, so it works the same on the web, in the desktop app and on the phone. */
export function useRunLive(after: number | undefined, enabled = true) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled || after === undefined) return;
    let stop = false;
    let seq = after;
    const ctl = new AbortController();
    (async () => {
      while (!stop) {
        const began = Date.now();
        try {
          const r = await apiFetch<{
            events: AutoRunEvent[];
            last_seq: number;
          }>(`${P}/events?after=${seq}&wait=20`, { signal: ctl.signal });
          if (stop) return;
          if (r.events.length > 0) {
            seq = r.last_seq;
            void qc.invalidateQueries({ queryKey: ["aa", "run"] });
          }
          // a server that answers at once (no waiting) must not be asked in a tight loop
          if (r.events.length === 0 && Date.now() - began < 1000)
            await new Promise((res) => setTimeout(res, 2000));
        } catch {
          if (stop) return;
          await new Promise((res) => setTimeout(res, 4000)); // offline or restarting: try again
        }
      }
    })();
    return () => {
      stop = true;
      ctl.abort();
    };
  }, [after, enabled, qc]);
}

export function useRunControl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: "start" | "pause" | "resume" | "skip" | "stop") =>
      apiFetch<AutoRun>(`${P}/${action}`, { method: "POST" }),
    onSuccess: (data) => {
      qc.setQueryData(["aa", "run"], data);
      void qc.invalidateQueries({ queryKey: ["aa"] });
    },
  });
}

export function useRunSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      speed?: "slow" | "normal" | "fast";
      execution_mode?: "auto" | "desktop" | "cloud";
    }) =>
      apiFetch<AutoRun>(`${P}/settings`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => qc.setQueryData(["aa", "run"], data),
  });
}
