import type { Env } from "../types";
import type { Sql } from "./core-routes";
import { FLAGS, isEnabled } from "./flags";
import { AGENT_FOR_OPERATION, agentEnabled } from "./agents";

/**
 * Every Edge AI model call goes through here first (Master Plan 3.13; finding:
 * no global spend cap, and Edge calls bypassed the Python per-user quotas).
 *
 * Checks, in order (any failure => caller uses its deterministic fallback):
 *   1. Flag `ai.generation` (and FEATURE_FLAGS_OFF kill switch), then the
 *      registry switch of the agent that owns the operation (agent_definitions).
 *   2. Per-user daily and monthly call quotas, counted across BOTH services
 *      from `ai_usage_events`. Limits come from the user's plan (`user_plans` →
 *      `plans`, migration 0057; no row = the `free` plan) and fall back to the
 *      Worker variables (defaults 20/day and 300/month) if plans are unavailable.
 *      Beyond the monthly limit, one AI credit is spent per call while the
 *      user's credit balance is positive. The daily limit is never bypassed.
 *   3. Global daily estimated spend across all users (AI_GLOBAL_DAILY_BUDGET_USD).
 *
 * A reservation row is written before the call with a worst-case cost estimate
 * (input + max output tokens), then settled with the real output size.
 * Reserving first means concurrent requests cannot overshoot the cap by more
 * than one call each. Costs are ESTIMATES from configured per-token prices;
 * the provider invoice is the accounting source of truth.
 *
 * Price variables (USD per 1M tokens) must be set from the provider's current
 * pricing page. Defaults are deliberately conservative placeholders.
 */

export type AiDecision =
  | { allowed: true; eventId: string; estimatedCostMicros: number; usedCredit?: boolean }
  | { allowed: false; reason: "disabled" | "user_daily_quota" | "user_monthly_quota" | "global_budget" | "governor_error"; message: string };

export interface AiCallRequest {
  userId: string;
  operation: string;
  inputChars: number;
  maxOutputTokens: number;
}

const CHARS_PER_TOKEN = 4;

