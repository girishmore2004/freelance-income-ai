import type { Env } from "../types";
import type { Sql } from "./core-routes";
import { FLAGS, isEnabled } from "./flags";

/**
 * Every Edge AI model call goes through here first (Master Plan 3.13; finding:
 * no global spend cap, and Edge calls bypassed the Python per-user quotas).
 *
 * Checks, in order (any failure => caller uses its deterministic fallback):
 *   1. Flag `ai.generation` (and FEATURE_FLAGS_OFF kill switch).
 *   2. Per-user daily and monthly call quotas, counted across BOTH services
 *      from `ai_usage_events` (defaults 20/day and 300/month = Python defaults).
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
  | { allowed: true; eventId: string; estimatedCostMicros: number }
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

    const limits = aiLimits(env);
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

    if (userDay >= limits.userDaily) {
      return { allowed: false, reason: "user_daily_quota", message: `Daily AI limit of ${limits.userDaily} reached. A template was used instead.` };
    }
    if (userMonth >= limits.userMonthly) {
      return { allowed: false, reason: "user_monthly_quota", message: `Monthly AI limit of ${limits.userMonthly} reached. A template was used instead.` };
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
    return { allowed: true, eventId, estimatedCostMicros: estimate };
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
