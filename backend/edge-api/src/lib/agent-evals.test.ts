import { describe, expect, it } from "vitest";
import { evalSummary, runEvals } from "./agent-evals";
import { interviewPrep, priceAdvice } from "./agent-tools-routes";

describe("agent evaluation sets (P8)", () => {
  const cases = runEvals(new Date("2026-11-19T10:00:00Z"), { priceAdvice, interviewPrep });

  it("every case of every agent passes", () => {
    expect(cases.filter((c) => !c.ok).map((c) => `${c.code}: ${c.name} ${c.detail}`)).toEqual([]);
  });

  it("covers every live agent that has a rules part, with at least one case each", () => {
    const summary = evalSummary(cases);
    for (const code of ["F1", "F2", "F3", "F4", "F5", "F7", "F8", "F9", "F11", "C1", "C2", "C3", "C4", "C5", "C6", "C7", "P1", "P5", "P7", "P8", "P9"]) {
      expect(summary[code]?.cases ?? 0).toBeGreaterThan(0);
    }
    expect(cases.length).toBeGreaterThanOrEqual(50);
  });
});
