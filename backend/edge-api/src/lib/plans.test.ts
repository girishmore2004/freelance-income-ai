import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import { creditBalance, planLimits, reserveAiCall } from "./ai-governor";
import { handlePlanRoute, validatePlan } from "./plan-routes";
import type { PlanRouteDeps } from "./plan-routes";
import { createFakeSql, jsonRequest, readJson } from "./test-support";
import type { AuthenticatedSession } from "./session-service";

const env = { AI: {} } as unknown as Env;

function governorSql(opts: { plan?: { code: string; ai_daily_limit: number; ai_monthly_limit: number } | null; planError?: boolean; usage: { user_day: number; user_month: number }; credits?: number }) {
  return createFakeSql((text) => {
    if (text.startsWith("SELECT enabled FROM feature_flags")) return [{ enabled: true }];
    if (text.startsWith("SELECT p.code, p.ai_daily_limit")) {
      if (opts.planError) throw new Error('relation "plans" does not exist');
      return opts.plan ? [opts.plan] : [];
    }
    if (text.startsWith("SELECT count(*) FILTER")) return [{ user_day: String(opts.usage.user_day), user_month: String(opts.usage.user_month), global_day_micros: "0" }];
    if (text.startsWith("SELECT COALESCE(sum(delta), 0) AS balance")) return [{ balance: String(opts.credits ?? 0) }];
    return [];
  });
}

const call = { userId: "u1", operation: "proposal", inputChars: 400, maxOutputTokens: 200 };

describe("plan limits in the AI governor", () => {
  it("uses the user's plan, the free plan, or the Worker defaults when plans are unavailable", async () => {
    expect(await planLimits(env, governorSql({ plan: { code: "pro", ai_daily_limit: 50, ai_monthly_limit: 900 }, usage: { user_day: 0, user_month: 0 } }).sql, "u1")).toEqual({ plan: "pro", daily: 50, monthly: 900 });
    expect(await planLimits(env, governorSql({ plan: null, usage: { user_day: 0, user_month: 0 } }).sql, "u1")).toEqual({ plan: "default", daily: 20, monthly: 300 });
    expect(await planLimits(env, governorSql({ planError: true, usage: { user_day: 0, user_month: 0 } }).sql, "u1")).toEqual({ plan: "default", daily: 20, monthly: 300 });
  });

  it("spends one credit per call beyond the monthly limit, never beyond the daily limit", async () => {
    const plan = { code: "pro", ai_daily_limit: 5, ai_monthly_limit: 10 };
    const withCredit = governorSql({ plan, usage: { user_day: 1, user_month: 10 }, credits: 3 });
    const decision = await reserveAiCall(env, withCredit.sql, call);
    expect(decision).toMatchObject({ allowed: true, usedCredit: true });
    const spend = withCredit.queries.find((q) => q.text.startsWith("INSERT INTO ai_credit_ledger"))!;
    expect(spend.text).toContain("-1, 'ai_call'");
    expect(spend.text).toContain("ON CONFLICT (reason, ref) DO NOTHING");

    const noCredit = governorSql({ plan, usage: { user_day: 1, user_month: 10 }, credits: 0 });
    expect(await reserveAiCall(env, noCredit.sql, call)).toMatchObject({ allowed: false, reason: "user_monthly_quota" });
    const dailyCap = governorSql({ plan, usage: { user_day: 5, user_month: 10 }, credits: 99 });
    expect(await reserveAiCall(env, dailyCap.sql, call)).toMatchObject({ allowed: false, reason: "user_daily_quota" });
    const within = governorSql({ plan, usage: { user_day: 1, user_month: 3 }, credits: 5 });
    expect(await reserveAiCall(env, within.sql, call)).toMatchObject({ allowed: true, usedCredit: false });
    expect(within.queries.some((q) => q.text.startsWith("INSERT INTO ai_credit_ledger"))).toBe(false);
  });

  it("treats a missing credit table as zero credits", async () => {
    const broken = createFakeSql(() => { throw new Error("no table"); });
    expect(await creditBalance(broken.sql, "u1")).toBe(0);
  });
});

describe("plan validation", () => {
  it("keeps prices optional (D-14) and limits consistent", () => {
    expect(validatePlan({ code: "pro", name: "Pro", ai_daily_limit: 50, ai_monthly_limit: 900 }).ok).toBe(true);
    const bad = validatePlan({ code: "Pro!", name: "P", price_minor: -1, ai_daily_limit: 50, ai_monthly_limit: 10, billing_interval: "week" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(["ai_monthly_limit", "billing_interval", "code", "name", "price_minor"]);
  });
});

function session(userId: string): AuthenticatedSession {
  return { user: { id: userId, email: `${userId}@x.test`, email_verified: true, mfa_enabled: false }, claims: { sub: userId, jti: "j", iat: 0, exp: 0 } };
}

function world(roles: string[], opts: { user?: string | null; grantInserted?: boolean } = {}) {
  const fake = createFakeSql((text) => {
    if (text.startsWith("SELECT role, status FROM user_roles")) return roles.map((role) => ({ role, status: "active" }));
    if (text.startsWith("SELECT id FROM users WHERE lower(email)")) return opts.user === null ? [] : [{ id: opts.user ?? "f1" }];
    if (text.startsWith("INSERT INTO ai_credit_ledger")) return opts.grantInserted === false ? [] : [{ id: "c1" }];
    if (text.startsWith("SELECT COALESCE(sum(delta), 0)")) return [{ balance: "10" }];
    return [];
  });
  const deps: PlanRouteDeps = { database: () => fake.sql, authenticate: async () => session("admin1") };
  return { fake, deps };
}

const route = (deps: PlanRouteDeps, method: string, path: string, payload?: unknown) => handlePlanRoute(jsonRequest(method, path, payload), {} as Env, "r", deps);

describe("plan routes", () => {
  it("keeps admin endpoints hidden from everyone else", async () => {
    for (const [method, path] of [["GET", "/api/v1/admin/plans"], ["POST", "/api/v1/admin/credit-grants"], ["POST", "/api/v1/admin/plan-grants"]]) {
      expect((await route(world(["freelancer", "finance"]).deps, method, path, method === "POST" ? {} : undefined))!.status).toBe(404);
    }
  });

  it("grants credits once per grant id and validates the amount", async () => {
    const first = world(["admin"]);
    const response = await route(first.deps, "POST", "/api/v1/admin/credit-grants", { email: "f1@x.test", credits: 10, grant_id: "grant-0001" });
    expect(response!.status).toBe(201);
    expect(first.fake.queries.find((q) => q.text.startsWith("INSERT INTO ai_credit_ledger"))!.values).toContain("grant-0001");
    const repeat = await route(world(["admin"], { grantInserted: false }).deps, "POST", "/api/v1/admin/credit-grants", { email: "f1@x.test", credits: 10, grant_id: "grant-0001" });
    expect((await readJson(repeat!)).data.granted).toBe(0);
    for (const payload of [{ email: "f1@x.test", credits: 0, grant_id: "grant-0001" }, { email: "f1@x.test", credits: 5 }]) {
      expect((await route(world(["admin"]).deps, "POST", "/api/v1/admin/credit-grants", payload))!.status).toBe(422);
    }
    expect((await route(world(["admin"], { user: null }).deps, "POST", "/api/v1/admin/credit-grants", { email: "x@x.test", credits: 5, grant_id: "grant-0002" }))!.status).toBe(404);
  });

  it("never retires the free plan", async () => {
    expect((await route(world(["admin"]).deps, "POST", "/api/v1/admin/plans/free/status", { status: "retired" }))!.status).toBe(409);
  });
});
