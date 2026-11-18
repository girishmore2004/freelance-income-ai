import { describe, expect, it } from "vitest";
import { interviewPrep, priceAdvice, selfTests } from "./agent-tools-routes";

const base = { budget_model: "fixed", budget_min_minor: 2_000_000, budget_max_minor: 4_000_000, deliverables: 2, deadline_days: 30, hourly_rate_minor: 100_000, minimum_budget_minor: null, past_wins_minor: [] as number[], hours: 30 };

describe("F5 price advice", () => {
  it("stays inside the client's budget and shows its basis", () => {
    const a = priceAdvice(base);
    expect(a.available).toBe(true);
    if (!a.available) return;
    expect(a.low_minor).toBe(3_000_000);
    expect(a.high_minor).toBeLessThanOrEqual(4_000_000);
    expect(a.basis.join(" ")).toContain("30 estimated hours");
  });
  it("never goes below the freelancer's minimum and warns when the budget is too low", () => {
    const a = priceAdvice({ ...base, budget_min_minor: 500_000, budget_max_minor: 800_000, minimum_budget_minor: 1_000_000, hours: null, hourly_rate_minor: null });
    if (!a.available) throw new Error("expected a range");
    expect(a.low_minor).toBe(800_000);
    expect(a.warnings.join(" ")).toContain("below your minimum");
  });
  it("uses past wins when the client gave no budget, and says when it cannot advise", () => {
    const a = priceAdvice({ ...base, budget_min_minor: null, budget_max_minor: null, hours: null, past_wins_minor: [1_000_000, 2_000_000, 3_000_000] });
    if (!a.available) throw new Error("expected a range");
    expect(a.low_minor).toBe(1_800_000);
    expect(priceAdvice({ ...base, budget_min_minor: null, budget_max_minor: null, hours: null }).available).toBe(false);
  });
});

describe("C4 interview preparation", () => {
  it("asks about uncovered deliverables, missing skills, price, timeline, assumptions and evidence", () => {
    const q = interviewPrep({
      brief: { deliverables: ["Order form", "Payment page"], skills: ["Next.js", "Stripe"], acceptance_criteria: ["Orders arrive"], budget_min_minor: 1_000_000, budget_max_minor: 2_000_000, deadline: "2026-12-01" },
      proposal: { price_minor: 2_500_000, estimated_days: 30, cover_letter: "I will build the order form in Next.js", sections: { understanding: "", approach: "", evidence: [], deliverables: [], milestones: [], assumptions: ["You provide photos"], exclusions: ["Hosting"], questions: ["Do you have a logo?"], revision_rounds: 1 } },
      freelancer_skills: ["Next.js"], newcomer: true, today: new Date("2026-11-18T00:00:00Z")
    });
    const topics = q.map((x) => x.topic);
    expect(topics).toEqual(expect.arrayContaining(["Scope", "Skills", "Price", "Timeline", "Assumptions", "Exclusions", "Their questions", "Evidence", "Working style"]));
    expect(q.find((x) => x.topic === "Scope")?.question).toContain("Payment page");
    expect(q.some((x) => x.question.includes("Order form"))).toBe(false);
  });
});

describe("agent self-tests", () => {
  it("all pass on the current code", () => {
    const failing = selfTests(new Date("2026-11-18T00:00:00Z")).filter((t) => !t.ok);
    expect(failing).toEqual([]);
  });
});
