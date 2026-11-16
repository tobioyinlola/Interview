/** How often research progress is refreshed while a job is running (FR-07: every 2 s). */
export const POLL_MS = 2000;

export const ACTIVE_JOB = ["queued", "reading_pages", "searching", "writing"];
export const isActive = (status: string | null | undefined) =>
  !!status && ACTIVE_JOB.includes(status);
