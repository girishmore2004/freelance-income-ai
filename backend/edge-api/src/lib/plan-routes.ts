import type { Env } from "../types";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database } from "./core-routes";
import type { Sql } from "./core-routes";
import { failure, success } from "./response";
import { loadRoles } from "./identity";
import { creditBalance, planLimits } from "./ai-governor";

/**
 * Plans and AI credits (Phase 5 batch 1):
 *
 *   GET  /api/v1/plans                                   active plans (signed-in users)
 *   GET  /api/v1/me/plan                                 my plan, AI usage this day/month, credit balance
 * Admin only (others get 404):
 *   GET  /api/v1/admin/plans                             all plans incl. drafts
 *   POST /api/v1/admin/plans {code, name, ...}           create a draft plan
 *   POST /api/v1/admin/plans/{code}/status {status}      active | retired
 *   POST /api/v1/admin/plan-grants {email, plan_code, ends_at?}
 *   POST /api/v1/admin/credit-grants {email, credits, note, grant_id}
 *
 * Prices are data (D-14); nothing is charged here (payments BLOCKED, D-1/D-2).
 */

export interface PlanRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
}

const defaultDeps: PlanRouteDeps = { database, authenticate: authenticateRequest };

interface PlanRow {
  code: string;
  name: string;
  description: string;
  price_minor: string | number | null;
  currency: string;
  billing_interval: string;
  ai_daily_limit: number;
  ai_monthly_limit: number;
  features_json: string;
  status: string;
  sort_order: number;
}

function planOut(p: PlanRow) {
  let features: string[] = [];
  try {
    const parsed = JSON.parse(p.features_json || "[]");
    features = Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    features = [];
  }
  return {
    code: p.code,
    name: p.name,
    description: p.description,
    price_minor: p.price_minor === null ? null : Number(p.price_minor),
    currency: p.currency,
    billing_interval: p.billing_interval,
    ai_daily_limit: p.ai_daily_limit,
    ai_monthly_limit: p.ai_monthly_limit,
    features,
    status: p.status
  };
}

export function validatePlan(input: Record<string, unknown>): { ok: true; value: Omit<PlanRow, "status" | "sort_order" | "features_json"> & { features: string[] } } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const code = typeof input.code === "string" ? input.code.trim() : "";
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(code)) errors.code = "Code: 2–40 lowercase letters, digits or underscores.";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 2 || name.length > 80) errors.name = "Name must be 2 to 80 characters.";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (description.length > 300) errors.description = "Keep the description under 300 characters.";
  const price = input.price_minor ?? null;
  if (price !== null && (typeof price !== "number" || !Number.isInteger(price) || price < 0 || price > 100_000_000)) errors.price_minor = "Price must be empty or 0–₹10,00,000 in minor units.";
  const limit = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100_000;
  if (!limit(input.ai_daily_limit)) errors.ai_daily_limit = "Daily AI limit must be 0–100,000.";
  if (!limit(input.ai_monthly_limit)) errors.ai_monthly_limit = "Monthly AI limit must be 0–100,000.";
  else if (limit(input.ai_daily_limit) && (input.ai_monthly_limit as number) < (input.ai_daily_limit as number)) errors.ai_monthly_limit = "The monthly limit cannot be below the daily limit.";
  const interval = input.billing_interval ?? "month";
  if (interval !== "month" && interval !== "year") errors.billing_interval = "Billing interval must be month or year.";
  const features = Array.isArray(input.features) ? input.features.map((f) => String(f).trim()).filter(Boolean) : [];
  if (features.length > 12 || features.some((f) => f.length > 120)) errors.features = "Up to 12 features, each under 120 characters.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      code, name, description, price_minor: price as number | null, currency: "INR", billing_interval: interval as string,
      ai_daily_limit: input.ai_daily_limit as number, ai_monthly_limit: input.ai_monthly_limit as number, features
    }
  };
}

