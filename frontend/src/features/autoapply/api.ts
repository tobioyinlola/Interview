import { openGoogleStep } from "../auth/nativeGoogle";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { apiFetch } from "../../api/client";
import type {
  AAAnswer,
  AAApplication,
  AAApplicationDetail,
  AAApplicationPage,
  AACampaign,
  AADashboard,
  AADisclosure,
  AAFacts,
  AAInterview,
  AAMailbox,
  AAOutreach,
  AAPrepared,
  AAProfile,
  AAProfileIn,
  AARecruiting,
  AARun,
} from "../../api/types";

const P = "/api/autoapply";
const json = (body: unknown) => JSON.stringify(body);
const post = <T>(path: string, body?: unknown) =>
  apiFetch<T>(`${P}${path}`, {
    method: "POST",
    body: body === undefined ? undefined : json(body),
  });

/** Every Auto-Apply query shares one key prefix, so one call refreshes whatever changed. */
function useRefresh() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ["aa"] });
}

export const useDashboard = (enabled = true) =>
  useQuery<AADashboard>({
    queryKey: ["aa", "dashboard"],
    queryFn: () => apiFetch(`${P}/dashboard`),
    refetchInterval: 60_000,
    enabled,
  });

export const useAAProfile = () =>
  useQuery<AAProfile>({
    queryKey: ["aa", "profile"],
    queryFn: () => apiFetch(`${P}/profile`),
  });

export function useSaveProfile() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: AAProfileIn) =>
      apiFetch<AAProfile>(`${P}/profile`, { method: "PUT", body: json(body) }),
    onSuccess: refresh,
  });
}

export const useFacts = () =>
  useQuery<AAFacts | null>({
    queryKey: ["aa", "facts"],
    queryFn: () => apiFetch(`${P}/facts`),
  });

export const useExtractFacts = () =>
  useMutation({ mutationFn: () => post<AAFacts>("/facts/extract") });

export function useSaveFacts() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (v: { data: Record<string, unknown>; verified: boolean }) =>
      apiFetch<AAFacts>(`${P}/facts`, { method: "PUT", body: json(v) }),
    onSuccess: refresh,
  });
}

export const useAnswers = () =>
  useQuery<AAAnswer[]>({
    queryKey: ["aa", "answers"],
    queryFn: () => apiFetch(`${P}/answers`),
  });

export function useSaveAnswer() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (v: {
      field: string;
      question: string;
      value: string;
      reusable: boolean;
    }) =>
      apiFetch<AAAnswer>(`${P}/answers/${encodeURIComponent(v.field)}`, {
        method: "PUT",
        body: json({
          question: v.question,
          value: v.value,
          reusable: v.reusable,
        }),
      }),
    onSuccess: refresh,
  });
}

export function useDeleteAnswer() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (field: string) =>
      apiFetch(`${P}/answers/${encodeURIComponent(field)}`, {
        method: "DELETE",
      }),
    onSuccess: refresh,
  });
}

export const useDisclosure = () =>
  useQuery<AADisclosure>({
    queryKey: ["aa", "authorization"],
    queryFn: () => apiFetch(`${P}/authorization`),
  });

export function useCampaignActions() {
  const refresh = useRefresh();
  const opts = { onSuccess: refresh };
  return {
    enable: useMutation({
      mutationFn: (policy_version: string) =>
        post<AACampaign>("/campaign/enable", { policy_version, accept: true }),
      ...opts,
    }),
    pause: useMutation({
      mutationFn: () => post<AACampaign>("/campaign/pause"),
      ...opts,
    }),
    resume: useMutation({
      mutationFn: () => post<AACampaign>("/campaign/resume"),
      ...opts,
    }),
  };
}

export const useMailbox = () =>
  useQuery<AAMailbox>({
    queryKey: ["aa", "mailbox"],
    queryFn: () => apiFetch(`${P}/mailbox`),
  });

export function useMailboxActions() {
  const refresh = useRefresh();
  return {
    connect: useMutation({
      mutationFn: () =>
        post<{ connected: boolean; url: string | null }>("/mailbox/connect"),
      onSuccess: (res) => {
        if (res.url) void openGoogleStep(res.url);
        else refresh();
      },
    }),
    disconnect: useMutation({
      mutationFn: () => post<AAMailbox>("/mailbox/disconnect"),
      onSuccess: refresh,
    }),
  };
}

export function useRunDiscovery() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: () => post<AARun | null>("/discovery/run"),
    onSuccess: refresh,
  });
}

export function useAddJob() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (url: string) => post<AAApplication>("/jobs", { url }),
    onSuccess: refresh,
  });
}

export const useApplications = (status: string) =>
  useInfiniteQuery<AAApplicationPage>({
    queryKey: ["aa", "applications", status],
    initialPageParam: "",
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams();
      if (status) q.set("status", status);
      if (pageParam) q.set("before", String(pageParam));
      const s = q.toString();
      return apiFetch(`${P}/applications${s ? `?${s}` : ""}`);
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });

export const useApplication = (id: string) =>
  useQuery<AAApplicationDetail>({
    queryKey: ["aa", "application", id],
    queryFn: () => apiFetch(`${P}/applications/${id}`),
  });

export function useApplicationActions(id: string) {
  const refresh = useRefresh();
  const opts = { onSuccess: refresh };
  return {
    answer: useMutation({
      mutationFn: (v: {
        field: string;
        value: string;
        save_for_reuse: boolean;
      }) => post<AAApplication>(`/applications/${id}/answer`, v),
      ...opts,
    }),
    approve: useMutation({
      mutationFn: (rule: string) =>
        post<AAApplication>(`/applications/${id}/approve`, { rule }),
      ...opts,
    }),
    skip: useMutation({
      mutationFn: () => post<AAApplication>(`/applications/${id}/skip`),
      ...opts,
    }),
    retry: useMutation({
      mutationFn: () => post<AAApplication>(`/applications/${id}/retry`),
      ...opts,
    }),
    resolve: useMutation({
      mutationFn: (sent: boolean) =>
        post<AAApplication>(`/applications/${id}/resolve`, { sent }),
      ...opts,
    }),
    outreach: useMutation({
      mutationFn: (recipient: string) =>
        post<AAOutreach>(`/applications/${id}/outreach`, { recipient }),
      ...opts,
    }),
  };
}

export const useInterviews = () =>
  useQuery<AAInterview[]>({
    queryKey: ["aa", "interviews"],
    queryFn: () => apiFetch(`${P}/interviews`),
  });

export const usePrepareInterview = () =>
  useMutation({
    mutationFn: (id: string) => post<AAPrepared>(`/interviews/${id}/prepare`),
  });

export const useReviewQueue = () =>
  useQuery<AARecruiting[]>({
    queryKey: ["aa", "review"],
    queryFn: () => apiFetch(`${P}/recruiting?status=needs_review`),
  });

export function useRecruitingActions() {
  const refresh = useRefresh();
  const opts = { onSuccess: refresh };
  return {
    link: useMutation({
      mutationFn: (v: { id: string; application_id: string }) =>
        post<AARecruiting>(`/recruiting/${v.id}/link`, {
          application_id: v.application_id,
        }),
      ...opts,
    }),
    dismiss: useMutation({
      mutationFn: (id: string) =>
        post<AARecruiting>(`/recruiting/${id}/dismiss`),
      ...opts,
    }),
    confirmTime: useMutation({
      mutationFn: (v: { id: string; timezone: string }) =>
        post<AARecruiting>(`/recruiting/${v.id}/confirm-time`, {
          timezone: v.timezone,
        }),
      ...opts,
    }),
  };
}