function numberVar(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function aiLimits(env: Env) {
  return {
    userDaily: Math.floor(numberVar(env.AI_QUOTA_DAILY_CALLS, 20)),
    userMonthly: Math.floor(numberVar(env.AI_QUOTA_MONTHLY_CALLS, 300)),
    globalDailyBudgetMicros: Math.round(numberVar(env.AI_GLOBAL_DAILY_BUDGET_USD, 1) * 1_000_000),
    inputUsdPerMTok: numberVar(env.AI_COST_INPUT_USD_PER_MTOK, 1),
    outputUsdPerMTok: numberVar(env.AI_COST_OUTPUT_USD_PER_MTOK, 3),
    alertRatio: Math.min(1, numberVar(env.AI_BUDGET_ALERT_RATIO, 0.8))
  };
}

export interface PlanLimits {
  plan: string;
  daily: number;
  monthly: number;
}

/**
 * The user's plan limits. Never throws: if the plan tables are missing (code
 * deployed before migration 0057) the Worker-variable limits apply, so AI keeps
 * working exactly as before.
 */
export async function planLimits(env: Env, sql: Sql, userId: string): Promise<PlanLimits> {
  const fallback = aiLimits(env);
  try {
    const rows = await sql<{ code: string; ai_daily_limit: number; ai_monthly_limit: number }[]>`
      SELECT p.code, p.ai_daily_limit, p.ai_monthly_limit
      FROM plans p
      LEFT JOIN user_plans up ON up.plan_code = p.code AND up.user_id = ${userId} AND (up.ends_at IS NULL OR up.ends_at > now())
      WHERE (up.user_id IS NOT NULL) OR (p.code = 'free')
      ORDER BY (up.user_id IS NOT NULL) DESC
      LIMIT 1
    `;
    if (!rows[0]) return { plan: "default", daily: fallback.userDaily, monthly: fallback.userMonthly };
    return { plan: rows[0].code, daily: Number(rows[0].ai_daily_limit), monthly: Number(rows[0].ai_monthly_limit) };
  } catch (error) {
    console.warn(JSON.stringify({ event: "ai.plan_lookup_failed", error_message: error instanceof Error ? error.message : "unknown" }));
    return { plan: "default", daily: fallback.userDaily, monthly: fallback.userMonthly };
  }
}

/** AI credit balance (sum of signed movements). Returns 0 if credits are unavailable. */
export async function creditBalance(sql: Sql, userId: string): Promise<number> {
  try {
    const rows = await sql<{ balance: string | number | null }[]>`SELECT COALESCE(sum(delta), 0) AS balance FROM ai_credit_ledger WHERE user_id = ${userId}`;
    return Number(rows[0]?.balance ?? 0);
  } catch {
    return 0;
  }
}

/** Estimated cost in micro-USD for a call of this size. */
export function estimateCostMicros(env: Env, inputChars: number, outputTokens: number): number {
  const limits = aiLimits(env);
  const inputTokens = Math.ceil(Math.max(0, inputChars) / CHARS_PER_TOKEN);
  const micros = inputTokens * limits.inputUsdPerMTok + Math.max(0, outputTokens) * limits.outputUsdPerMTok;
  return Math.ceil(micros);
}

export async function reserveAiCall(env: Env, sql: Sql, call: AiCallRequest): Promise<AiDecision> {
  try {
    if (!env.AI) return { allowed: false, reason: "disabled", message: "No AI provider is configured." };
    if (!(await isEnabled(env, sql, FLAGS.aiGeneration, true))) {
      return { allowed: false, reason: "disabled", message: "AI generation is switched off by the platform." };
    }
    if (!(await agentEnabled(sql, AGENT_FOR_OPERATION[call.operation]))) {
      return { allowed: false, reason: "disabled", message: "This AI agent is switched off by the platform. A template was used instead." };
    }

    const limits = aiLimits(env);
    const plan = await planLimits(env, sql, call.userId);
    const estimate = estimateCostMicros(env, call.inputChars, call.maxOutputTokens);

    const usage = await sql<{ user_day: string; user_month: string; global_day_micros: string | null }[]>`
      SELECT
        count(*) FILTER (WHERE user_id = ${call.userId} AND created_at >= date_trunc('day', now())) AS user_day,
        count(*) FILTER (WHERE user_id = ${call.userId} AND created_at >= date_trunc('month', now())) AS user_month,
        COALESCE(sum(estimated_cost_micros) FILTER (WHERE created_at >= date_trunc('day', now())), 0) AS global_day_micros
      FROM ai_usage_events
      WHERE created_at >= date_trunc('month', now())
    `;
    const userDay = Number(usage[0]?.user_day ?? 0);
    const userMonth = Number(usage[0]?.user_month ?? 0);
    const globalDay = Number(usage[0]?.global_day_micros ?? 0);

    if (userDay >= plan.daily) {
      return { allowed: false, reason: "user_daily_quota", message: `Daily AI limit of ${plan.daily} reached. A template was used instead.` };
    }
    let useCredit = false;
    if (userMonth >= plan.monthly) {
      if ((await creditBalance(sql, call.userId)) <= 0) {
        return { allowed: false, reason: "user_monthly_quota", message: `Monthly AI limit of ${plan.monthly} reached. A template was used instead.` };
      }
      useCredit = true;
    }
    if (globalDay + estimate > limits.globalDailyBudgetMicros) {
      console.warn(JSON.stringify({ event: "ai.budget_exhausted", alert: true, global_day_micros: globalDay, budget_micros: limits.globalDailyBudgetMicros }));
      return { allowed: false, reason: "global_budget", message: "The platform's daily AI budget is used up. A template was used instead." };
    }
    if (globalDay + estimate >= limits.globalDailyBudgetMicros * limits.alertRatio) {
      console.warn(JSON.stringify({ event: "ai.budget_threshold", alert: true, global_day_micros: globalDay + estimate, budget_micros: limits.globalDailyBudgetMicros }));
    }

    const eventId = crypto.randomUUID();
    await sql`
      INSERT INTO ai_usage_events (id, user_id, operation, provider, input_chars, output_chars, created_at, estimated_cost_micros, service)
      VALUES (${eventId}, ${call.userId}, ${call.operation.slice(0, 80)}, 'workers_ai', ${Math.max(0, Math.floor(call.inputChars))}, 0, now(), ${estimate}, 'edge')
    `;
    if (useCredit) {
      await sql`
        INSERT INTO ai_credit_ledger (id, user_id, delta, reason, ref, note, created_at)
        VALUES (${crypto.randomUUID()}, ${call.userId}, -1, 'ai_call', ${eventId}, ${call.operation.slice(0, 80)}, now())
        ON CONFLICT (reason, ref) DO NOTHING
      `;
    }
    return { allowed: true, eventId, estimatedCostMicros: estimate, usedCredit: useCredit };
  } catch (error) {
    // Fail closed: if usage cannot be checked, do not spend.
    console.error(JSON.stringify({ event: "ai.governor_failed", error_message: error instanceof Error ? error.message : "unknown" }));
    return { allowed: false, reason: "governor_error", message: "AI usage could not be checked. A template was used instead." };
  }
}

/** Replaces the worst-case estimate with one based on the actual output size. */
export async function settleAiCall(env: Env, sql: Sql, eventId: string, inputChars: number, outputChars: number): Promise<void> {
  const cost = estimateCostMicros(env, inputChars, Math.ceil(Math.max(0, outputChars) / CHARS_PER_TOKEN));
  try {
    await sql`
      UPDATE ai_usage_events SET output_chars = ${Math.max(0, Math.floor(outputChars))}, estimated_cost_micros = ${cost}
      WHERE id = ${eventId}
    `;
  } catch (error) {
    // Keeping the worst-case reservation is the safe outcome.
    console.warn(JSON.stringify({ event: "ai.settle_failed", error_message: error instanceof Error ? error.message : "unknown" }));
  }
}
