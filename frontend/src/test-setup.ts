import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// The live session waits for the interviewer to finish before answering (see features/session/
// timing.ts). Tests run at the old, quick timings unless they say otherwise.
import { timing } from "./features/session/timing";
Object.assign(timing, {
  afterQuestionMs: 0,
  afterStatementMs: 1200,
  unfinishedMs: 1200,
  announcedMs: 1200,
  quietGuardMs: 0,
  guardCapMs: 0,
});

afterEach(() => {
  delete (window as unknown as { interviewMeetDesktop?: unknown }).interviewMeetDesktop;
  delete (window as unknown as { interviewDesktop?: unknown }).interviewDesktop;
});
