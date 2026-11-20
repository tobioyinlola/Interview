import type { CompanySummary, SessionSummary } from "../../api/types";
import { search } from "./search";

const co = (id: string, name: string, job_status: string | null = null) =>
  ({ id, name, job_status, last_researched_at: null }) as CompanySummary;
const se = (id: string, company_name: string | null) =>
  ({
    id,
    started_at: "2026-11-16T10:00:00Z",
    ended_at: "x",
    duration_seconds: 60,
    status: "ended",
    company_id: null,
    company_name,
    question_count: 2,
  }) as SessionSummary;

describe("search", () => {
  it("finds nothing for an empty or blank query", () => {
    expect(search("", [co("1", "Acme")], [])).toEqual([]);
    expect(search("   ", [co("1", "Acme")], [])).toEqual([]);
  });

  it("finds pages by name and by what they are for", () => {
    expect(search("compan", [], []).map((r) => r.to)).toContain("/companies");
    expect(search("resume", [], []).map((r) => r.to)).toContain("/notes");
    expect(search("delete", [], []).map((r) => r.to)).toContain("/settings");
    expect(search("focus", [], []).map((r) => r.to)).toContain("/onboarding");
  });

  it("finds companies and sessions, ignoring case, and links to them", () => {
    const r = search(
      "northwind",
      [co("c1", "Northwind Payments", "ready")],
      [se("s1", "Northwind Payments"), se("s2", "Other Co")],
    );
    expect(r.map((x) => [x.group, x.to])).toEqual([
      ["Companies", "/companies/c1"],
      ["Sessions", "/sessions/s1"],
    ]);
    expect(r[0].hint).toBe("Brief ready");
  });

  it("needs every word, in any order", () => {
    const cos = [co("1", "Northwind Payments"), co("2", "Northwind Foods")];
    expect(search("payments north", cos, []).map((r) => r.id)).toEqual([
      "company:1",
    ]);
  });

  it("shows a session with no company as such, and is found by its date", () => {
    const r = search("nov", [], [se("s1", null)]);
    expect(r[0]).toMatchObject({ to: "/sessions/s1", hint: "No company" });
  });

  it("shows at most four of each kind", () => {
    const cos = Array.from({ length: 9 }, (_, i) => co(String(i), `Acme ${i}`));
    expect(search("acme", cos, [])).toHaveLength(4);
  });
});
