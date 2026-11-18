import type { Env } from "../types";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { canManageOrganization, organizationForMember } from "./identity";
import { billingOf } from "./contracts";
import type { ContractRow, ContractVersionRow, Party } from "./contracts";
import { recordContractEvent } from "./contract-events";
import { screenText } from "./listings";
import { tableExists } from "./external-pipeline";
import { createTimesheetFunding, intentOut } from "./payments";
import type { IntentRow } from "./payments";

/**
 * Hourly contracts (U19, Upwork-style).
 *
 *   GET  /api/v1/contracts/{id}/timesheets            parties: weeks with entries, totals, payments
 *   POST /api/v1/contracts/{id}/time-entries          freelancer {work_date, minutes, description}
 *   POST /api/v1/time-entries/{id}/delete             freelancer, while the week is open
 *   POST /api/v1/timesheets/{id}/submit               freelancer: freezes minutes × rate
 *   POST /api/v1/timesheets/{id}/review               client owner/admin {decision: approve|return, note}
 *   POST /api/v1/timesheets/{id}/pay                  client owner/admin (Idempotency-Key) → test checkout
 *   POST /api/v1/contracts/{id}/end                   either party: ends an active hourly contract
 *
 * Weeks run Monday to Sunday (UTC). Time can be logged for the current and the
 * previous week only, never in the future or before the contract started, and
 * never beyond the agreed weekly limit. The amount is computed by fixed rules
 * (minutes × hourly rate ÷ 60, rounded half up to the paisa) — never by a model —
 * and the client approves every week explicitly before paying it.
 */

/** Decision D-22 (2026-11-18): a week the client has not reviewed is approved after this many days, as on Upwork. */
export const AUTO_APPROVE_DAYS = 5;

/**
 * Approves submitted weeks left unreviewed for AUTO_APPROVE_DAYS. Approval only:
 * no money moves until the client pays the week. Run by the cron; idempotent.
 */
export async function autoApproveTimesheets(sql: Queryable, now: Date): Promise<number> {
  if (!(await tableExists(sql, "contract_timesheets"))) return 0;
  const cutoff = new Date(now.getTime() - AUTO_APPROVE_DAYS * 86_400_000).toISOString();
  const due = await sql<Array<{ id: string; contract_id: string; week_start: Date | string; amount_minor: string | number | null }>>`
    UPDATE contract_timesheets SET status = 'approved', decided_at = now(), decided_by = NULL,
      client_note = ${`Approved automatically: not reviewed within ${AUTO_APPROVE_DAYS} days`}, updated_at = now()
    WHERE status = 'submitted' AND submitted_at < ${cutoff}
    RETURNING id, contract_id, week_start, amount_minor
  `;
  for (const s of due) {
    await recordContractEvent(sql, s.contract_id, null, "system", "timesheet.approved", {
      week_start: day(s.week_start), amount_minor: Number(s.amount_minor ?? 0), automatic: true
    }).catch(() => undefined);
  }
  return due.length;
}

export interface TimesheetRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
  now: () => Date;
}

const defaultDeps: TimesheetRouteDeps = { database, authenticate: authenticateRequest, now: () => new Date() };

export const MAX_ENTRY_MINUTES = 1440;
const WEEKS_SHOWN = 12;

/** Monday (UTC) of the week containing `d`, as YYYY-MM-DD. Pure. */
export function weekStart(d: Date): string {
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

/** Amount for logged minutes at an hourly rate, half up to the paisa. Pure. */
export function amountFor(minutes: number, rateMinor: number): number {
  return Math.floor((minutes * rateMinor) / 60 + 0.5);
}

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const day = (d: Date | string) => (typeof d === "string" ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10));

