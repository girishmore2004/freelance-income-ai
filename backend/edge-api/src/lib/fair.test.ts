import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import { NEAR_DUPLICATE, QUOTA, proposalBucket, proposalQuota, textSimilarity, validateIntake } from "./fair-proposals";
import { handleFairRoute } from "./fair-routes";
import { createFakeSql, jsonRequest, readJson } from "./test-support";

describe("weekly proposal limit (Master Plan B12.1)", () => {
  it("starts at the base and rises with the hire rate, never above the maximum", () => {
    expect(proposalQuota({ sent7: 0, sent90: 0, hired90: 0 })).toMatchObject({ limit: QUOTA.base, remaining: QUOTA.base, hire_rate: null });
    // Fewer than 5 proposals in 90 days: the hire rate does not count yet.
    expect(proposalQuota({ sent7: 3, sent90: 4, hired90: 4 })).toMatchObject({ limit: 10, used: 3, remaining: 7, hire_rate: null });
    expect(proposalQuota({ sent7: 2, sent90: 20, hired90: 5 })).toMatchObject({ limit: 20, hire_rate: 0.25 });
    expect(proposalQuota({ sent7: 0, sent90: 10, hired90: 10 }).limit).toBe(QUOTA.max);
    expect(proposalQuota({ sent7: 0, sent90: 30, hired90: 0 }).limit).toBe(QUOTA.base);
  });

  it("never goes negative and ignores impossible inputs", () => {
    expect(proposalQuota({ sent7: 25, sent90: 25, hired90: 0 })).toMatchObject({ limit: 10, remaining: 0 });
    expect(proposalQuota({ sent7: -3, sent90: 6, hired90: 99 })).toMatchObject({ used: 0, hire_rate: 1, limit: QUOTA.max });
  });

  it("explains the limit in plain words", () => {
    expect(proposalQuota({ sent7: 0, sent90: 0, hired90: 0 }).explanation).toContain("rises as clients hire you");
    expect(proposalQuota({ sent7: 0, sent90: 20, hired90: 5 }).explanation).toContain("hire rate of 25%");
  });
});

describe("near-duplicate proposals (Master Plan B12.3)", () => {
  const base = "I have built five React dashboards for logistics teams and can deliver yours in two weeks with tests, documentation and a handover call.";
  it("flags copies that only change case, punctuation or a word", () => {
    expect(textSimilarity(base, base.toUpperCase().replace(/,/g, ""))).toBe(1);
    expect(textSimilarity(base, base.replace("two weeks", "three weeks"))).toBeGreaterThanOrEqual(0.7);
    expect(textSimilarity(base, `${base} Thanks!`)).toBeGreaterThanOrEqual(NEAR_DUPLICATE);
  });
  it("does not flag a proposal written for another project", () => {
    const other = "Your bakery needs an online menu and order form; I would start with the menu structure, then build the form with payment by your provider.";
    expect(textSimilarity(base, other)).toBeLessThan(0.2);
    expect(textSimilarity("", base)).toBe(0);
  });
});

describe("client intake and proposal ranges (Master Plan B12.2)", () => {
  it("accepts no limit or 1–500, and needs an explicit open/closed choice", () => {
    expect(validateIntake({ max_proposals: null, accepting: true })).toEqual({ ok: true, value: { max_proposals: null, accepting: true } });
    expect(validateIntake({ max_proposals: "25", accepting: false })).toEqual({ ok: true, value: { max_proposals: 25, accepting: false } });
    expect(validateIntake({ max_proposals: 0, accepting: true })).toMatchObject({ ok: false });
    expect(validateIntake({ max_proposals: 501, accepting: true })).toMatchObject({ ok: false });
    expect(validateIntake({ max_proposals: 2.5, accepting: true })).toMatchObject({ ok: false });
    const noChoice = validateIntake({ max_proposals: 5 });
    expect(noChoice.ok).toBe(false);
    expect(!noChoice.ok && typeof noChoice.errors.accepting).toBe("string");
  });
  it("shows the competition as a range", () => {
    expect([0, 4, 5, 9, 10, 19, 20, 49, 50, 400].map(proposalBucket)).toEqual([
      "Less than 5", "Less than 5", "5 to 10", "5 to 10", "10 to 20", "10 to 20", "20 to 50", "20 to 50", "50+", "50+"
    ]);
  });
});

