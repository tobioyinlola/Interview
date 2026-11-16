import { render, screen } from "@testing-library/react";

import type { SessionSummary } from "../../api/types";
import { PracticeChart } from "./PracticeChart";

const s = (i: number, q: number): SessionSummary => ({
  id: `s${i}`,
  started_at: `2026-11-${String(10 + i).padStart(2, "0")}T10:00:00Z`,
  ended_at: "x",
  duration_seconds: 600,
  status: "ended",
  company_id: null,
  company_name: null,
  question_count: q,
});

describe("PracticeChart", () => {
  it("draws nothing it cannot back: fewer than two sessions shows a plain message", () => {
    render(<PracticeChart sessions={[s(1, 3)]} />);
    expect(screen.getByText(/after two sessions/i)).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("plots each session oldest to newest and describes the data for screen readers", () => {
    // the API lists newest first
    render(<PracticeChart sessions={[s(3, 7), s(2, 5), s(1, 3)]} />);
    const chart = screen.getByRole("img", { name: /questions per session/i });
    const label = chart.getAttribute("aria-label") ?? "";
    expect(label.indexOf(": 3")).toBeLessThan(label.indexOf(": 5"));
    expect(label.indexOf(": 5")).toBeLessThan(label.indexOf(": 7"));
    expect(chart.querySelectorAll("circle")).toHaveLength(3);
  });
});
