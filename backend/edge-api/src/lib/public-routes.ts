import type { Env } from "../types";
import { database } from "./core-routes";
import type { Sql } from "./core-routes";
import { success } from "./response";
import { FLAGS, isEnabled } from "./flags";

/**
 * Public, no-login information for the marketing pages (Phase 8):
 *
 *   GET /api/v1/public/pricing   active plans, the approved fee schedule (or "not decided"),
 *                                whether payments and the client marketplace are live
 *
 * Only decided values are shown; nothing is invented. If a table is not
 * migrated yet, that part reports "unavailable" instead of failing.
 */

export interface PublicRouteDeps {
  database: (env: Env) => Sql;
}

const defaultDeps: PublicRouteDeps = { database };

export async function handlePublicRoute(request: Request, env: Env, requestId: string, deps: PublicRouteDeps = defaultDeps): Promise<Response | null> {
  if (request.method.toUpperCase() !== "GET" || new URL(request.url).pathname !== "/api/v1/public/pricing") return null;
  const sql = deps.database(env);
  try {
    let plans: Array<Record<string, unknown>> | null = null;
    try {
      const rows = await sql<{ code: string; name: string; description: string; price_minor: string | number | null; currency: string; billing_interval: string; ai_daily_limit: number; ai_monthly_limit: number; features_json: string }[]>`
        SELECT code, name, description, price_minor, currency, billing_interval, ai_daily_limit, ai_monthly_limit, features_json
        FROM plans WHERE status = 'active' ORDER BY sort_order, code
      `;
      plans = rows.map((p) => {
        let features: string[] = [];
        try {
          const parsed = JSON.parse(p.features_json || "[]");
          features = Array.isArray(parsed) ? parsed.map(String) : [];
        } catch {
          features = [];
        }
        return {
          code: p.code, name: p.name, description: p.description, price_minor: p.price_minor === null ? null : Number(p.price_minor),
          currency: p.currency, billing_interval: p.billing_interval, ai_daily_limit: p.ai_daily_limit, ai_monthly_limit: p.ai_monthly_limit, features
        };
      });
    } catch {
      plans = null;
    }

    let fees: Record<string, unknown> = { status: "unavailable" };
    try {
      const row = (await sql<{ client_fee_bps: number; freelancer_fee_bps: number; min_fee_minor: string | number; currency: string }[]>`
        SELECT client_fee_bps, freelancer_fee_bps, min_fee_minor, currency FROM fee_schedules
        WHERE status = 'approved' AND effective_from <= now() ORDER BY effective_from DESC LIMIT 1
      `)[0];
      fees = row
        ? { status: "approved", client_fee_bps: row.client_fee_bps, freelancer_fee_bps: row.freelancer_fee_bps, min_fee_minor: Number(row.min_fee_minor), currency: row.currency }
        : { status: "not_decided" };
    } catch {
      fees = { status: "unavailable" };
    }

    return success(
      {
        plans,
        fees,
        payments_live: await isEnabled(env, sql, FLAGS.paymentsLive, false),
        client_marketplace_open: await isEnabled(env, sql, FLAGS.clientMarketplace, false)
      },
      "Pricing",
      200,
      requestId
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