describe("block routes", () => {
  const env = {} as Env;
  const deps = (fake: ReturnType<typeof createFakeSql>, userId = "u1") => ({
    database: () => fake.sql,
    authenticate: async () => ({ user: { id: userId, email: "", email_verified: true, mfa_enabled: false }, claims: { sub: userId, jti: "j", iat: 0, exp: 0 } })
  });

  it("are closed while the marketplace is off and answer only their own paths", async () => {
    const off = createFakeSql((text) => (text.startsWith("SELECT enabled FROM feature_flags") ? [{ enabled: false }] : []));
    const res = await handleFairRoute(jsonRequest("POST", "/api/v1/blocks", { listing_id: "L1" }), env, "r", deps(off));
    expect(res!.status).toBe(403);
    expect(await handleFairRoute(jsonRequest("GET", "/api/v1/blocks"), env, "r", deps(off))).toBeNull();
    expect(await handleFairRoute(jsonRequest("DELETE", "/api/v1/blocks/B1/remove"), env, "r", deps(off))).toBeNull();
  });

  it("refuse while an offer or contract is open, and only the side that blocked can unblock", async () => {
    const on = (rows: (text: string, values: unknown[]) => unknown[] | undefined) =>
      createFakeSql((text, values) => {
        if (text.startsWith("SELECT enabled FROM feature_flags")) return [{ enabled: true }];
        if (text.includes("to_regclass")) return [{ ready: true }];
        return rows(text, values) ?? [];
      });
    const open = on((text) => {
      if (text.startsWith("SELECT role, status FROM user_roles")) return [{ role: "freelancer", status: "active" }];
      if (text.startsWith("SELECT organization_id FROM project_listings")) return [{ organization_id: "O1" }];
      if (text.startsWith("SELECT 1 FROM contracts")) return [{ "?column?": 1 }];
      return undefined;
    });
    const refused = await handleFairRoute(jsonRequest("POST", "/api/v1/blocks", { listing_id: "L1" }), env, "r", deps(open));
    expect(refused!.status).toBe(409);
    expect((await readJson(refused!)).error?.code).toBe("CONTRACT_OPEN");
    expect(open.queries.some((q) => q.text.startsWith("INSERT INTO marketplace_blocks"))).toBe(false);

    // A client's block: a freelancer (not the client side) cannot lift it.
    const other = on((text) => (text.startsWith("SELECT id, blocked_by") ? [{ id: "B1", blocked_by: "client", freelancer_user_id: "u1", organization_id: "O1" }] : undefined));
    const lift = await handleFairRoute(jsonRequest("POST", "/api/v1/blocks/B1/remove"), env, "r", deps(other, "u1"));
    expect(lift!.status).toBe(404);
    expect(other.queries.some((q) => q.text.startsWith("DELETE FROM marketplace_blocks"))).toBe(false);
  });

  it("validate the reason and the target", async () => {
    const fake = createFakeSql((text) => {
      if (text.startsWith("SELECT enabled FROM feature_flags")) return [{ enabled: true }];
      if (text.includes("to_regclass")) return [{ ready: true }];
      if (text.startsWith("SELECT role, status FROM user_roles")) return [{ role: "freelancer", status: "active" }];
      return [];
    });
    const long = await handleFairRoute(jsonRequest("POST", "/api/v1/blocks", { listing_id: "L1", reason: "x".repeat(501) }), env, "r", deps(fake));
    expect(long!.status).toBe(422);
    const none = await handleFairRoute(jsonRequest("POST", "/api/v1/blocks", {}), env, "r", deps(fake));
    expect(none!.status).toBe(422);
    const missing = await handleFairRoute(jsonRequest("POST", "/api/v1/blocks", { listing_id: "L404" }), env, "r", deps(fake));
    expect(missing!.status).toBe(404);
  });
});
