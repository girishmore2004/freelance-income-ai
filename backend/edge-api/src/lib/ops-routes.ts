import type { Env } from "../types";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { loadRoles } from "./identity";
import { releasePendingApprovals } from "./payments";
import { trialBalance } from "./ledger";
import { JOB_TYPES, enqueueJob } from "./jobs";
import type { JobType } from "./jobs";

/**
 * Operations for staff (U8; spec §14 "Payments and Reconciliation", "Payout
 * exceptions", system health):
 *
 *   GET  /api/v1/admin/finance-exceptions            (admin, finance) stale checkouts, failed payments,
 *                                                     approved-but-unreleased milestones, failed or stale payouts,
 *                                                     and a reconciliation of held funds against the ledger
 *   POST /api/v1/admin/finance-exceptions/retry-releases   (admin) re-run the release of approved, funded milestones
 *   POST /api/v1/admin/payments/{id}/cancel-checkout       (admin, finance) cancel a checkout left unpaid for 24 h
 *   GET  /api/v1/admin/jobs?status=failed|dead|retrying    (admin) background jobs that need attention
 *   POST /api/v1/admin/jobs/{id}/retry                     (admin) enqueue the same job again (new job, same payload)
 *
 * Every action is written to the append-only moderation log. Nothing here
 * creates money: retries call the same idempotent release used by approvals.
 */

export interface OpsRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
}

const defaultDeps: OpsRouteDeps = { database, authenticate: authenticateRequest };

async function logAction(sql: Queryable, actor: string, targetType: string, targetId: string, action: string, note: string): Promise<void> {
  await sql`
    INSERT INTO moderation_actions (id, actor_user_id, target_type, target_id, action, note, created_at)
    VALUES (${crypto.randomUUID()}, ${actor}, ${targetType}, ${targetId}, ${action}, ${note.slice(0, 2000)}, now())
  `;
}

export interface HeldMismatch {
  contract_id: string;
  mode: string;
  ledger_held_minor: number;
  funded_intents_minor: number;
}

/** Contracts whose "funds held" ledger balance differs from the funded, unreleased payments. */
export function heldMismatches(
  ledger: Array<{ contract_id: string; mode: string; held: string | number }>,
  intents: Array<{ contract_id: string; mode: string; funded: string | number }>
): HeldMismatch[] {
  const key = (c: string, m: string) => `${m}|${c}`;
  const all = new Map<string, HeldMismatch>();
  for (const l of ledger) all.set(key(l.contract_id, l.mode), { contract_id: l.contract_id, mode: l.mode, ledger_held_minor: Number(l.held), funded_intents_minor: 0 });
  for (const i of intents) {
    const k = key(i.contract_id, i.mode);
    const row = all.get(k) ?? { contract_id: i.contract_id, mode: i.mode, ledger_held_minor: 0, funded_intents_minor: 0 };
    row.funded_intents_minor = Number(i.funded);
    all.set(k, row);
  }
  return [...all.values()].filter((r) => r.ledger_held_minor !== r.funded_intents_minor);
}