/** Checks one time entry against the calendar rules. Pure. */
export function validateEntry(
  input: Record<string, unknown>,
  ctx: { today: Date; activatedAt: Date | null }
): { ok: true; value: { work_date: string; minutes: number; description: string; week_start: string } } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const date = typeof input.work_date === "string" ? input.work_date : "";
  const minutes = Number(input.minutes);
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const todayStr = ctx.today.toISOString().slice(0, 10);
  const thisWeek = weekStart(ctx.today);
  const lastWeek = weekStart(new Date(Date.parse(`${thisWeek}T00:00:00Z`) - 86_400_000));
  if (!isDate(date)) errors.work_date = "Choose the date you worked.";
  else if (date > todayStr) errors.work_date = "You cannot log time in the future.";
  else if (date < lastWeek) errors.work_date = "Log time for this week or last week only.";
  else if (ctx.activatedAt && date < day(ctx.activatedAt)) errors.work_date = "The contract had not started on that day.";
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_ENTRY_MINUTES) errors.minutes = "Enter 1 minute to 24 hours.";
  if (description.length < 3 || description.length > 500) errors.description = "Describe the work in 3 to 500 characters.";
  else if (screenText(description).some((f) => f.code === "off_platform_contact" || f.code === "off_platform_payment")) {
    errors.description = "Keep contact and payment details out of time entries.";
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { work_date: date, minutes, description, week_start: weekStart(new Date(`${date}T00:00:00Z`)) } };
}

type SheetRow = {
  id: string; contract_id: string; week_start: Date | string; status: string; minutes: number; rate_minor: string | number; amount_minor: string | number | null;
  client_note: string; submitted_at: Date | null; decided_at: Date | null; paid_at: Date | null;
};
type EntryRow = { id: string; timesheet_id: string; work_date: Date | string; minutes: number; description: string; created_at: Date };

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

function sheetOut(s: SheetRow, entries: EntryRow[], payment: IntentRow | undefined) {
  const rate = Number(s.rate_minor);
  return {
    id: s.id,
    week_start: day(s.week_start),
    status: s.status,
    minutes: Number(s.minutes),
    rate_minor: rate,
    amount_minor: s.amount_minor === null ? amountFor(Number(s.minutes), rate) : Number(s.amount_minor),
    amount_final: s.amount_minor !== null,
    client_note: s.client_note,
    submitted_at: iso(s.submitted_at),
    decided_at: iso(s.decided_at),
    paid_at: iso(s.paid_at),
    entries: entries.filter((e) => e.timesheet_id === s.id).map((e) => ({ id: e.id, work_date: day(e.work_date), minutes: Number(e.minutes), description: e.description })),
    payment: payment ? intentOut(payment) : null
  };
}

async function contractSide(sql: Queryable, userId: string, contractId: string) {
  const contract = (await sql<ContractRow[]>`SELECT * FROM contracts WHERE id = ${contractId} LIMIT 1`)[0];
  if (!contract) return null;
  let side: { party: Party; canManage: boolean } | null = null;
  if (contract.freelancer_user_id === userId) side = { party: "freelancer", canManage: true };
  else {
    const org = await organizationForMember(sql, userId, contract.organization_id);
    if (org) side = { party: "client", canManage: canManageOrganization(org.membership_role) };
  }
  if (!side) return null;
  const version = (await sql<ContractVersionRow[]>`
    SELECT * FROM contract_versions WHERE contract_id = ${contract.id} AND version = ${contract.agreed_version ?? contract.current_version} LIMIT 1
  `)[0];
  return { contract, side, billing: version ? billingOf(version) : null };
}

