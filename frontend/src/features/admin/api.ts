import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { apiFetch } from "../../api/client";
import type {
  AdminActivity,
  AdminAutoApply,
  AdminSwitch,
  AdminEmails,
  AdminMarketing,
  AdminOverview,
  AdminQuality,
  AdminReferrals,
  AdminTemplate,
  AdminTemplatePreview,
  AdminUserDetail,
  AdminUserList,
} from "../../api/types";

const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o))
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const useOverview = (days: number) =>
  useQuery<AdminOverview>({
    queryKey: ["admin", "overview", days],
    queryFn: () => apiFetch(`/api/admin/overview${qs({ days })}`),
  });

export interface UserParams {
  q: string;
  sort: string;
  offset: number;
  limit: number;
}
export const useAdminUsers = (p: UserParams) =>
  useQuery<AdminUserList>({
    queryKey: ["admin", "users", p],
    queryFn: () => apiFetch(`/api/admin/users${qs({ ...p })}`),
    placeholderData: (prev) => prev,
  });

export const useAdminUser = (id: string) =>
  useQuery<AdminUserDetail>({
    queryKey: ["admin", "user", id],
    queryFn: () => apiFetch(`/api/admin/users/${id}`),
  });

export function useGrantCredits(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { count: number; reason: string; notify: boolean }) =>
      apiFetch<AdminUserDetail>(`/api/admin/users/${id}/credits`, {
        method: "POST",
        body: JSON.stringify({
          count: v.count,
          reason: v.reason.trim() || null,
          notify: v.notify,
        }),
      }),
    onSuccess: (d) => {
      qc.setQueryData(["admin", "user", id], d);
      void qc.invalidateQueries({ queryKey: ["admin", "users"] });
      void qc.invalidateQueries({ queryKey: ["admin", "activity"] });
    },
  });
}

export interface ActivityParams {
  kind: string;
  category: string;
  q: string;
  user_id?: string;
}
export const useActivity = (p: ActivityParams) =>
  useInfiniteQuery<AdminActivity>({
    queryKey: ["admin", "activity", p],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      apiFetch(
        `/api/admin/activity${qs({ ...p, limit: 50, before: String(pageParam) })}`,
      ),
    getNextPageParam: (last) => last.next_before ?? undefined,
  });

export const activityCsvUrl = (base: string, p: ActivityParams) =>
  `${base}/api/admin/activity/export.csv${qs({ ...p })}`;

export const useAdminReferrals = (days: number) =>
  useQuery<AdminReferrals>({
    queryKey: ["admin", "referrals", days],
    queryFn: () => apiFetch(`/api/admin/referrals${qs({ days })}`),
  });

export function useApproveReferral() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<AdminReferrals>(`/api/admin/referrals/${id}/approve`, {
        method: "POST",
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin"] }),
  });
}

export const useMarketing = (days: number) =>
  useQuery<AdminMarketing>({
    queryKey: ["admin", "marketing", days],
    queryFn: () => apiFetch(`/api/admin/marketing${qs({ days })}`),
  });

export const useQuality = (days: number) =>
  useQuery<AdminQuality>({
    queryKey: ["admin", "quality", days],
    queryFn: () => apiFetch(`/api/admin/quality${qs({ days })}`),
  });

export interface EmailParams {
  kind: string;
  status: string;
  q: string;
}
export const useEmails = (p: EmailParams) =>
  useQuery<AdminEmails>({
    queryKey: ["admin", "emails", p],
    queryFn: () => apiFetch(`/api/admin/emails${qs({ ...p, limit: 50 })}`),
  });

export const useTemplates = () =>
  useQuery<AdminTemplate[]>({
    queryKey: ["admin", "templates"],
    queryFn: () => apiFetch("/api/admin/emails/templates"),
  });

export const useTemplatePreview = (kind: string | null) =>
  useQuery<AdminTemplatePreview>({
    queryKey: ["admin", "template", kind],
    queryFn: () => apiFetch(`/api/admin/emails/templates/${kind}`),
    enabled: kind !== null,
  });

export const useAutoApplyAdmin = (days: number) =>
  useQuery<AdminAutoApply>({
    queryKey: ["admin", "autoapply", days],
    queryFn: () => apiFetch(`/api/admin/autoapply${qs({ days })}`),
    refetchInterval: 30_000,
  });

