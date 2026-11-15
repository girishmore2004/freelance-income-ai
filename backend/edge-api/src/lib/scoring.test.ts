import { describe, expect, it } from "vitest";
import { scoreOpportunity } from "./scoring";
import fixtures from "./scoring.fixtures.json";

// Fixtures were produced by running the original Python score_opportunity()
// on the same inputs, so this guards the TypeScript port against drift.
describe("scoreOpportunity matches the original Python scoring", () => {
  fixtures.forEach((fixture, index) => {
    it(`case ${index + 1}: ${fixture.opp.title}`, () => {
      const result = scoreOpportunity(fixture.profile as any, fixture.opp as any);
      expect(result.score).toBe(fixture.score);
      expect(result.breakdown).toEqual(fixture.breakdown);
    });
  });
});
