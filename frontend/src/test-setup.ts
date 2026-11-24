import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

afterEach(() => {
  delete (window as unknown as { interviewMeetDesktop?: unknown }).interviewMeetDesktop;
});
