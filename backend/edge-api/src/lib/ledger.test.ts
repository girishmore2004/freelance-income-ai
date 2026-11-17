import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import { LedgerError, assertValidEntry, naturalBalance, postEntry } from "./ledger";
import type { EntryInput } from "./ledger";
import { bpsOf, quoteFees, validateSchedule } from "./fees";
import { handleFinanceRoute } from "./finance-routes";
import type { FinanceRouteDeps } from "./finance-routes";
import { createFakeSql, jsonRequest, readJson } from "./test-support";
import type { AuthenticatedSession } from "./session-service";

const clearing = { code: "provider:sandbox:clearing", name: "Clearing", kind: "asset" as const };
const held = { code: "client_funds:o1", name: "Client funds", kind: "liability" as const };

function entry(overrides: Partial<EntryInput> = {}): EntryInput {
  return {
    idempotency_key: "test:entry:0001", entry_type: "sandbox.funding", mode: "sandbox", currency: "INR",
    lines: [{ account: clearing, direction: "debit", amount_minor: 1000 }, { account: held, direction: "credit", amount_minor: 1000 }],
    ...overrides
  };
}

function code(fn: () => void): string {
  try { fn(); return "OK"; } catch (e) { return e instanceof LedgerError ? e.code : "OTHER"; }
}

describe("ledger rules", () => {
  it("accepts a balanced sandbox entry and refuses live, unbalanced, fractional or single-line entries", () => {
    expect(code(() => assertValidEntry(entry()))).toBe("OK");
    expect(code(() => assertValidEntry(entry({ mode: "live" })))).toBe("LIVE_DISABLED");
    expect(code(() => assertValidEntry(entry({ lines: [{ account: clearing, direction: "debit", amount_minor: 10 }, { account: held, direction: "credit", amount_minor: 9 }] })))).toBe("UNBALANCED");
    expect(code(() => assertValidEntry(entry({ lines: [{ account: clearing, direction: "debit", amount_minor: 1.5 }, { account: held, direction: "credit", amount_minor: 1.5 }] })))).toBe("INVALID_LINES");
    expect(code(() => assertValidEntry(entry({ lines: [{ account: clearing, direction: "debit", amount_minor: 0 }, { account: held, direction: "credit", amount_minor: 0 }] })))).toBe("INVALID_LINES");
    expect(code(() => assertValidEntry(entry({ lines: [{ account: clearing, direction: "debit", amount_minor: 1 }] })))).toBe("INVALID_LINES");
    expect(code(() => assertValidEntry(entry({ idempotency_key: "short" })))).toBe("INVALID_ENTRY");
    expect(code(() => assertValidEntry(entry({ currency: "rupee" })))).toBe("INVALID_ENTRY");
  });

  it("uses the natural side for balances", () => {
    expect(naturalBalance("asset", 100, 30)).toBe(70);
    expect(naturalBalance("liability", 30, 100)).toBe(70);
    expect(naturalBalance("revenue", 0, 50)).toBe(50);
  });

  it("posts the entry and its lines in one transaction, once per idempotency key", async () => {
    const fresh = createFakeSql((text) => {
      if (text.startsWith("INSERT INTO ledger_entries")) return [{ id: "E1" }];
      if (text.startsWith("INSERT INTO ledger_accounts")) return [{ id: "A" }];
      return [];
    });
    const first = await postEntry(fresh.sql, entry());
    expect(first.duplicate).toBe(false);
    expect(fresh.queries.filter((q) => q.text.startsWith("INSERT INTO ledger_lines"))).toHaveLength(2);
    expect(fresh.queries.every((q) => q.inTransaction)).toBe(true);
    expect(fresh.queries[0].text).toContain("ON CONFLICT (idempotency_key) DO NOTHING");

    const repeat = createFakeSql((text) => (text.startsWith("SELECT id FROM ledger_entries") ? [{ id: "E1" }] : []));
    expect(await postEntry(repeat.sql, entry())).toEqual({ entry_id: "E1", duplicate: true });
    expect(repeat.queries.some((q) => q.text.startsWith("INSERT INTO ledger_lines"))).toBe(false);
  });
});

