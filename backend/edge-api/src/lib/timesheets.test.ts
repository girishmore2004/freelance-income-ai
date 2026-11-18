import { describe, expect, it } from "vitest";
import { amountFor, validateEntry, weekStart } from "./timesheet-routes";
import { billingOf, contractVersionOut, parseBilling, termsHash, validateTerms } from "./contracts";
import type { ContractVersionRow } from "./contracts";

const base = { title: "Website upkeep", scope: "Weekly fixes", deliverables: [], acceptance_criteria: [], ownership_terms: "", revision_rounds: 1 };

describe("hourly terms", () => {
  it("accept a rate and weekly limit without milestones; total is one week's maximum", () => {
    const v = validateTerms({ ...base, billing: { type: "hourly", hourly_rate_minor: 80000, weekly_limit_hours: 10 }, milestones: [{ title: "ignored", amount_minor: 5 }] }, "INR");
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.milestones).toEqual([]);
    expect(v.value.total_minor).toBe(800000);
    expect(v.value.billing).toEqual({ type: "hourly", hourly_rate_minor: 80000, weekly_limit_hours: 10 });
  });
  it("refuse low rates and impossible limits", () => {
    expect(parseBilling({ type: "hourly", hourly_rate_minor: 5000, weekly_limit_hours: 10 })).toBe("Hourly rate must be at least ₹100.");
    expect(parseBilling({ type: "hourly", hourly_rate_minor: 80000, weekly_limit_hours: 81 })).toBe("Weekly limit must be 1 to 80 hours.");
    expect(parseBilling({ type: "monthly" })).toBe("Billing must be fixed or hourly.");
    expect(parseBilling({ type: "fixed" })).toBeNull();
    expect(parseBilling(undefined)).toBeNull();
  });
  it("keep fixed-price hashes unchanged", async () => {
    const fixed = validateTerms({ ...base, milestones: [{ title: "All", amount_minor: 100000 }] }, "INR");
    if (!fixed.ok) throw new Error("invalid");
    expect("billing" in fixed.value).toBe(false);
    expect(JSON.stringify(fixed.value)).not.toContain("billing");
    expect(await termsHash(fixed.value)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("read billing from stored versions, fixed when empty or missing", () => {
    const row = { version: 1, title: "t", scope: "", deliverables_json: "[]", milestones_json: "[]", total_minor: 1, currency: "INR", revision_rounds: 0, acceptance_json: "[]", ownership_terms: "", content_hash: "h", proposed_by: "client", created_at: new Date(), client_accepted_at: null, freelancer_accepted_at: null } as ContractVersionRow;
    expect(billingOf(row)).toBeNull();
    expect(contractVersionOut(row).billing).toEqual({ type: "fixed" });
    expect(billingOf({ billing_json: '{"type":"hourly","hourly_rate_minor":80000,"weekly_limit_hours":5}' })).toEqual({ type: "hourly", hourly_rate_minor: 80000, weekly_limit_hours: 5 });
    expect(billingOf({ billing_json: "not json" })).toBeNull();
  });
});

describe("timesheet rules", () => {
  it("weeks start on Monday (UTC)", () => {
    expect(weekStart(new Date("2026-11-18T10:00:00Z"))).toBe("2026-11-16");
    expect(weekStart(new Date("2026-11-16T00:00:00Z"))).toBe("2026-11-16");
    expect(weekStart(new Date("2026-11-22T23:59:00Z"))).toBe("2026-11-16");
    expect(weekStart(new Date("2026-11-23T00:00:00Z"))).toBe("2026-11-23");
  });
  it("amounts are minutes × rate ÷ 60, half up to the paisa", () => {
    expect(amountFor(60, 80000)).toBe(80000);
    expect(amountFor(90, 80000)).toBe(120000);
    expect(amountFor(1, 10001)).toBe(167); // 166.68 → 167
    expect(amountFor(0, 80000)).toBe(0);
  });
  it("entries: this week or last, not future, not before start, no contact details", () => {
    const today = new Date("2026-11-18T10:00:00Z");
    const ctx = { today, activatedAt: new Date("2026-11-05T00:00:00Z") };
    expect(validateEntry({ work_date: "2026-11-17", minutes: 90, description: "Fixed the checkout bug" }, ctx)).toEqual({ ok: true, value: { work_date: "2026-11-17", minutes: 90, description: "Fixed the checkout bug", week_start: "2026-11-16" } });
    expect(validateEntry({ work_date: "2026-11-10", minutes: 30, description: "Last week work" }, ctx)).toMatchObject({ ok: true, value: { week_start: "2026-11-09" } });
    expect(validateEntry({ work_date: "2026-11-08", minutes: 30, description: "Too old" }, ctx)).toMatchObject({ ok: false, errors: { work_date: "Log time for this week or last week only." } });
    expect(validateEntry({ work_date: "2026-11-19", minutes: 30, description: "Tomorrow" }, ctx)).toMatchObject({ ok: false, errors: { work_date: "You cannot log time in the future." } });
    expect(validateEntry({ work_date: "2026-11-10", minutes: 30, description: "Before start" }, { today, activatedAt: new Date("2026-11-12T08:00:00Z") })).toMatchObject({ ok: false });
    expect(validateEntry({ work_date: "2026-11-17", minutes: 0, description: "Nothing" }, ctx)).toMatchObject({ ok: false });
    expect(validateEntry({ work_date: "2026-11-17", minutes: 1441, description: "Too long" }, ctx)).toMatchObject({ ok: false });
    expect(validateEntry({ work_date: "2026-11-17", minutes: 30, description: "Call me on 9876543210" }, ctx)).toMatchObject({ ok: false, errors: { description: "Keep contact and payment details out of time entries." } });
  });
});
