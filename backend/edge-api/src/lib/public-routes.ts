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

/** Runs a query; a table that is not migrated yet gives null. */
async function maybe<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch {
    return null;
  }
}

/**
 *   GET /api/v1/public/home      categories (with open/closed state), agents that are live or
 *                                partly built, and real counts (published projects, freelancers
 *                                visible to clients, completed contracts). The page shows a count
 *                                only when it is above zero: no invented statistics.
 */
async function publicHome(env: Env, sql: Sql, requestId: string): Promise<Response> {
  const categories = await maybe(() => sql<{ slug: string; name: string; enabled: boolean }[]>`
    SELECT slug, name, enabled FROM project_categories ORDER BY sort_order, name
  `);
  const agents = await maybe(() => sql<{ code: string; name: string; side: string; purpose: string; status: string }[]>`
    SELECT code, name, side, purpose, status FROM agent_definitions WHERE status IN ('live', 'partial') AND enabled = true ORDER BY side, code
  `);
  const counts = await maybe(() => sql<{ listings: number; freelancers: number; completed: number }[]>`
    SELECT
      (SELECT count(*)::int FROM project_listings WHERE status = 'published' AND visibility = 'public') AS listings,
      (SELECT count(*)::int FROM profiles WHERE marketplace_visible = true) AS freelancers,
      (SELECT count(*)::int FROM contracts WHERE status = 'completed') AS completed
  `);
  const open = await isEnabled(env, sql, FLAGS.clientMarketplace, false);
  return success(
    {
      client_marketplace_open: open,
      categories: (categories ?? []).map((c) => ({ slug: c.slug, name: c.name, open: Boolean(c.enabled) && open })),
      agents: (agents ?? []).map((a) => ({ code: a.code, name: a.name, side: a.side, purpose: a.purpose, status: a.status })),
      counts: counts?.[0] ? { published_projects: Number(counts[0].listings), visible_freelancers: Number(counts[0].freelancers), completed_contracts: Number(counts[0].completed) } : null
    },
    "Public home",
    200,
    requestId
  );
}

export async function handlePublicRoute(request: Request, env: Env, requestId: string, deps: PublicRouteDeps = defaultDeps): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (request.method.toUpperCase() !== "GET" || (path !== "/api/v1/public/pricing" && path !== "/api/v1/public/home")) return null;
  const sql = deps.database(env);
  if (path === "/api/v1/public/home") {
    try {
      return await publicHome(env, sql, requestId);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
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