describe("fee engine", () => {
  const schedule = { id: "F1", currency: "INR", client_fee_bps: 350, freelancer_fee_bps: 250, min_fee_minor: 5000 };

  it("rounds half up in whole minor units", () => {
    expect(bpsOf(1000, 350)).toBe(35);
    expect(bpsOf(143, 350)).toBe(5); // 5.005 → 5
    expect(bpsOf(1, 5000)).toBe(1); // 0.5 → 1
  });

  it("quotes both sides and tops up the client side to the minimum fee", () => {
    expect(quoteFees(1_000_000, schedule)).toEqual({
      schedule_id: "F1", currency: "INR", amount_minor: 1_000_000, client_fee_minor: 35_000, freelancer_fee_minor: 25_000,
      client_pays_minor: 1_035_000, freelancer_receives_minor: 975_000, platform_fee_minor: 60_000
    });
    const small = quoteFees(50_000, schedule);
    expect([small.client_fee_minor, small.freelancer_fee_minor, small.platform_fee_minor]).toEqual([3_750, 1_250, 5_000]);
    expect(() => quoteFees(10.5, schedule)).toThrow();
  });

  it("bounds schedule values (0–30%, no hardcoded defaults)", () => {
    expect(validateSchedule({ name: "Launch", currency: "INR", client_fee_bps: 350, freelancer_fee_bps: 250 }).ok).toBe(true);
    const bad = validateSchedule({ name: "x", currency: "inr", client_fee_bps: 3500, freelancer_fee_bps: -1, min_fee_minor: 1.5 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(["client_fee_bps", "currency", "freelancer_fee_bps", "min_fee_minor", "name"]);
  });
});

function session(userId: string): AuthenticatedSession {
  return { user: { id: userId, email: `${userId}@x.test`, email_verified: true, mfa_enabled: false }, claims: { sub: userId, jti: "j", iat: 0, exp: 0 } };
}

function world(roles: string[], opts: { schedule?: boolean; draft?: boolean } = {}) {
  const fake = createFakeSql((text) => {
    if (text.startsWith("SELECT enabled FROM feature_flags")) return [{ enabled: true }];
    if (text.startsWith("SELECT role, status FROM user_roles")) return roles.map((role) => ({ role, status: "active" }));
    if (text.startsWith("SELECT * FROM fee_schedules WHERE status = 'approved'")) {
      return opts.schedule ? [{ id: "F1", currency: "INR", client_fee_bps: 350, freelancer_fee_bps: 250, min_fee_minor: "5000" }] : [];
    }
    if (text.startsWith("SELECT * FROM fee_schedules WHERE id")) return opts.draft === false ? [{ id: "F1", status: "approved", currency: "INR" }] : [{ id: "F1", status: "draft", currency: "INR" }];
    if (text.startsWith("UPDATE fee_schedules SET status = 'approved'")) return [{ id: "F1", name: "S", currency: "INR", client_fee_bps: 350, freelancer_fee_bps: 250, min_fee_minor: 0, status: "approved", approved_at: new Date(), created_at: new Date() }];
    return [];
  });
  const deps: FinanceRouteDeps = { database: () => fake.sql, authenticate: async () => session("u1") };
  return { fake, deps };
}

const env = {} as Env;
const call = (deps: FinanceRouteDeps, method: string, path: string, payload?: unknown) => handleFinanceRoute(jsonRequest(method, path, payload), env, "r", deps);

describe("finance routes", () => {
  it("hides staff endpoints from everyone else", async () => {
    for (const [method, path] of [["GET", "/api/v1/finance/trial-balance"], ["GET", "/api/v1/finance/fee-schedules"], ["POST", "/api/v1/finance/fee-schedules"]]) {
      expect((await call(world(["freelancer", "client"]).deps, method, path, method === "POST" ? {} : undefined))!.status).toBe(404);
    }
  });

  it("refuses fee quotes until a schedule is approved (D-5), then quotes", async () => {
    const none = await call(world(["client"]).deps, "GET", "/api/v1/finance/fee-quote?amount_minor=1000000");
    expect((await readJson(none!)).error!.code).toBe("FEES_NOT_CONFIGURED");
    const quoted = await call(world(["client"], { schedule: true }).deps, "GET", "/api/v1/finance/fee-quote?amount_minor=1000000");
    expect((await readJson(quoted!)).data.platform_fee_minor).toBe(60_000);
    expect((await call(world(["client"]).deps, "GET", "/api/v1/finance/fee-quote?amount_minor=-5"))!.status).toBe(422);
  });

  it("lets finance draft and only admins approve, retiring the previous schedule", async () => {
    expect((await call(world(["finance"]).deps, "POST", "/api/v1/finance/fee-schedules/F1/approve"))!.status).toBe(403);
    const admin = world(["admin"]);
    expect((await call(admin.deps, "POST", "/api/v1/finance/fee-schedules/F1/approve"))!.status).toBe(200);
    const texts = admin.fake.queries.filter((q) => q.inTransaction).map((q) => q.text);
    expect(texts.some((t) => t.startsWith("UPDATE fee_schedules SET status = 'retired'"))).toBe(true);
    expect((await call(world(["admin"], { draft: false }).deps, "POST", "/api/v1/finance/fee-schedules/F1/approve"))!.status).toBe(409);
  });
});