export function useFlipSwitch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { name: string; on: boolean; reason: string }) =>
      apiFetch<AdminSwitch>(`/api/admin/autoapply/switches/${v.name}`, {
        method: "PUT",
        body: JSON.stringify({ on: v.on, reason: v.reason }),
      }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["admin", "autoapply"] }),
  });
}

export interface AdminDirectory {
  id: string;
  name: string;
  url: string;
  region_hint: string;
  enabled: boolean;
  builtin: boolean;
  last_run_at: string | null;
  last_found: number;
  last_added: number;
  last_problem: string | null;
}

export interface AdminStartups {
  startups: number;
  by_status: Record<string, number>;
  by_region: Record<string, number>;
  with_contacts: number;
  with_openings: number;
  directories: AdminDirectory[];
}

export interface AdminOpening {
  title: string;
  url: string;
}
export interface AdminContact {
  email: string;
  name: string | null;
  title: string | null;
  kind: string;
  source_url: string;
}
export interface AdminFounder {
  name: string;
  title: string;
  source: string;
  email: string | null;
}
export interface AdminStartup {
  id: string;
  name: string;
  website: string;
  domain: string;
  directory: string;
  directory_url: string;
  batch: string | null;
  one_liner: string;
  sector: string | null;
  region: string;
  country: string | null;
  status: string;
  researched_at: string | null;
  created_at: string;
  summary: string;
  hiring: boolean;
  careers_url: string | null;
  openings: AdminOpening[];
  founders: AdminFounder[];
  contacts: AdminContact[];
}
export interface AdminStartupList {
  total: number;
  items: AdminStartup[];
}
export interface AdminRole {
  startup_id: string;
  startup: string;
  website: string;
  region: string;
  country: string | null;
  directory: string;
  title: string;
  url: string;
  careers_url: string | null;
}
export interface AdminRoles {
  total: number;
  startups: number;
  items: AdminRole[];
}

const SU = "/api/admin/startups";
export const PAGE = 25;

export const useStartupList = (p: {
  filter: string;
  region: string;
  directory: string;
  q: string;
  page: number;
}) =>
  useQuery<AdminStartupList>({
    queryKey: ["admin", "startup-list", p],
    queryFn: () => {
      const qs = new URLSearchParams({
        filter: p.filter,
        region: p.region,
        directory: p.directory,
        q: p.q,
        limit: String(PAGE),
        offset: String(p.page * PAGE),
      });
      return apiFetch(`${SU}/list?${qs}`);
    },
    placeholderData: (prev) => prev,
  });

export const useOpenRoles = (p: { region: string; q: string; page: number }) =>
  useQuery<AdminRoles>({
    queryKey: ["admin", "open-roles", p],
    queryFn: () => {
      const qs = new URLSearchParams({
        region: p.region,
        q: p.q,
        limit: String(PAGE),
        offset: String(p.page * PAGE),
      });
      return apiFetch(`${SU}/roles?${qs}`);
    },
    placeholderData: (prev) => prev,
  });

export const useStartupsAdmin = () =>
  useQuery<AdminStartups>({
    queryKey: ["admin", "startups"],
    queryFn: () => apiFetch(`${SU}/overview`),
    refetchInterval: 30_000,
  });

function useStartupsMutation<V, R>(run: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["admin", "startups"] }),
  });
}

export const useAddDirectory = () =>
  useStartupsMutation((v: { name: string; url: string; region_hint: string }) =>
    apiFetch<AdminDirectory>(`${SU}/directories`, {
      method: "POST",
      body: JSON.stringify(v),
    }),
  );

export const useToggleDirectory = () =>
  useStartupsMutation((v: { id: string; enabled: boolean }) =>
    apiFetch<AdminDirectory>(`${SU}/directories/${v.id}`, {
      method: "PUT",
      body: JSON.stringify({ enabled: v.enabled }),
    }),
  );

export const useDeleteDirectory = () =>
  useStartupsMutation((id: string) =>
    apiFetch<void>(`${SU}/directories/${id}`, { method: "DELETE" }),
  );

export const useRefreshDirectory = () =>
  useStartupsMutation((id: string) =>
    apiFetch<AdminDirectory>(`${SU}/directories/${id}/refresh`, {
      method: "POST",
    }),
  );

export const useImportStartups = () =>
  useStartupsMutation(
    (v: {
      directory: string;
      region_hint: string;
      startups: {
        name: string;
        website: string;
        country: string;
        one_liner: string;
      }[];
    }) =>
      apiFetch<{ added: number; skipped: number }>(`${SU}/import`, {
        method: "POST",
        body: JSON.stringify(v),
      }),
  );
