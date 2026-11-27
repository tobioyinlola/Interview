import { trackFeature } from "../../analytics";
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
  prefilled: boolean;
  paused: boolean;
};

export type Opening = { title: string; url: string };

export type HuntTarget = {
  id: string;
  startup: string;
  website: string;
  one_liner: string;
  region: string;
  contact: string;
  contact_kind: string;
  contact_source: string;
  careers_url: string | null;
  openings: Opening[];
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

export type HuntDelivery = {
  approved: number;
  blockers: { code: string; text: string; where: string }[];
};

/** Why approved notes are waiting, in words: so a note is never held back in silence. */
export const useHuntDelivery = () =>
  useQuery<HuntDelivery>({
    queryKey: ["hunt", "delivery"],
    queryFn: () => apiFetch(`${P}/delivery`),
    refetchInterval: 60_000,
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
    mutationFn: (
      body: Omit<HuntSettings, "mailbox" | "ready" | "prefilled" | "paused">,
    ) =>
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

/** Startup outreach is by invitation: ask to be let in. */
export function useRequestOutreachAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<{ access: string }>("/access/request"),
    onSuccess: () => {
      trackFeature("outreach_request");
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

/** How many startups outreach can write to, said the way a headline can honestly say it. */
export const useReach = () =>
  useQuery<{ companies: number; label: string }>({
    queryKey: ["hunt", "reach"],
    queryFn: () => apiFetch(`${P}/reach`),
    staleTime: 10 * 60_000,
  });

// ------------------------------------------------------------ your own emails

export type HuntTemplate = {
  use_template: boolean;
  first_subject: string;
  first_body: string;
  follow_subject: string;
  follow_body: string;
  variables: Record<string, string>;
  follow_up_enabled: boolean;
  follow_up_days: number;
  send_not_before: string | null;
  window_start: number;
  window_end: number;
  builtin: Record<string, string>;
  starter: Record<string, string>;
  unknown: string[];
};

export type TemplatePreview = {
  subject: string;
  body: string;
  company: string;
  missing: string[];
};

export const useHuntTemplate = (enabled = true) =>
  useQuery<HuntTemplate>({
    queryKey: ["hunt", "template"],
    queryFn: () => apiFetch(`${P}/template`),
    enabled,
  });

export function useSaveTemplate() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Omit<HuntTemplate, "builtin" | "starter" | "unknown">) =>
      apiFetch<HuntTemplate>(`${P}/template`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: refresh,
  });
}

/** What an email would look like for a real startup, with nothing sent or saved. */
export const usePreviewTemplate = () =>
  useMutation({
    mutationFn: (v: {
      which: "first" | "follow";
      subject: string;
      body: string;
      variables: Record<string, string>;
    }) => post<TemplatePreview>("/template/preview", v),
  });
