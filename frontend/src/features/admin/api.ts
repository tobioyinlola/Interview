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