async function financeExceptions(sql: Queryable) {
  const [stale, failed, stuck, payouts, ledgerHeld, fundedIntents] = await Promise.all([
    sql<Array<Record<string, unknown>>>`
      SELECT id, contract_id, milestone_index, total_minor, currency, mode, created_at FROM payment_intents
      WHERE status = 'created' AND created_at < now() - interval '24 hours' ORDER BY created_at ASC LIMIT 100
    `,
    sql<Array<Record<string, unknown>>>`
      SELECT id, contract_id, milestone_index, total_minor, currency, mode, updated_at FROM payment_intents
      WHERE status = 'failed' AND updated_at > now() - interval '30 days' ORDER BY updated_at DESC LIMIT 100
    `,
    sql<Array<Record<string, unknown>>>`
      SELECT DISTINCT i.id, i.contract_id, i.milestone_index, i.amount_minor, i.currency, i.mode, i.funded_at
      FROM payment_intents i
      JOIN milestone_submissions s ON s.contract_id = i.contract_id AND s.milestone_index = i.milestone_index AND s.status = 'approved'
      WHERE i.status = 'funded' LIMIT 100
    `,
    sql<Array<Record<string, unknown>>>`
      SELECT id, user_id, amount_minor, currency, mode, status, created_at FROM payouts
      WHERE status = 'failed' OR (status = 'requested' AND created_at < now() - interval '24 hours')
      ORDER BY created_at ASC LIMIT 100
    `,
    sql<Array<{ contract_id: string; mode: string; held: string | number }>>`
      SELECT substring(a.code from 'funds_held:contract:(.*)$') AS contract_id, e.mode,
             sum(CASE WHEN l.direction = 'credit' THEN l.amount_minor ELSE -l.amount_minor END) AS held
      FROM ledger_lines l JOIN ledger_accounts a ON a.id = l.account_id JOIN ledger_entries e ON e.id = l.entry_id
      WHERE a.code LIKE 'funds_held:contract:%'
      GROUP BY 1, 2
    `,
    sql<Array<{ contract_id: string; mode: string; funded: string | number }>>`
      SELECT contract_id, mode, sum(amount_minor) AS funded FROM payment_intents WHERE status = 'funded' GROUP BY 1, 2
    `
  ]);
  const [sandbox, live] = await Promise.all([trialBalance(sql, "sandbox"), trialBalance(sql, "live")]);
  const balanced = (t: Awaited<ReturnType<typeof trialBalance>>) => Object.values(t.totals).every((x) => x.balanced);
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  const money = (rows: Array<Record<string, unknown>>, field: string) =>
    rows.map((r) => ({ ...r, [field]: Number(r[field]), created_at: iso(r.created_at), updated_at: iso(r.updated_at), funded_at: iso(r.funded_at) }));
  const mismatches = heldMismatches(ledgerHeld, fundedIntents);
  return {
    stale_checkouts: money(stale, "total_minor"),
    failed_payments: money(failed, "total_minor"),
    approved_not_released: money(stuck, "amount_minor"),
    payout_exceptions: money(payouts, "amount_minor"),
    reconciliation: {
      held_mismatches: mismatches,
      trial_balance: { sandbox: balanced(sandbox), live: balanced(live) },
      ok: mismatches.length === 0 && balanced(sandbox) && balanced(live)
    },
    definitions: {
      stale_checkouts: "Checkouts created more than 24 hours ago and never paid.",
      approved_not_released: "Milestones the client approved whose funded payment is not released yet (the cron retries every 6 hours).",
      payout_exceptions: "Payouts that failed or are still requested after 24 hours.",
      held_mismatches: "Contracts where the ledger's funds-held balance differs from the funded, unreleased payments."
    }
  };
}

