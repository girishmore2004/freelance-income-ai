import { describe, expect, it } from "vitest";
import { monthRange, toCsv, totals } from "./statement-routes";
import type { StatementLine } from "./statement-routes";

const NOW = new Date("2026-11-18T10:00:00Z");

describe("statement month", () => {
  it("accepts this month and earlier, in UTC", () => {
    expect(monthRange(null, NOW)).toEqual({ month: "2026-11", from: "2026-11-01T00:00:00.000Z", to: "2026-12-01T00:00:00.000Z" });
    expect(monthRange("2026-02", NOW)?.to).toBe("2026-03-01T00:00:00.000Z");
    expect(monthRange("2026-12", NOW)).toBeNull();
    expect(monthRange("2026-13", NOW)).toBeNull();
    expect(monthRange("nov", NOW)).toBeNull();
  });
});

describe("statement totals and CSV", () => {
  const lines: StatementLine[] = [
    { date: "2026-11-02", kind: "release", mode: "sandbox", contract: "Cafe site", milestone: 0, gross_minor: 1_000_000, fee_minor: 25_000, net_minor: 975_000, currency: "INR" },
    { date: "2026-11-05", kind: "payout", mode: "sandbox", contract: "Withdrawal", milestone: null, gross_minor: 975_000, fee_minor: 0, net_minor: 975_000, currency: "INR" },
    { date: "2026-11-06", kind: "release", mode: "live", contract: "=HYPERLINK(\"x\")", milestone: 1, gross_minor: 500_000, fee_minor: 10_000, net_minor: 490_000, currency: "INR" }
  ];
  it("keeps test and live money apart", () => {
    expect(totals(lines)).toEqual([
      { mode: "live", currency: "INR", gross_minor: 500_000, fee_minor: 10_000, net_minor: 490_000, payouts_minor: 0, refunds_minor: 0 },
      { mode: "sandbox", currency: "INR", gross_minor: 1_000_000, fee_minor: 25_000, net_minor: 975_000, payouts_minor: 975_000, refunds_minor: 0 }
    ]);
  });
  it("writes quoted CSV, labels test mode and neutralises formulas", () => {
    const csv = toCsv(lines).split("\r\n");
    expect(csv[0]).toBe('"date","type","mode","contract","milestone","gross","platform_fee","net","currency"');
    expect(csv[1]).toBe('"2026-11-02","release","test","Cafe site","1","10000.00","250.00","9750.00","INR"');
    expect(csv[3]).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
