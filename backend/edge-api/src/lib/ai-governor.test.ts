import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import { estimateCostMicros, reserveAiCall, settleAiCall } from "./ai-governor";
import { draftProposal } from "./core-routes";
import { isEnabled } from "./flags";
import { createFakeSql } from "./test-support";

const ai = { run: async () => ({ response: "A truthful proposal draft that is long enough to keep." }) };
const baseEnv = { AI: ai, AI_GLOBAL_DAILY_BUDGET_USD: "1", AI_COST_INPUT_USD_PER_MTOK: "1", AI_COST_OUTPUT_USD_PER_MTOK: "3" } as unknown as Env;

function usageSql(usage: { user_day: number; user_month: number; global_day_micros: number }, flagEnabled = true) {
  return createFakeSql((text) => {
    if (text.startsWith("SELECT enabled FROM feature_flags")) return [{ enabled: flagEnabled }];
    if (text.startsWith("SELECT count(*) FILTER")) return [{ user_day: String(usage.user_day), user_month: String(usage.user_month), global_day_micros: String(usage.global_day_micros) }];
    return [];
  });
}

const call = { userId: "u1", operation: "proposal_draft", inputChars: 4000, maxOutputTokens: 900 };

describe("AI governor", () => {
  it("estimates cost from configured per-token prices", () => {
    // 4000 chars ~ 1000 input tokens * $1/M + 900 output * $3/M = 1000 + 2700 micro-USD
    expect(estimateCostMicros(baseEnv, 4000, 900)).toBe(3700);
  });

  it("reserves a usage row with the worst-case estimate before the call", async () => {
    const fake = usageSql({ user_day: 0, user_month: 0, global_day_micros: 0 });
    const decision = await reserveAiCall(baseEnv, fake.sql, call);
    expect(decision.allowed).toBe(true);
    const insert = fake.queries.find((q) => q.text.startsWith("INSERT INTO ai_usage_events"));
    expect(insert?.values).toContain(3700);
    expect(insert?.values).toContain("u1");
  });

  it("enforces per-user daily and monthly quotas", async () => {
    const day = await reserveAiCall(baseEnv, usageSql({ user_day: 20, user_month: 20, global_day_micros: 0 }).sql, call);
    expect(day).toMatchObject({ allowed: false, reason: "user_daily_quota" });
    const month = await reserveAiCall(baseEnv, usageSql({ user_day: 1, user_month: 300, global_day_micros: 0 }).sql, call);
    expect(month).toMatchObject({ allowed: false, reason: "user_monthly_quota" });
  });

  it("enforces the global daily budget across all users", async () => {
    const fake = usageSql({ user_day: 0, user_month: 0, global_day_micros: 999_000 });
    const decision = await reserveAiCall(baseEnv, fake.sql, call);
    expect(decision).toMatchObject({ allowed: false, reason: "global_budget" });
    expect(fake.queries.some((q) => q.text.startsWith("INSERT"))).toBe(false);
  });

  it("honours the ai.generation flag and the FEATURE_FLAGS_OFF kill switch", async () => {
    expect(await reserveAiCall(baseEnv, usageSql({ user_day: 0, user_month: 0, global_day_micros: 0 }, false).sql, call)).toMatchObject({ allowed: false, reason: "disabled" });
    const killEnv = { ...baseEnv, FEATURE_FLAGS_OFF: "ai.generation" } as Env;
    const fake = usageSql({ user_day: 0, user_month: 0, global_day_micros: 0 }, true);
    expect(await reserveAiCall(killEnv, fake.sql, call)).toMatchObject({ allowed: false, reason: "disabled" });
    expect(await isEnabled({ FEATURE_FLAGS_OFF: "*" } as Env, fake.sql, "payments.live", true)).toBe(false);
  });

  it("fails closed when usage cannot be read", async () => {
    const broken = createFakeSql((text) => {
      if (text.startsWith("SELECT enabled")) return [{ enabled: true }];
      throw new Error("database unavailable");
    });
    expect(await reserveAiCall(baseEnv, broken.sql, call)).toMatchObject({ allowed: false, reason: "governor_error" });
  });

  it("settles the reservation using the actual output size", async () => {
    const fake = createFakeSql(() => []);
    await settleAiCall(baseEnv, fake.sql, "evt-1", 4000, 400);
    // 1000 input tokens * 1 + 100 output tokens * 3
    expect(fake.queries[0].values).toEqual([400, 1300, "evt-1"]);
  });

  it("treats a missing flag row as the caller's default", async () => {
    const fake = createFakeSql(() => []);
    expect(await isEnabled({} as Env, fake.sql, "payments.live", false)).toBe(false);
    expect(await isEnabled({} as Env, fake.sql, "ai.generation", true)).toBe(true);
  });
});

describe("proposal drafting under the governor", () => {
  const profile = { full_name: "Asha", skills: '["Python"]', portfolio_links: "[]" };
  const opp = { title: "Build an API", description: "Need FastAPI work", currency: "INR" };

  it("uses the model when allowed", async () => {
    const fake = usageSql({ user_day: 0, user_month: 0, global_day_micros: 0 });
    const out = await draftProposal(baseEnv, profile, opp, null, { sql: fake.sql, userId: "u1" });
    expect(out.mode).toBe("model");
  });

  it("falls back to the safe template, with a reason, when the quota is exhausted", async () => {
    const fake = usageSql({ user_day: 20, user_month: 20, global_day_micros: 0 });
    const out = await draftProposal(baseEnv, profile, opp, null, { sql: fake.sql, userId: "u1" });
    expect(out.mode).toBe("safe_template");
    expect(out.ai_note).toContain("Daily AI limit");
  });

  it("never calls the model without a governance context", async () => {
    let called = false;
    const env = { AI: { run: async () => { called = true; return { response: "x".repeat(50) }; } } } as unknown as Env;
    const out = await draftProposal(env, profile, opp, null);
    expect(out.mode).toBe("safe_template");
    expect(called).toBe(false);
  });
});
