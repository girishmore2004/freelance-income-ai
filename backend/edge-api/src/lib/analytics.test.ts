import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import { budgetBand, byMode, median, monthKeys, pricingPerformance, rate, series, weekKeys } from "./analytics";
import { configChecks, handleAnalyticsRoute, maskEmail } from "./analytics-routes";
import type { AnalyticsRouteDeps } from "./analytics-routes";
import { createFakeSql, jsonRequest, readJson } from "./test-support";

const NOW = new Date("2026-11-18T10:00:00Z");

describe("analytics helpers", () => {
  it("rates carry their sample and flag small samples; nothing to divide gives null, not zero", () => {
    expect(rate(2, 3)).toEqual({ value: 0.667, numerator: 2, denominator: 3, small_sample: true });
    expect(rate(5, 10).small_sample).toBe(false);
    expect(rate(0, 0).value).toBeNull();
  });

  it("medians, month and week keys", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(monthKeys(NOW, 3)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(monthKeys(new Date("2027-01-31T00:00:00Z"), 2)).toEqual(["2026-12", "2027-01"]);
    expect(weekKeys(NOW, 2)).toEqual(["2026-11-09", "2026-11-16"]); // 18 Nov 2026 is a Wednesday
  });

  it("series fill missing periods with zeros", () => {
    expect(series(["2026-10", "2026-11"], [{ period: "2026-11", sent: 2, won: 1 }], ["sent", "won"])).toEqual([
      { period: "2026-10", sent: 0, won: 0 },
      { period: "2026-11", sent: 2, won: 1 }
    ]);
  });

  it("never sums sandbox and live money together", () => {
    expect(byMode([{ mode: "sandbox", total: "100" }, { mode: "live", total: 50 }, { mode: "sandbox", total: 1 }])).toEqual({ sandbox: 101, live: 50 });
  });

  it("pricing performance counts only decided proposals in the success rate", () => {
    expect(budgetBand(150, 100, 120)).toBe("above");
    expect(budgetBand(90, 100, null)).toBe("below");
    expect(budgetBand(90, null, null)).toBe("no_budget");
    const out = pricingPerformance([
      { price_minor: 110, budget_min_minor: 100, budget_max_minor: 120, status: "hired" },
      { price_minor: 110, budget_min_minor: 100, budget_max_minor: 120, status: "declined" },
      { price_minor: 110, budget_min_minor: 100, budget_max_minor: 120, status: "submitted" },
      { price_minor: 200, budget_min_minor: 100, budget_max_minor: 120, status: "declined" }
    ]);
    expect(out.find((b) => b.band === "within")).toMatchObject({ proposals: 3, success: { value: 0.5, denominator: 2 } });
    expect(out.find((b) => b.band === "above")).toMatchObject({ proposals: 1, success: { value: 0 } });
  });

  it("masks emails for moderators and reports configuration as booleans only", () => {
    expect(maskEmail("asha@example.com")).toBe("a***@example.com");
    expect(maskEmail("broken")).toBe("***");
    const checks = configChecks({ JWT_SECRET: "super-secret-value" } as Env);
    expect(checks.find((c) => c.key === "jwt_secret")?.ok).toBe(true);
    expect(JSON.stringify(checks)).not.toContain("super-secret-value");
  });
});

function session(id: string) {
  return { user: { id, email: `${id}@x.test`, email_verified: true, mfa_enabled: false }, claims: { sub: id, jti: "j", iat: 0, exp: 0 } };
}

function world(roles: string[], member = false) {
  const fake = createFakeSql((text) => {
    if (text.startsWith("SELECT role, status FROM user_roles")) return roles.map((role) => ({ role, status: "active" }));
    if (text.includes("FROM organization_memberships m JOIN organizations o")) return member ? [{ id: "o1", name: "Acme", status: "active", membership_role: "member" }] : [];
    if (text.startsWith("SELECT u.id, u.email")) return [{ id: "u1", email: "asha@example.com", created_at: NOW, email_verified: "true", mfa_enabled: "false", suspended_at: null, roles: ["freelancer"] }];
    return [];
  });
  const deps: AnalyticsRouteDeps = { database: () => fake.sql, authenticate: async () => session("me"), now: () => NOW };
  return { fake, deps };
}

const get = (deps: AnalyticsRouteDeps, path: string) => handleAnalyticsRoute(jsonRequest("GET", path), {} as Env, "r", deps);

describe("analytics routes", () => {
  it("only answers GET on its own paths", async () => {
    const { deps } = world([]);
    expect(await handleAnalyticsRoute(jsonRequest("POST", "/api/v1/admin/users"), {} as Env, "r", deps)).toBeNull();
    expect(await get(deps, "/api/v1/admin/users/u1/suspend")).toBeNull();
    expect(await get(deps, "/api/v1/admin/overview")).toBeNull();
  });

  it("scopes freelancer analytics to the caller", async () => {
    const { deps, fake } = world([]);
    expect((await get(deps, "/api/v1/analytics/freelancer"))!.status).toBe(200);
    const scoped = fake.queries.filter((q) => q.text.includes("listing_proposals") || q.text.includes("payment_intents"));
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((q) => q.values.includes("me"))).toBe(true);
  });

  it("refuses client analytics for organisations the caller is not in", async () => {
    expect((await get(world([]).deps, "/api/v1/analytics/client?organization_id=o1"))!.status).toBe(404);
    expect((await get(world([]).deps, "/api/v1/analytics/client?organization_id=bad id"))!.status).toBe(404);
    expect((await get(world([], true).deps, "/api/v1/analytics/client?organization_id=o1"))!.status).toBe(200);
  });

  it("keeps staff pages to the right roles", async () => {
    const cases: Array<[string[], string, number]> = [
      [["freelancer"], "/api/v1/admin/analytics", 404],
      [["finance"], "/api/v1/admin/analytics", 200],
      [["finance"], "/api/v1/admin/users", 404],
      [["moderator"], "/api/v1/admin/users", 200],
      [["moderator"], "/api/v1/admin/audit-log", 404],
      [["moderator"], "/api/v1/admin/health", 404],
      [["admin"], "/api/v1/admin/audit-log", 200],
      [["admin"], "/api/v1/admin/health", 200]
    ];
    for (const [roles, path, status] of cases) expect([roles.join(","), path, (await get(world(roles).deps, path))!.status]).toEqual([roles.join(","), path, status]);
  });

  it("shows moderators a masked email and admins the full one", async () => {
    const mod = await readJson((await get(world(["moderator"]).deps, "/api/v1/admin/users?q=asha"))!);
    expect(mod.data.items[0].email).toBe("a***@example.com");
    const admin = await readJson((await get(world(["admin"]).deps, "/api/v1/admin/users?q=asha"))!);
    expect(admin.data.items[0].email).toBe("asha@example.com");
  });

  it("escapes LIKE wildcards in user search", async () => {
    const { deps, fake } = world(["admin"]);
    await get(deps, "/api/v1/admin/users?q=a%25_b");
    expect(fake.queries.find((q) => q.text.startsWith("SELECT u.id, u.email"))!.values).toContain("%a\\%\\_b%");
  });
});
