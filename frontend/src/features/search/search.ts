/** What can be found, and how it is matched. Kept apart from the screen so it is easy to test. */
import type { CompanySummary, SessionSummary } from "../../api/types";
import { formatWhen } from "../review/format";

export interface Result {
  id: string;
  group: "Pages" | "Companies" | "Sessions";
  label: string;
  hint?: string;
  to: string;
}

const PAGES: { label: string; to: string; words: string }[] = [
  { label: "Overview", to: "/dashboard", words: "dashboard home" },
  { label: "CV", to: "/notes", words: "upload resume notes target role" },
  { label: "Companies", to: "/companies", words: "research brief add company" },
  {
    label: "Start an interview",
    to: "/session/new",
    words: "practice session new interview start",
  },
  { label: "Sessions", to: "/sessions", words: "history review past calls" },
  {
    label: "Invite friends",
    to: "/referrals",
    words: "referral refer free session reward link redeem",
  },
  {
    label: "Onboarding answers",
    to: "/onboarding",
    words: "focus goal level timeline update preferences",
  },
  {
    label: "Help",
    to: "/help",
    words: "guide tour how to faq support start question",
  },
  { label: "Settings", to: "/settings", words: "name account delete data" },
  { label: "Privacy", to: "/privacy", words: "data policy" },
  { label: "Terms", to: "/terms", words: "legal use" },
];

const norm = (s: string) => s.toLowerCase().normalize("NFKD");

/** Every word typed must appear somewhere in the item, in any order. */
const matches = (query: string, ...fields: (string | null | undefined)[]) => {
  const hay = norm(fields.filter(Boolean).join(" "));
  return norm(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
};

export const PER_GROUP = 4;

export function search(
  query: string,
  companies: CompanySummary[],
  sessions: SessionSummary[],
): Result[] {
  const q = query.trim();
  if (!q) return [];
  const pages: Result[] = PAGES.filter((p) => matches(q, p.label, p.words)).map(
    (p) => ({
      id: `page:${p.to}`,
      group: "Pages",
      label: p.label,
      to: p.to,
    }),
  );
  const cos: Result[] = companies
    .filter((c) => matches(q, c.name))
    .map((c) => ({
      id: `company:${c.id}`,
      group: "Companies",
      label: c.name,
      hint: c.job_status === "ready" ? "Brief ready" : undefined,
      to: `/companies/${c.id}`,
    }));
  const sess: Result[] = sessions
    .filter((s) => matches(q, s.company_name, formatWhen(s.started_at)))
    .map((s) => ({
      id: `session:${s.id}`,
      group: "Sessions",
      label: formatWhen(s.started_at),
      hint: s.company_name ?? "No company",
      to: `/sessions/${s.id}`,
    }));
  return [
    ...pages.slice(0, PER_GROUP),
    ...cos.slice(0, PER_GROUP),
    ...sess.slice(0, PER_GROUP),
  ];
}
