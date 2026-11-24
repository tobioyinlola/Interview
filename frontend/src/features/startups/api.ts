import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../../api/client";

export type HuntSettings = {
  enabled: boolean;
  regions: string[];
  roles: string[];
  pitch: string;
  daily_cap: number;
  auto_send: boolean;
  sender_name: string;
  postal_address: string;
  mailbox: string | null;
  ready: string[];
};

export type HuntTarget = {
  id: string;
  startup: string;
  website: string;
  one_liner: string;
  region: string;
  contact: string;
  contact_kind: string;
  contact_source: string;
  fit: number;
  fit_reasons: string[];
  step: number;
  subject: string;
  body: string;
  status: string;
  reason: string | null;
  sent_at: string | null;
};

const P = "/api/hunt";
const post = <T>(path: string, body?: unknown) =>
  apiFetch<T>(`${P}${path}`, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

function useRefresh() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ["hunt"] });
}

export const useHuntSettings = () =>
  useQuery<HuntSettings>({
    queryKey: ["hunt", "settings"],
    queryFn: () => apiFetch(`${P}/settings`),
  });

export const useHuntTargets = () =>
  useQuery<HuntTarget[]>({
    queryKey: ["hunt", "targets"],
    queryFn: () => apiFetch(`${P}/targets`),
    refetchInterval: 60_000,
  });

export function useSaveHuntSettings() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Omit<HuntSettings, "mailbox" | "ready">) =>
      apiFetch<HuntSettings>(`${P}/settings`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: refresh,
  });
}

export function useTargetActions() {
  const refresh = useRefresh();
  const opts = { onSuccess: refresh };
  return {
    approve: useMutation({
      mutationFn: (id: string) => post<HuntTarget>(`/targets/${id}/approve`),
      ...opts,
    }),
    skip: useMutation({
      mutationFn: (id: string) => post<HuntTarget>(`/targets/${id}/skip`),
      ...opts,
    }),
    edit: useMutation({
      mutationFn: (v: { id: string; subject: string; body: string }) =>
        apiFetch<HuntTarget>(`${P}/targets/${v.id}`, {
          method: "PUT",
          body: JSON.stringify({ subject: v.subject, body: v.body }),
        }),
      ...opts,
    }),
  };
}
