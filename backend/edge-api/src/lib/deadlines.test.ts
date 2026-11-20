import { describe, expect, it } from "vitest";
import {
  autoCompleteServiceDeliveries,
  cancellationDeadline,
  disputeReply,
  expireCancellationRequests,
  isLate,
  lateCancelAllowed,
  runDisputeDeadlines,
  serviceReviewDeadline,
} from "./deadlines";
import { createFakeSql } from "./test-support";
import type { Sql } from "./core-routes";

const NOW = new Date("2026-11-20T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe("deadline rules (U29, D-26 to D-29)", () => {
  it("service deliveries complete 3 days after delivery, plus 5 days per extension, at most 2", () => {
    const t = new Date("2026-11-01T10:00:00Z");
    expect(serviceReviewDeadline(t, 0).toISOString()).toBe("2026-11-04T10:00:00.000Z");
    expect(serviceReviewDeadline(t, 1).toISOString()).toBe("2026-11-09T10:00:00.000Z");
    expect(serviceReviewDeadline(t, 2).toISOString()).toBe("2026-11-14T10:00:00.000Z");
    expect(serviceReviewDeadline(t, 9).toISOString()).toBe("2026-11-14T10:00:00.000Z");
  });

  it("a milestone is late after its due date, but not while a delivery waits for the client or once approved", () => {
    expect(isLate({ due_date: "2026-11-19", state: "pending" }, NOW)).toBe(true);
    expect(isLate({ due_date: "2026-11-19", state: "revision_requested" }, NOW)).toBe(true);
    expect(isLate({ due_date: "2026-11-20", state: "pending" }, NOW)).toBe(false);
    expect(isLate({ due_date: "2026-11-19", state: "submitted" }, NOW)).toBe(false);
    expect(isLate({ due_date: "2026-11-19", state: "approved" }, NOW)).toBe(false);
    expect(isLate({ due_date: null, state: "pending" }, NOW)).toBe(false);
    expect(isLate({ due_date: "not a date", state: "pending" }, NOW)).toBe(false);
  });

  it("the client may cancel alone only after a milestone has been late for 24 hours", () => {
    // Due 2026-11-19 ends 23:59:59 UTC; at 12:00 on the 20th it is late by ~12 hours.
    expect(lateCancelAllowed([{ due_date: "2026-11-19", state: "pending" }], NOW)).toBe(false);
    expect(lateCancelAllowed([{ due_date: "2026-11-18", state: "pending" }], NOW)).toBe(true);
    expect(lateCancelAllowed([{ due_date: "2026-11-18", state: "submitted" }], NOW)).toBe(false);
    expect(lateCancelAllowed([{ due_date: "2026-11-18", state: "approved" }, { due_date: "2027-01-01", state: "pending" }], NOW)).toBe(false);
  });

  it("a cancellation request counts as accepted 48 hours after it was made", () => {
    expect(cancellationDeadline("2026-11-18T12:00:00Z").toISOString()).toBe("2026-11-20T12:00:00.000Z");
  });

  it("staff decide a dispute once the other side answers or 7 days pass", () => {
    const opened = { opened_by_party: "client", created_at: "2026-11-15T12:00:00Z" };
    expect(disputeReply(opened, [], NOW)).toEqual({ respond_by: "2026-11-22T12:00:00.000Z", replied: false, ready_for_decision: false });
    expect(disputeReply(opened, [{ party: "client" }], NOW).ready_for_decision).toBe(false);
    expect(disputeReply(opened, [{ party: "freelancer" }], NOW)).toMatchObject({ replied: true, ready_for_decision: true });
    expect(disputeReply(opened, [], new Date("2026-11-22T12:00:00Z")).ready_for_decision).toBe(true);
  });
});

