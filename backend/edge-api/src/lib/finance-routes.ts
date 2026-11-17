import type { Env } from "../types";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database } from "./core-routes";
import type { Sql } from "./core-routes";
import { failure, success } from "./response";
import { FLAGS, isEnabled } from "./flags";
import { loadRoles } from "./identity";
import { quoteFees, validateSchedule } from "./fees";
import type { FeeSchedule } from "./fees";
import { trialBalance } from "./ledger";

/**
 * Finance foundation (Phase 4 batch 1):
 *
 *   GET  /api/v1/finance/fee-quote?amount_minor=&currency=INR   any signed-in user; needs an approved schedule
 *   GET  /api/v1/finance/fee-schedules                          finance/admin
 *   POST /api/v1/finance/fee-schedules {name, currency, client_fee_bps, freelancer_fee_bps, min_fee_minor}  finance/admin → draft
 *   POST /api/v1/finance/fee-schedules/{id}/approve             admin; retires the previous approved schedule
 *   GET  /api/v1/finance/trial-balance?mode=sandbox             finance/admin
 *
 * Internal roles (finance, admin) are never self-granted (see identity.ts).
 * Nothing here moves money.
 */

export interface FinanceRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
}

const defaultDeps: FinanceRouteDeps = { database, authenticate: authenticateRequest };

interface ScheduleRow {
  id: string;
  name: string;
  currency: string;
  client_fee_bps: number;
  freelancer_fee_bps: number;
  min_fee_minor: string | number;
  status: string;
  effective_from: Date;
  created_by: string | null;
  approved_by: string | null;
  approved_at: Date | null;
  created_at: Date;
}

function scheduleOut(r: ScheduleRow) {
  return {
    id: r.id,
    name: r.name,
    currency: r.currency,
    client_fee_bps: r.client_fee_bps,
    freelancer_fee_bps: r.freelancer_fee_bps,
    min_fee_minor: Number(r.min_fee_minor),
    status: r.status,
    approved_at: r.approved_at ? new Date(r.approved_at).toISOString() : null,
    created_at: new Date(r.created_at).toISOString()
  };
}

export async function handleFinanceRoute(request: Request, env: Env, requestId: string, deps: FinanceRouteDeps = defaultDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const approve = path.match(/^\/api\/v1\/finance\/fee-schedules\/([\w-]{1,64})\/approve$/);
  const known =
    (method === "GET" && (path === "/api/v1/finance/fee-quote" || path === "/api/v1/finance/trial-balance" || path === "/api/v1/finance/fee-schedules")) ||
    (method === "POST" && (path === "/api/v1/finance/fee-schedules" || approve !== null));
  if (!known) return null;

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);

  try {
    if (path === "/api/v1/finance/fee-quote") {
      if (!(await isEnabled(env, sql, FLAGS.clientMarketplace, false))) return failure("FEATURE_DISABLED", "The client marketplace is not open yet.", 403, requestId);
      const amount = Number(url.searchParams.get("amount_minor"));
      const currency = (url.searchParams.get("currency") ?? "INR").toUpperCase();
      if (!Number.isInteger(amount) || amount <= 0 || amount > 100_000_000_000) return failure("INVALID_AMOUNT", "amount_minor must be a positive whole number.", 422, requestId);
      const schedule = (await sql<ScheduleRow[]>`
        SELECT * FROM fee_schedules WHERE status = 'approved' AND currency = ${currency} AND effective_from <= now()
        ORDER BY effective_from DESC LIMIT 1
      `)[0];
      if (!schedule) return failure("FEES_NOT_CONFIGURED", "Platform fees have not been decided yet.", 409, requestId);
      const s: FeeSchedule = { id: schedule.id, currency: schedule.currency, client_fee_bps: schedule.client_fee_bps, freelancer_fee_bps: schedule.freelancer_fee_bps, min_fee_minor: Number(schedule.min_fee_minor) };
      return success(quoteFees(amount, s), "Fee quote", 200, requestId);
    }

    const roles = await loadRoles(sql, userId);
    const isAdmin = roles.includes("admin");
    if (!isAdmin && !roles.includes("finance")) return failure("NOT_FOUND", "Not found", 404, requestId);

    if (path === "/api/v1/finance/trial-balance") {
      const mode = url.searchParams.get("mode") === "live" ? "live" : "sandbox";
      return success({ mode, ...(await trialBalance(sql, mode)) }, "Trial balance", 200, requestId);
    }

    if (path === "/api/v1/finance/fee-schedules" && method === "GET") {
      const rows = await sql<ScheduleRow[]>`SELECT * FROM fee_schedules ORDER BY created_at DESC LIMIT 50`;
      return success(rows.map(scheduleOut), "Fee schedules", 200, requestId);
    }

    if (path === "/api/v1/finance/fee-schedules") {
      const validation = validateSchedule((await body(request)) ?? {});
      if (!validation.ok) return failure("INVALID_SCHEDULE", "Check the highlighted fields.", 422, requestId, [validation.errors]);
      const v = validation.value;
      const rows = await sql<ScheduleRow[]>`
        INSERT INTO fee_schedules (id, name, currency, client_fee_bps, freelancer_fee_bps, min_fee_minor, status, effective_from, created_by, created_at)
        VALUES (${crypto.randomUUID()}, ${v.name}, ${v.currency}, ${v.client_fee_bps}, ${v.freelancer_fee_bps}, ${v.min_fee_minor}, 'draft', now(), ${userId}, now())
        RETURNING *
      `;
      return success(scheduleOut(rows[0]), "Draft fee schedule saved. An admin must approve it.", 201, requestId);
    }

    // approve
    if (!isAdmin) return failure("FORBIDDEN", "Only an admin can approve fee schedules.", 403, requestId);
    const approved = await sql.begin(async (tx) => {
      const row = (await tx<ScheduleRow[]>`SELECT * FROM fee_schedules WHERE id = ${approve![1]} FOR UPDATE`)[0];
      if (!row || row.status !== "draft") return null;
      await tx`UPDATE fee_schedules SET status = 'retired' WHERE status = 'approved' AND currency = ${row.currency}`;
      const rows = await tx<ScheduleRow[]>`
        UPDATE fee_schedules SET status = 'approved', approved_by = ${userId}, approved_at = now(), effective_from = now()
        WHERE id = ${row.id} RETURNING *
      `;
      return rows[0];
    });
    if (!approved) return failure("NOT_DRAFT", "Only draft schedules can be approved.", 409, requestId);
    console.log(JSON.stringify({ service: "freelance-income-ai-api-edge", event: "finance.fee_schedule_approved", schedule_id: approved.id, by: userId }));
    return success(scheduleOut(approved), "Fee schedule approved", 200, requestId);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
