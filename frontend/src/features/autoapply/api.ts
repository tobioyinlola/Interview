import { trackFeature } from "../../analytics";
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
  AAMailboxCheck,
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
      onSuccess: () => {
        trackFeature("autoapply_enable");
        refresh();
      },
    }),
    pause: useMutation({
      mutationFn: () => post<AACampaign>("/campaign/pause"),
      onSuccess: () => {
        trackFeature("autoapply_pause");
        refresh();
      },
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
    /** Log in to the connected mailbox again to confirm it works (nothing is sent). */
    check: useMutation({
      mutationFn: () => post<AAMailboxCheck>("/mailbox/check"),
      onSettled: refresh,
    }),
    /** Connect with an app password: Gmail, Outlook or Yahoo. */
    connectWithPassword: useMutation({
      mutationFn: (b: {
        provider: string;
        address: string;
        password: string;
      }) => post<AAMailbox>("/mailbox/connect-smtp", b),
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

export type RecheckResult = {
  checked: number;
  now_ready: number;
  still_skipped: number;
  left_alone: number;
};

/** Judge many skipped roles again. The server takes 50 at a time, so a long list goes in turns. */
export function useRecheckSkipped() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (ids: string[]): Promise<RecheckResult> => {
      const total: RecheckResult = {
        checked: 0,
        now_ready: 0,
        still_skipped: 0,
        left_alone: 0,
      };
      for (let i = 0; i < ids.length; i += 50) {
        const r = await post<RecheckResult>("/applications/recheck", {
          ids: ids.slice(i, i + 50),
        });
        total.checked += r.checked;
        total.now_ready += r.now_ready;
        total.still_skipped += r.still_skipped;
        total.left_alone += r.left_alone;
      }
      return total;
    },
    onSuccess: () => {
      trackFeature("autoapply_recheck_skipped");
      refresh();
    },
  });
}

export type RetryFailedResult = {
  retried: number;
  queued: number;
  need_you: number;
  left_alone: number;
};

/** Try failed applications again: the ones named, or every failed one. One that may already have
 *  reached the employer is never repeated (it is counted as left alone). */
export function useRetryFailed() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (ids: string[] = []) =>
      post<RetryFailedResult>("/applications/retry-failed", { ids }),
    onSuccess: () => refresh(),
  });
}

/** One plain sentence for what a retry did. */
export function retrySummary(r: RetryFailedResult): string {
  if (r.retried === 0 && r.left_alone === 0)
    return "There was nothing to try again.";
  const parts: string[] = [];
  if (r.queued) parts.push(`${r.queued} back in the queue`);
  if (r.need_you) parts.push(`${r.need_you} need an answer from you first`);
  const rest = r.retried - r.queued - r.need_you;
  if (rest > 0) parts.push(`${rest} checked again (see each one for why)`);
  if (r.left_alone)
    parts.push(
      `${r.left_alone} may already have reached the employer, so left alone`,
    );
  return parts.join(" · ") + ".";
}

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
    applied: useMutation({
      mutationFn: () => post<AAApplication>(`/applications/${id}/applied`),
      onSuccess: () => {
        trackFeature("autoapply_applied_by_you");
        refresh();
      },
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