describe("deadline jobs", () => {
  it("completes service deliveries past their deadline like an Approve, reminds a day before, and skips the rest", async () => {
    const rows = [
      { id: "S-old", contract_id: "K1", milestone_index: 0, submitted_at: hoursAgo(80), review_extensions: 0, organization_id: "o1" },
      { id: "S-extended", contract_id: "K2", milestone_index: 0, submitted_at: hoursAgo(80), review_extensions: 1, organization_id: "o1" },
      { id: "S-soon", contract_id: "K3", milestone_index: 1, submitted_at: hoursAgo(60), review_extensions: 0, organization_id: "o1" },
      { id: "S-new", contract_id: "K4", milestone_index: 0, submitted_at: hoursAgo(2), review_extensions: 0, organization_id: "o1" },
    ];
    const fake = createFakeSql((text) => {
      if (text.includes("FROM milestone_submissions s") && text.includes("JOIN service_orders o")) return rows;
      if (text.includes("FROM organization_memberships")) return [{ user_id: "client-owner" }];
      if (text.startsWith("INSERT INTO notifications")) return [{ id: "n" }];
      return [];
    });
    const decided: string[] = [];
    const released: string[] = [];
    const out = await autoCompleteServiceDeliveries(
      fake.sql as unknown as Sql,
      NOW,
      async (_db, contractId) => { decided.push(contractId); return { approved: true, completed: true }; },
      async (_db, contractId) => { released.push(contractId); return "released"; },
    );
    expect(decided).toEqual(["K1"]);
    expect(released).toEqual(["K1"]);
    expect(out).toEqual({ completed: 1, reminded: 1 });
  });

  it("does not release when the delivery was already decided in the meantime", async () => {
    const fake = createFakeSql((text) => (text.includes("JOIN service_orders o") ? [{ id: "S", contract_id: "K1", milestone_index: 0, submitted_at: hoursAgo(100), review_extensions: 0, organization_id: "o1" }] : []));
    const released: string[] = [];
    const out = await autoCompleteServiceDeliveries(fake.sql as unknown as Sql, NOW, async () => ({ approved: false, completed: false }), async (_d, c) => { released.push(c); return "released"; });
    expect(out.completed).toBe(0);
    expect(released).toEqual([]);
  });

  it("accepts cancellation requests unanswered for 48 hours and counts only those that went through", async () => {
    const fake = createFakeSql((text, values) => {
      if (text.includes("FROM contract_cancellations k")) {
        expect(String(values[0])).toBe("2026-11-18T12:00:00.000Z");
        return [{ id: "X1", contract_id: "K1" }, { id: "X2", contract_id: "K2" }];
      }
      return [];
    });
    const seen: string[] = [];
    const n = await expireCancellationRequests(fake.sql as unknown as Sql, NOW, async (_db, contractId, id) => { seen.push(`${contractId}/${id}`); return { cancelled: contractId === "K1", refunded: 1 }; });
    expect(seen).toEqual(["K1/X1", "K2/X2"]);
    expect(n).toBe(1);
  });

  it("reminds the silent side two days before the dispute deadline and tells staff when a dispute is ready", async () => {
    const disputes = [
      { id: "D-remind", contract_id: "K1", opened_by_party: "client", created_at: hoursAgo(24 * 6), freelancer_user_id: "f1", organization_id: "o1", replied: false },
      { id: "D-answered", contract_id: "K2", opened_by_party: "client", created_at: hoursAgo(24), freelancer_user_id: "f2", organization_id: "o1", replied: true },
      { id: "D-expired", contract_id: "K3", opened_by_party: "freelancer", created_at: hoursAgo(24 * 8), freelancer_user_id: "f3", organization_id: "o1", replied: false },
      { id: "D-fresh", contract_id: "K4", opened_by_party: "client", created_at: hoursAgo(24), freelancer_user_id: "f4", organization_id: "o1", replied: false },
    ];
    const fake = createFakeSql((text) => {
      if (text.includes("FROM disputes d JOIN contracts c")) return disputes;
      if (text.includes("FROM user_roles WHERE role IN ('admin', 'moderator')")) return [{ user_id: "admin1" }];
      if (text.startsWith("INSERT INTO notifications")) return [{ id: "n" }];
      return [];
    });
    const out = await runDisputeDeadlines(fake.sql as unknown as Sql, NOW);
    expect(out).toEqual({ reminded: 1, ready: 2 });
    const dedupes = fake.queries.filter((q) => q.text.startsWith("INSERT INTO notifications")).map((q) => q.values.find((v) => typeof v === "string" && /^dispute-(reminder|ready):/.test(v)));
    // One notice per dispute and recipient (the notifier appends the recipient to the dedupe key).
    expect(dedupes.sort()).toEqual(["dispute-ready:D-answered:admin1", "dispute-ready:D-expired:admin1", "dispute-reminder:D-remind:f1"]);
  });
});
