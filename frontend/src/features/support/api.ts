import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../../api/client";
import type {
  SupportTicket,
  SupportTicketDetail,
  SupportTicketInput,
} from "../../api/types";

const P = "/api/support";
const body = (b: unknown) => JSON.stringify(b);

export const useTickets = () =>
  useQuery<{ items: SupportTicket[] }>({
    queryKey: ["support", "tickets"],
    queryFn: () => apiFetch(`${P}/tickets`),
  });

export const useTicket = (id: string) =>
  useQuery<SupportTicketDetail>({
    queryKey: ["support", "ticket", id],
    queryFn: () => apiFetch(`${P}/tickets/${id}`),
    // a reply from the team shows up without leaving the page
    refetchInterval: 30_000,
  });

/** How many conversations have an answer the person has not read, for the badge in the menu. */
export const useUnread = (enabled = true) =>
  useQuery<{ count: number }>({
    queryKey: ["support", "unread"],
    queryFn: () => apiFetch(`${P}/unread`),
    enabled,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

function useRefresh() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ["support"] });
}

export function useOpenTicket() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (v: SupportTicketInput) =>
      apiFetch<SupportTicketDetail>(`${P}/tickets`, {
        method: "POST",
        body: body(v),
      }),
    onSuccess: refresh,
  });
}

export function useReply(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (text: string) =>
      apiFetch<SupportTicketDetail>(`${P}/tickets/${id}/messages`, {
        method: "POST",
        body: body({ body: text }),
      }),
    onSuccess: refresh,
  });
}

export function useResolve(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: () =>
      apiFetch<SupportTicketDetail>(`${P}/tickets/${id}/resolve`, {
        method: "POST",
      }),
    onSuccess: refresh,
  });
}