async function userByEmail(sql: Sql, email: unknown): Promise<string | null> {
  if (typeof email !== "string" || !email.includes("@") || email.length > 255) return null;
  const rows = await sql<{ id: string }[]>`SELECT id FROM users WHERE lower(email) = lower(${email.trim()}) LIMIT 1`;
  return rows[0]?.id ?? null;
}

export async function handlePlanRoute(request: Request, env: Env, requestId: string, deps: PlanRouteDeps = defaultDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const planStatus = path.match(/^\/api\/v1\/admin\/plans\/([a-z][a-z0-9_]{1,39})\/status$/);
  const known =
    (method === "GET" && (path === "/api/v1/plans" || path === "/api/v1/me/plan" || path === "/api/v1/admin/plans")) ||
    (method === "POST" && (path === "/api/v1/admin/plans" || path === "/api/v1/admin/plan-grants" || path === "/api/v1/admin/credit-grants" || planStatus !== null));
  if (!known) return null;

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);

  try {
    if (path === "/api/v1/plans") {
      const rows = await sql<PlanRow[]>`SELECT * FROM plans WHERE status = 'active' ORDER BY sort_order, code`;
      return success(rows.map(planOut), "Plans", 200, requestId);
    }

    if (path === "/api/v1/me/plan") {
      const limits = await planLimits(env, sql, userId);
      const plan = (await sql<PlanRow[]>`SELECT * FROM plans WHERE code = ${limits.plan} LIMIT 1`)[0];
      const until = (await sql<{ ends_at: Date | null }[]>`SELECT ends_at FROM user_plans WHERE user_id = ${userId} LIMIT 1`)[0];
      const usage = (await sql<{ day: string | number; month: string | number }[]>`
        SELECT count(*) FILTER (WHERE created_at >= date_trunc('day', now())) AS day,
               count(*) AS month
        FROM ai_usage_events WHERE user_id = ${userId} AND created_at >= date_trunc('month', now())
      `)[0];
      return success(
        {
          plan: plan ? planOut(plan) : { code: limits.plan, name: "Default", ai_daily_limit: limits.daily, ai_monthly_limit: limits.monthly },
          plan_ends_at: until?.ends_at ? new Date(until.ends_at).toISOString() : null,
          usage: { today: Number(usage?.day ?? 0), this_month: Number(usage?.month ?? 0) },
          limits: { daily: limits.daily, monthly: limits.monthly },
          credits: await creditBalance(sql, userId),
          purchases_available: false
        },
        "Your plan",
        200,
        requestId
      );
    }

    // ---------------- admin ----------------
    const roles = await loadRoles(sql, userId);
    if (!roles.includes("admin")) return failure("NOT_FOUND", "Not found", 404, requestId);

    if (path === "/api/v1/admin/plans" && method === "GET") {
      const rows = await sql<PlanRow[]>`SELECT * FROM plans ORDER BY sort_order, code`;
      return success(rows.map(planOut), "All plans", 200, requestId);
    }

    const payload = (await body(request)) ?? {};

    if (path === "/api/v1/admin/plans") {
      const v = validatePlan(payload);
      if (!v.ok) return failure("INVALID_PLAN", "Check the highlighted fields.", 422, requestId, [v.errors]);
      const p = v.value;
      const rows = await sql<PlanRow[]>`
        INSERT INTO plans (code, name, description, price_minor, currency, billing_interval, ai_daily_limit, ai_monthly_limit, features_json, status, sort_order, created_at, updated_at)
        VALUES (${p.code}, ${p.name}, ${p.description}, ${p.price_minor}, ${p.currency}, ${p.billing_interval}, ${p.ai_daily_limit}, ${p.ai_monthly_limit},
                ${JSON.stringify(p.features)}, 'draft', 100, now(), now())
        ON CONFLICT (code) DO NOTHING
        RETURNING *
      `;
      if (!rows[0]) return failure("PLAN_EXISTS", "A plan with this code already exists.", 409, requestId);
      return success(planOut(rows[0]), "Draft plan saved", 201, requestId);
    }

    if (planStatus) {
      const status = payload.status;
      if (status !== "active" && status !== "retired") return failure("INVALID_STATUS", "Status must be active or retired.", 422, requestId);
      if (planStatus[1] === "free" && status === "retired") return failure("FREE_PLAN_REQUIRED", "The free plan cannot be retired.", 409, requestId);
      const rows = await sql<PlanRow[]>`UPDATE plans SET status = ${status}, updated_at = now() WHERE code = ${planStatus[1]} RETURNING *`;
      if (!rows[0]) return failure("NOT_FOUND", "Plan not found", 404, requestId);
      return success(planOut(rows[0]), status === "active" ? "Plan activated" : "Plan retired", 200, requestId);
    }

    const target = await userByEmail(sql, payload.email);
    if (!target) return failure("USER_NOT_FOUND", "No account uses that email.", 404, requestId);

    if (path === "/api/v1/admin/plan-grants") {
      const code = typeof payload.plan_code === "string" ? payload.plan_code : "";
      const plan = (await sql<PlanRow[]>`SELECT * FROM plans WHERE code = ${code} AND status = 'active' LIMIT 1`)[0];
      if (!plan) return failure("INVALID_PLAN", "Choose an active plan.", 422, requestId);
      let endsAt: string | null = null;
      if (payload.ends_at !== undefined && payload.ends_at !== null && payload.ends_at !== "") {
        const d = new Date(String(payload.ends_at));
        if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) return failure("INVALID_DATE", "The end date must be in the future.", 422, requestId);
        endsAt = d.toISOString();
      }
      await sql`
        INSERT INTO user_plans (user_id, plan_code, source, started_at, ends_at, granted_by)
        VALUES (${target}, ${plan.code}, 'admin', now(), ${endsAt}, ${userId})
        ON CONFLICT (user_id) DO UPDATE SET plan_code = EXCLUDED.plan_code, source = 'admin', started_at = now(), ends_at = EXCLUDED.ends_at, granted_by = EXCLUDED.granted_by
      `;
      console.log(JSON.stringify({ service: "freelance-income-ai-api-edge", event: "admin.plan_granted", plan: plan.code, target, by: userId }));
      return success({ plan_code: plan.code, ends_at: endsAt }, `Plan ${plan.name} granted`, 200, requestId);
    }

    // credit grants
    const credits = payload.credits;
    if (typeof credits !== "number" || !Number.isInteger(credits) || credits < 1 || credits > 10_000) {
      return failure("INVALID_CREDITS", "Credits must be a whole number from 1 to 10,000.", 422, requestId);
    }
    const grantId = typeof payload.grant_id === "string" && /^[\w-]{8,64}$/.test(payload.grant_id) ? payload.grant_id : null;
    if (!grantId) return failure("INVALID_GRANT", "grant_id (8–64 characters) is required so a retry never grants twice.", 422, requestId);
    const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 300) : "";
    const rows = await sql<{ id: string }[]>`
      INSERT INTO ai_credit_ledger (id, user_id, delta, reason, ref, note, created_by, created_at)
      VALUES (${crypto.randomUUID()}, ${target}, ${credits}, 'grant', ${grantId}, ${note}, ${userId}, now())
      ON CONFLICT (reason, ref) DO NOTHING
      RETURNING id
    `;
    console.log(JSON.stringify({ service: "freelance-income-ai-api-edge", event: "admin.credits_granted", credits, target, by: userId, duplicate: !rows[0] }));
    return success(
      { granted: rows[0] ? credits : 0, balance: await creditBalance(sql, target) },
      rows[0] ? `${credits} AI credit${credits === 1 ? "" : "s"} granted` : "This grant was already applied",
      rows[0] ? 201 : 200,
      requestId
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