export async function handleTimesheetRoute(request: Request, env: Env, requestId: string, deps: TimesheetRouteDeps = defaultDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const byContract = path.match(/^\/api\/v1\/contracts\/([\w-]{1,64})\/(timesheets|time-entries|end)$/);
  const bySheet = path.match(/^\/api\/v1\/timesheets\/([\w-]{1,64})\/(submit|review|pay)$/);
  const byEntry = path.match(/^\/api\/v1\/time-entries\/([\w-]{1,64})\/delete$/);
  const known =
    (byContract && ((byContract[2] === "timesheets" && method === "GET") || (byContract[2] !== "timesheets" && method === "POST"))) ||
    (bySheet && method === "POST") ||
    (byEntry && method === "POST");
  if (!known) return null;

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);
  try {
    if (!(await tableExists(sql, "contract_timesheets"))) return failure("MIGRATION_PENDING", "Hourly contracts need database migration 0076.", 503, requestId);
    const now = deps.now();

    // Resolve the contract for every route shape.
    let contractId = byContract?.[1] ?? "";
    let sheet: SheetRow | undefined;
    let entry: (EntryRow & { contract_id: string }) | undefined;
    if (bySheet) {
      sheet = (await sql<SheetRow[]>`SELECT * FROM contract_timesheets WHERE id = ${bySheet[1]} LIMIT 1`)[0];
      if (!sheet) return failure("NOT_FOUND", "Week not found", 404, requestId);
      contractId = sheet.contract_id;
    }
    if (byEntry) {
      entry = (await sql<Array<EntryRow & { contract_id: string }>>`SELECT * FROM contract_time_entries WHERE id = ${byEntry[1]} LIMIT 1`)[0];
      if (!entry) return failure("NOT_FOUND", "Time entry not found", 404, requestId);
      contractId = entry.contract_id;
    }
    const ctx = await contractSide(sql, userId, contractId);
    if (!ctx) return failure("NOT_FOUND", "Contract not found", 404, requestId);
    const { contract, side, billing } = ctx;
    if (!billing) return failure("NOT_HOURLY", "This contract is fixed price: it is paid by milestones.", 409, requestId);
    const freelancerOnly = () => (side.party === "freelancer" ? null : failure("FORBIDDEN", "Only the freelancer logs and submits hours.", 403, requestId));
    const clientManager = () => (side.party === "client" && side.canManage ? null : failure("FORBIDDEN", "Owners and admins of the client account approve and pay hours.", 403, requestId));

    /* ---------------- list ---------------- */
    if (byContract?.[2] === "timesheets") {
      const sheets = await sql<SheetRow[]>`
        SELECT * FROM contract_timesheets WHERE contract_id = ${contract.id} ORDER BY week_start DESC LIMIT ${WEEKS_SHOWN}
      `;
      const ids = sheets.map((s) => s.id);
      const entries = ids.length
        ? await sql<EntryRow[]>`SELECT * FROM contract_time_entries WHERE contract_id = ${contract.id} ORDER BY work_date ASC, created_at ASC LIMIT 1000`
        : [];
      const payments = ids.length
        ? await sql<IntentRow[]>`SELECT * FROM payment_intents WHERE contract_id = ${contract.id} AND timesheet_id IS NOT NULL AND status IN ('created', 'funded', 'released') ORDER BY created_at DESC`
        : [];
      const thisWeek = weekStart(now);
      const current = sheets.find((s) => day(s.week_start) === thisWeek);
      return success(
        {
          billing,
          party: side.party,
          can_log: side.party === "freelancer" && contract.status === "active",
          can_decide: side.party === "client" && side.canManage,
          can_end: contract.status === "active" && side.canManage,
          contract_status: contract.status,
          this_week: thisWeek,
          limit_minutes: billing.weekly_limit_hours * 60,
          this_week_minutes: current ? Number(current.minutes) : 0,
          weeks: sheets.map((s) => sheetOut(s, entries, payments.find((p) => p.timesheet_id === s.id))),
          note: "Hours are paid per approved week. Amounts are minutes × the agreed rate; test mode until live payments open."
        },
        "Hours", 200, requestId
      );
    }

    /* ---------------- log time ---------------- */
    if (byContract?.[2] === "time-entries") {
      const denied = freelancerOnly();
      if (denied) return denied;
      if (contract.status !== "active") return failure("CONTRACT_NOT_ACTIVE", "Hours can only be logged on an active contract.", 409, requestId);
      const v = validateEntry((await body(request)) ?? {}, { today: now, activatedAt: contract.activated_at });
      if (!v.ok) return failure("INVALID_ENTRY", "Check the highlighted fields.", 422, requestId, [v.errors]);
      const limit = billing.weekly_limit_hours * 60;
      const result = await sql.begin(async (tx) => {
        await tx`
          INSERT INTO contract_timesheets (id, contract_id, week_start, status, minutes, rate_minor, created_at, updated_at)
          VALUES (${crypto.randomUUID()}, ${contract.id}, ${v.value.week_start}, 'open', 0, ${billing.hourly_rate_minor}, now(), now())
          ON CONFLICT (contract_id, week_start) DO NOTHING
        `;
        const s = (await tx<SheetRow[]>`SELECT * FROM contract_timesheets WHERE contract_id = ${contract.id} AND week_start = ${v.value.week_start} FOR UPDATE`)[0];
        if (s.status !== "open") return { code: "CLOSED" as const };
        if (Number(s.minutes) + v.value.minutes > limit) return { code: "LIMIT" as const, left: limit - Number(s.minutes) };
        const id = crypto.randomUUID();
        await tx`
          INSERT INTO contract_time_entries (id, contract_id, timesheet_id, work_date, minutes, description, created_by, created_at)
          VALUES (${id}, ${contract.id}, ${s.id}, ${v.value.work_date}, ${v.value.minutes}, ${v.value.description}, ${userId}, now())
        `;
        // The week's rate follows the agreed terms until the week is submitted.
        await tx`UPDATE contract_timesheets SET minutes = minutes + ${v.value.minutes}, rate_minor = ${billing.hourly_rate_minor}, updated_at = now() WHERE id = ${s.id}`;
        return { code: "OK" as const, id, minutes: Number(s.minutes) + v.value.minutes };
      });
      if (result.code === "CLOSED") return failure("WEEK_CLOSED", "That week was already submitted. Ask the client to return it to add time.", 409, requestId);
      if (result.code === "LIMIT") {
        const left = Math.max(0, result.left);
        return failure("WEEKLY_LIMIT", `That would go over the weekly limit of ${billing.weekly_limit_hours} hours (${Math.floor(left / 60)} h ${left % 60} min left this week).`, 409, requestId);
      }
      return success({ id: result.id, week_start: v.value.week_start, week_minutes: result.minutes }, "Time logged", 201, requestId);
    }

    /* ---------------- delete an entry ---------------- */
    if (byEntry && entry) {
      const denied = freelancerOnly();
      if (denied) return denied;
      const done = await sql.begin(async (tx) => {
        const s = (await tx<SheetRow[]>`SELECT * FROM contract_timesheets WHERE id = ${entry!.timesheet_id} FOR UPDATE`)[0];
        if (!s || s.status !== "open") return false;
        const gone = await tx<{ minutes: number }[]>`DELETE FROM contract_time_entries WHERE id = ${entry!.id} RETURNING minutes`;
        if (gone[0]) await tx`UPDATE contract_timesheets SET minutes = GREATEST(0, minutes - ${Number(gone[0].minutes)}), updated_at = now() WHERE id = ${s.id}`;
        return true;
      });
      if (!done) return failure("WEEK_CLOSED", "That week was already submitted.", 409, requestId);
      return success({ id: entry.id }, "Time entry removed", 200, requestId);
    }

    /* ---------------- end the contract ---------------- */
    if (byContract?.[2] === "end") {
      if (!side.canManage) return failure("FORBIDDEN", "Owners and admins of the client account, or the freelancer, end the contract.", 403, requestId);
      const ended = await sql.begin(async (tx) => {
        const rows = await tx<{ id: string }[]>`
          UPDATE contracts SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = ${contract.id} AND status = 'active' RETURNING id
        `;
        if (!rows[0]) return false;
        await recordContractEvent(tx, contract.id, userId, side.party, "contract.ended", { by: side.party });
        return true;
      });
      if (!ended) return failure("CONTRACT_NOT_ACTIVE", "Only an active contract can be ended.", 409, requestId);
      return success({ status: "completed" }, "Contract ended. Submitted weeks can still be approved and paid, and both sides can leave a review.", 200, requestId);
    }

    if (!sheet || !bySheet) return null;
    const action = bySheet[2];

    /* ---------------- submit a week ---------------- */
    if (action === "submit") {
      const denied = freelancerOnly();
      if (denied) return denied;
      const result = await sql.begin(async (tx) => {
        const s = (await tx<SheetRow[]>`SELECT * FROM contract_timesheets WHERE id = ${sheet!.id} FOR UPDATE`)[0];
        if (s.status !== "open") return { code: "CLOSED" as const };
        if (Number(s.minutes) < 1) return { code: "EMPTY" as const };
        const amount = amountFor(Number(s.minutes), Number(s.rate_minor));
        await tx`
          UPDATE contract_timesheets SET status = 'submitted', amount_minor = ${amount}, submitted_at = now(), client_note = '', updated_at = now() WHERE id = ${s.id}
        `;
        await recordContractEvent(tx, contract.id, userId, "freelancer", "timesheet.submitted", { week_start: day(s.week_start), minutes: Number(s.minutes), amount_minor: amount });
        return { code: "OK" as const, amount };
      });
      if (result.code === "CLOSED") return failure("WEEK_CLOSED", "This week was already submitted.", 409, requestId);
      if (result.code === "EMPTY") return failure("NOTHING_LOGGED", "Log some time before submitting the week.", 422, requestId);
      return success({ id: sheet.id, status: "submitted", amount_minor: result.amount }, "Submitted for the client's approval", 200, requestId);
    }

    /* ---------------- approve or return ---------------- */
    if (action === "review") {
      const denied = clientManager();
      if (denied) return denied;
      const payload = (await body(request)) ?? {};
      const decision = payload.decision;
      const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 1000) : "";
      if (decision !== "approve" && decision !== "return") return failure("INVALID_REQUEST", "decision must be approve or return.", 422, requestId);
      if (decision === "return" && note.length < 3) return failure("NOTE_REQUIRED", "Tell the freelancer what to correct.", 422, requestId);
      const done = await sql.begin(async (tx) => {
        const s = (await tx<SheetRow[]>`SELECT * FROM contract_timesheets WHERE id = ${sheet!.id} FOR UPDATE`)[0];
        if (s.status !== "submitted") return false;
        if (decision === "approve") {
          await tx`UPDATE contract_timesheets SET status = 'approved', decided_at = now(), decided_by = ${userId}, updated_at = now() WHERE id = ${s.id}`;
        } else {
          await tx`
            UPDATE contract_timesheets SET status = 'open', amount_minor = NULL, client_note = ${note}, decided_at = now(), decided_by = ${userId}, updated_at = now()
            WHERE id = ${s.id}
          `;
        }
        await recordContractEvent(tx, contract.id, userId, "client", decision === "approve" ? "timesheet.approved" : "timesheet.returned", {
          week_start: day(s.week_start), ...(decision === "return" ? { note } : { amount_minor: Number(s.amount_minor) })
        });
        return true;
      });
      if (!done) return failure("NOT_SUBMITTED", "This week is not waiting for approval.", 409, requestId);
      return success({ id: sheet.id, status: decision === "approve" ? "approved" : "open" }, decision === "approve" ? "Approved. Pay it when you are ready." : "Returned to the freelancer with your note.", 200, requestId);
    }

    /* ---------------- pay an approved week ---------------- */
    const denied = clientManager();
    if (denied) return denied;
    const header = request.headers.get("Idempotency-Key");
    const payload = (await body(request)) ?? {};
    const key = header ?? (typeof payload.idempotency_key === "string" ? payload.idempotency_key : "");
    if (!/^[\w.:-]{8,100}$/.test(key)) return failure("INVALID_REQUEST", "Send an Idempotency-Key (8–100 characters).", 422, requestId);
    const result = await createTimesheetFunding(env, sql, { contract, sheet, userId, idempotencyKey: key });
    if (!result.ok) return failure(result.code, result.message, 409, requestId);
    return success({ payment: intentOut(result.intent), checkout: result.checkout }, result.duplicate ? "Existing checkout" : "Checkout created", result.duplicate ? 200 : 201, requestId);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

