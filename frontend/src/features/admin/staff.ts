import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, apiFetch } from "../../api/client";

export interface Staff {
  email: string;
  full_name: string | null;
}

const post = <T>(path: string, body?: unknown) =>
  apiFetch<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** The staff member signed in to the back office, or null. This is a separate sign-in from the
 *  customer app: being signed in there does not count here. */
export function useStaff() {
  return useQuery<Staff | null>({
    queryKey: ["staff"],
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      try {
        return await apiFetch<Staff>("/api/admin/auth/me");
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 404))
          return null;
        throw e;
      }
    },
  });
}

export function useStaffLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { email: string; password: string }) =>
      post<Staff>("/api/admin/auth/login", v),
    onSuccess: (s) => qc.setQueryData(["staff"], s),
  });
}

export function useStaffLink() {
  return useMutation({
    mutationFn: (email: string) =>
      post<{ status: string }>("/api/admin/auth/request-link", { email }),
  });
}

export function useStaffVerify() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      post<Staff>("/api/admin/auth/verify", { token }),
    onSuccess: (s) => qc.setQueryData(["staff"], s),
  });
}

export function useStaffLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<{ status: string }>("/api/admin/auth/logout"),
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(["staff"], null);
    },
  });
}
