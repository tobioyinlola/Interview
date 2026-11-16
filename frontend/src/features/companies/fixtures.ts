import type { Brief, CompanyDetail, Source } from "../../api/types";

export const COMPANY = {
  id: "c1",
  name: "Acme",
  website_url: "https://acme.com/",
  job_posting_url: null,
  extra_links: [],
  role: "Backend Engineer",
  known_text: "",
  last_researched_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
};

export const src = (over: Partial<Source> = {}): Source => ({
  id: "s1",
  kind: "website",
  url: "https://acme.com/about",
  title: "About Acme",
  status: "ok",
  reason: "",
  published_at: null,
  fetched_at: null,
  ...over,
});

export const BRIEF: Brief = {
  assumed_company: null,
  web_search_done: true,
  no_website: false,
  dropped_facts: 0,
  sections: [
    {
      key: "snapshot",
      title: "Snapshot",
      not_found: false,
      facts: [
        {
          id: "f1",
          text: "Acme builds payment software.",
          source_ids: ["s1"],
          date: null,
          label: null,
          pinned: false,
          edited_by_user: false,
        },
      ],
    },
    {
      key: "recent_news",
      title: "Recent news",
      not_found: false,
      facts: [
        {
          id: "f2",
          text: "Acme raised a round.",
          source_ids: ["s2"],
          date: "May 2026",
          label: null,
          pinned: false,
          edited_by_user: false,
        },
      ],
    },
    {
      key: "interview_process",
      title: "Interview process",
      not_found: true,
      facts: [],
    },
    {
      key: "likely_questions",
      title: "Likely questions",
      not_found: false,
      facts: [
        {
          id: "q1",
          text: "Why Acme?",
          source_ids: [],
          date: null,
          label: "suggestion",
          pinned: false,
          edited_by_user: false,
        },
      ],
    },
  ],
};

export const SOURCES: Source[] = [
  src(),
  src({
    id: "s2",
    kind: "search_result",
    url: "https://news.example.com/a",
    title: "Acme news",
  }),
];

export const job = (status: string, over = {}) => ({
  id: "j1",
  status,
  step_detail: "",
  error: null,
  started_at: new Date().toISOString(),
  finished_at: null,
  ...over,
});

export function detail(over: Partial<CompanyDetail> = {}): CompanyDetail {
  return {
    company: COMPANY,
    brief: BRIEF,
    brief_version: 1,
    brief_created_at: new Date().toISOString(),
    sources: SOURCES,
    job: job("ready"),
    ...over,
  };
}

export const apiError = (status: number, code: string, message: string) => ({
  status,
  json: { error: { code, message, request_id: "r" } },
});
