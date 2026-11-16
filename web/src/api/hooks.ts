import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { ApiError, apiFetch } from "./client";
import { POLL_MS, isActive } from "./polling";
import type {
  BriefEdit,
  BriefEditResult,
  Company,
  CompanyCreated,
  CompanyDetail,
  CompanyInput,
  CompanySummary,
  Me,
  Notes,
  NotesInput,
  SessionCreated,
  SessionDetail,
  SessionList,
  UsageSummary,
  Source,
} from "./types";

const json = (body: unknown) => JSON.stringify(body);

/** The signed-in user, or null when not signed in (a 401 is an answer, not an error). */
export function useMe() {
  return useQuery<Me | null>({
    queryKey: ["me"],
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      try {
        return await apiFetch<Me>("/api/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
  });
}

export function useRequestLink() {
  return useMutation({
    mutationFn: (email: string) =>
      apiFetch<{ status: string }>("/api/auth/request-link", {
        method: "POST",
        body: json({ email }),
      }),
  });
}

export function useVerifyLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      apiFetch<Me>("/api/auth/verify", {
        method: "POST",
        body: json({ token }),
      }),
    onSuccess: (me) => qc.setQueryData(["me"], me),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ status: string }>("/api/auth/logout", { method: "POST" }),
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(["me"], null);
    },
  });
}

export function useNotes() {
  return useQuery<Notes>({
    queryKey: ["notes"],
    queryFn: () => apiFetch<Notes>("/api/notes"),
  });
}

export function saveNotes(input: NotesInput) {
  return apiFetch<Notes>("/api/notes", { method: "PUT", body: json(input) });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ status: string }>("/api/account", { method: "DELETE" }),
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(["me"], null);
    },
  });
}

// ----------------------------------------------------------------- companies

export function useCompanies() {
  return useQuery<CompanySummary[]>({
    queryKey: ["companies"],
    queryFn: () => apiFetch<CompanySummary[]>("/api/companies"),
    // keep the list's status chips fresh while anything is still researching
    refetchInterval: (q) =>
      q.state.data?.some((c) => isActive(c.job_status)) ? POLL_MS : false,
  });
}

/** One company with its brief, sources and latest job. Polls while research is running, so the
 *  page updates without a reload and survives leaving and coming back. */
export function useCompany(id: string) {
  return useQuery<CompanyDetail>({
    queryKey: ["company", id],
    queryFn: () => apiFetch<CompanyDetail>(`/api/companies/${id}`),
    refetchInterval: (q) =>
      isActive(q.state.data?.job?.status) ? POLL_MS : false,
  });
}

export function useCreateCompany() {
  const qc = useQueryClient();
  return useMutation({
    // One key per attempt: a double click or retry cannot start two research jobs.
    mutationFn: ({ input, key }: { input: CompanyInput; key: string }) =>
      apiFetch<CompanyCreated>("/api/companies", {
        method: "POST",
        body: json(input),
        headers: { "idempotency-key": key },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["companies"] }),
  });
}

export function useUpdateCompany(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CompanyInput) =>
      apiFetch<Company>(`/api/companies/${id}`, {
        method: "PUT",
        body: json(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["company", id] });
      void qc.invalidateQueries({ queryKey: ["companies"] });
    },
  });
}

export function useDeleteCompany(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ status: string }>(`/api/companies/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ["company", id] });
      void qc.invalidateQueries({ queryKey: ["companies"] });
    },
  });
}

export function useRerunResearch(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ job_id: string }>(`/api/companies/${id}/research`, {
        method: "POST",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["company", id] }),
  });
}

export function usePasteSource(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; text: string }) =>
      apiFetch<Source>(`/api/companies/${id}/sources/paste`, {
        method: "POST",
        body: json(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["company", id] }),
  });
}

export function useRemoveSource(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sourceId: string) =>
      apiFetch<{ status: string }>(`/api/companies/${id}/sources/${sourceId}`, {
        method: "DELETE",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["company", id] }),
  });
}

// ------------------------------------------------------------------ sessions

export function useCreateSession() {
  return useMutation({
    mutationFn: ({
      companyId,
      role,
      key,
    }: {
      companyId: string | null;
      role?: string;
      key: string;
    }) =>
      apiFetch<SessionCreated>("/api/sessions", {
        method: "POST",
        // Consent is always explicit: the server refuses to start a session without it.
        body: json({ consent: true, company_id: companyId, role }),
        headers: { "idempotency-key": key },
      }),
  });
}

export function fetchAudioToken(sessionId: string) {
  return apiFetch<{
    audio_token: string;
    expires_in: number;
    sample_rate: number;
  }>(`/api/sessions/${sessionId}/audio-token`, { method: "POST" });
}

export function endSessionApi(sessionId: string) {
  return apiFetch<{ status: string; utterances: number; suggestions: number }>(
    `/api/sessions/${sessionId}/end`,
    { method: "POST" },
  );
}

export function useSessionDetail(id: string) {
  return useQuery<SessionDetail>({
    queryKey: ["session", id],
    queryFn: () => apiFetch<SessionDetail>(`/api/sessions/${id}`),
    refetchInterval: (q) =>
      q.state.data?.scoring_status === "running" ? POLL_MS : false,
  });
}

// ------------------------------------------------------------- M4: editing etc.

/** Send only the facts that changed: edit text, pin, add the user's own, or delete. */
export function useEditBrief(companyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (facts: BriefEdit[]) =>
      apiFetch<BriefEditResult>(`/api/companies/${companyId}/brief`, {
        method: "PUT",
        body: json({ facts }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["company", companyId] }),
  });
}

export function sendFeedback(suggestionId: string, value: "up" | "down") {
  return apiFetch<{ status: string }>(
    `/api/suggestions/${suggestionId}/feedback`,
    {
      method: "POST",
      body: json({ value }),
    },
  );
}

export function useSessions() {
  return useInfiniteQuery<SessionList>({
    queryKey: ["sessions"],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      apiFetch<SessionList>(
        `/api/sessions?limit=20${pageParam ? `&cursor=${encodeURIComponent(String(pageParam))}` : ""}`,
      ),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ status: string }>(`/api/sessions/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }),
  });
}

/** Start scoring, then keep refreshing the session until scoring finishes. */
export function useScoreSession(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ status: string }>(`/api/sessions/${id}/score`, {
        method: "POST",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["session", id] }),
  });
}

/** The owner's cost view. Only admins can load it (everyone else gets a 404). */
export function useAdminUsage(days: number) {
  return useQuery<UsageSummary>({
    queryKey: ["admin-usage", days],
    queryFn: () => apiFetch<UsageSummary>(`/api/admin/usage?days=${days}`),
    retry: false,
  });
}
