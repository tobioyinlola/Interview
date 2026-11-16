import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, apiFetch } from "./client";
import type { Me, Notes, NotesInput } from "./types";

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