export async function handleOpsRoute(request: Request, env: Env, requestId: string, deps: OpsRouteDeps = defaultDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const cancel = path.match(/^\/api\/v1\/admin\/payments\/([\w-]{1,64})\/cancel-checkout$/);
  const retryJob = path.match(/^\/api\/v1\/admin\/jobs\/([\w-]{1,64})\/retry$/);
  const known =
    (path === "/api/v1/admin/finance-exceptions" && method === "GET") ||
    (path === "/api/v1/admin/finance-exceptions/retry-releases" && method === "POST") ||
    (path === "/api/v1/admin/jobs" && method === "GET") ||
    (cancel !== null && method === "POST") ||
    (retryJob !== null && method === "POST");
  if (!known) return null;

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);
  try {
    const roles = await loadRoles(sql, userId);
    const admin = roles.includes("admin");
    const finance = admin || roles.includes("finance");

    if (path === "/api/v1/admin/finance-exceptions") {
      if (!finance) return failure("NOT_FOUND", "Not found", 404, requestId);
      return success(await financeExceptions(sql), "Finance exceptions", 200, requestId);
    }
    if (cancel) {
      if (!finance) return failure("NOT_FOUND", "Not found", 404, requestId);
      const payload = (await body(request)) ?? {};
      const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 2000) : "";
      const rows = await sql<Array<{ id: string }>>`
        UPDATE payment_intents SET status = 'cancelled', updated_at = now()
        WHERE id = ${cancel[1]} AND status = 'created' AND created_at < now() - interval '24 hours'
        RETURNING id
      `;
      if (!rows[0]) return failure("NOT_CANCELLABLE", "Only checkouts left unpaid for more than 24 hours can be cancelled.", 409, requestId);
      await logAction(sql, userId, "payment", rows[0].id, "payment.checkout_cancelled", note || "Stale checkout cancelled");
      return success({ id: rows[0].id, status: "cancelled" }, "Checkout cancelled. The client can start a new one.", 200, requestId);
    }
    if (!admin) return failure("NOT_FOUND", "Not found", 404, requestId);

    if (path === "/api/v1/admin/finance-exceptions/retry-releases") {
      const released = await releasePendingApprovals(sql as Sql);
      await logAction(sql, userId, "payment", "approved_not_released", "payment.release_retried", `Released ${released}`);
      return success({ released }, released ? `Released ${released} approved milestone(s).` : "Nothing was waiting for release.", 200, requestId);
    }
    if (path === "/api/v1/admin/jobs") {
      const status = url.searchParams.get("status");
      const wanted = status === "dead" || status === "retrying" || status === "failed" ? [status] : ["failed", "dead", "retrying"];
      const rows = await sql<Array<Record<string, unknown>>>`
        SELECT id, user_id, job_type, status, attempts, error_code, error_message, created_at, finished_at, dead_lettered_at
        FROM background_jobs WHERE status = ANY(${wanted}) ORDER BY created_at DESC LIMIT 100
      `;
      return success(
        rows.map((r) => ({ ...r, attempts: Number(r.attempts ?? 0), retryable: JOB_TYPES.includes(String(r.job_type) as JobType) })),
        "Jobs needing attention",
        200,
        requestId
      );
    }
    // retry
    const job = (await sql<Array<{ id: string; user_id: string; job_type: string; status: string; payload_json: string | null }>>`
      SELECT id, user_id, job_type, status, payload_json FROM background_jobs WHERE id = ${retryJob![1]} LIMIT 1
    `)[0];
    if (!job) return failure("NOT_FOUND", "Job not found", 404, requestId);
    if (!["failed", "dead"].includes(job.status)) return failure("NOT_RETRYABLE", "Only failed or dead jobs can be retried.", 409, requestId);
    if (!JOB_TYPES.includes(job.job_type as JobType)) return failure("NOT_RETRYABLE", "This job type is not run by the Edge worker.", 409, requestId);
    let payload: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(job.payload_json || "{}");
      payload = parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      payload = {};
    }
    let result: Awaited<ReturnType<typeof enqueueJob>>;
    try {
      result = await enqueueJob(env, sql as Sql, { type: job.job_type as JobType, userId: job.user_id, payload, idempotencyKey: `retry:${job.id}` });
    } catch (error) {
      // The new job row is kept as failed with the reason; the original stays as it was.
      await logAction(sql, userId, "job", job.id, "job.retry_failed", error instanceof Error ? error.message : "queue error");
      return failure("QUEUE_UNAVAILABLE", "The job queue is not reachable right now. The retry was recorded as failed; try again later.", 503, requestId);
    }
    await logAction(sql, userId, "job", job.id, "job.retried", `New job ${result.job_id}${result.duplicate ? " (already retried)" : ""}`);
    return success(result, result.duplicate ? "This job was already retried." : "Job queued again.", 200, requestId);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
