import type { Queryable, Sql } from "./core-routes";
import { recordContractEvent } from "./contract-events";
import { notifyUsers, organizationManagers } from "./notify";

/**
 * Deadlines when someone stops answering (U29, founder decisions 2026-11-20, D-26 to D-29):
 * - service-order deliveries complete automatically 3 days after delivery (the client can
 *   extend by 5 days, at most twice); fixed-price project milestones keep no deadline (D-25);
 * - a milestone is late after its due date; 24 hours later the client may cancel alone and
 *   get every funded, unreleased amount back;
 * - a cancellation request not answered within 48 hours counts as accepted;
 * - the other side has 7 days to answer a dispute; staff decide once they answer or the
 *   7 days pass (money still moves only by an admin decision).
 * Pure rules first (tested), then the 6-hourly jobs that apply them. No AI anywhere.
 */

export const SERVICE_REVIEW_DAYS = 3;
export const REVIEW_EXTENSION_DAYS = 5;
export const MAX_REVIEW_EXTENSIONS = 2;
export const LATE_CANCEL_GRACE_HOURS = 24;
export const CANCELLATION_REPLY_HOURS = 48;
export const DISPUTE_REPLY_DAYS = 7;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (d: Date | string) => new Date(d).getTime();

/** When a service-order delivery completes automatically. Pure. */
export function serviceReviewDeadline(submittedAt: Date | string, extensions: number): Date {
  const n = Math.max(0, Math.min(MAX_REVIEW_EXTENSIONS, Math.floor(Number(extensions) || 0)));
  return new Date(at(submittedAt) + (SERVICE_REVIEW_DAYS + n * REVIEW_EXTENSION_DAYS) * DAY);
}

/** End of a due date (YYYY-MM-DD) in UTC, or null when there is no valid date. Pure. */
export function dueEnd(dueDate: string | null | undefined): Date | null {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return null;
  const d = new Date(`${dueDate}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type MilestoneState = "not_started" | "submitted" | "revision_requested" | "approved" | string;

/**
 * Whether a milestone is late: its due date has passed and the client is not holding
 * a delivery for review (a waiting delivery is the client's turn, not lateness). Pure.
 */
export function isLate(milestone: { due_date?: string | null; state: MilestoneState }, now: Date): boolean {
  if (milestone.state === "approved" || milestone.state === "submitted") return false;
  const end = dueEnd(milestone.due_date ?? null);
  return Boolean(end) && now.getTime() > end!.getTime();
}

/** The client may cancel alone once any milestone has been late for 24 hours. Pure. */
export function lateCancelAllowed(milestones: Array<{ due_date?: string | null; state: MilestoneState }>, now: Date): boolean {
  return milestones.some((m) => {
    if (!isLate(m, now)) return false;
    return now.getTime() - dueEnd(m.due_date ?? null)!.getTime() >= LATE_CANCEL_GRACE_HOURS * HOUR;
  });
}

/** When an open cancellation request counts as accepted. Pure. */
export function cancellationDeadline(createdAt: Date | string): Date {
  return new Date(at(createdAt) + CANCELLATION_REPLY_HOURS * HOUR);
}

/** Reply window of a dispute: the other side answers within 7 days; then staff may decide. Pure. */
export function disputeReply(
  dispute: { opened_by_party: string; created_at: Date | string },
  statements: Array<{ party: string }>,
  now: Date
): { respond_by: string; replied: boolean; ready_for_decision: boolean } {
  const respondBy = new Date(at(dispute.created_at) + DISPUTE_REPLY_DAYS * DAY);
  const replied = statements.some((s) => s.party !== dispute.opened_by_party);
  return { respond_by: respondBy.toISOString(), replied, ready_for_decision: replied || now.getTime() >= respondBy.getTime() };
}

/* ------------------------------------------------------------------ */
/* Scheduled jobs (6-hourly cron)                                      */
/* ------------------------------------------------------------------ */

export type DecideFn = (sql: Sql, contractId: string, index: number) => Promise<{ approved: boolean; completed: boolean }>;
export type ReleaseFn = (sql: Sql, contractId: string, index: number) => Promise<string>;
export type AcceptCancellationFn = (sql: Sql, contractId: string, cancellationId: string) => Promise<{ cancelled: boolean; refunded: number }>;

/**
 * Completes service-order deliveries the client left unanswered past their deadline, the
 * same way as the client's own Approve (funded amount released), and reminds the client a
 * day before. Each step is idempotent: approval only of a delivery still waiting; reminders
 * deduplicated per delivery.
 */
export async function autoCompleteServiceDeliveries(sql: Sql, now: Date, decide: DecideFn, release: ReleaseFn): Promise<{ completed: number; reminded: number }> {
  const rows = await sql<{ id: string; contract_id: string; milestone_index: number; submitted_at: Date; review_extensions: number; organization_id: string }[]>`
    SELECT s.id, s.contract_id, s.milestone_index, s.submitted_at, s.review_extensions, c.organization_id
    FROM milestone_submissions s
    JOIN contracts c ON c.id = s.contract_id
    JOIN service_orders o ON o.contract_id = c.id
    WHERE s.status = 'submitted' AND c.status = 'active'
    ORDER BY s.submitted_at ASC
    LIMIT 200
  `.catch(() => []);
  let completed = 0;
  let reminded = 0;
  for (const r of rows) {
    const deadline = serviceReviewDeadline(r.submitted_at, r.review_extensions);
    const left = deadline.getTime() - now.getTime();
    if (left <= 0) {
      const result = await decide(sql, r.contract_id, Number(r.milestone_index));
      if (!result.approved) continue;
      completed += 1;
      try {
        await release(sql, r.contract_id, Number(r.milestone_index));
      } catch (error) {
        // The 6-hourly release retry picks it up (approved and funded).
        console.warn(JSON.stringify({ service: "freelance-income-ai-api-edge", event: "deadlines.release_failed", contract_id: r.contract_id, error: error instanceof Error ? error.message : "unknown" }));
      }
    } else if (left <= DAY) {
      await notifyUsers(sql, await organizationManagers(sql, r.organization_id), {
        kind: "milestone.review_reminder",
        title: "A delivery completes automatically within a day",
        message: "Review it, ask for a revision, or extend the review by 5 days. If you do nothing, it is approved and the freelancer is paid.",
        link: `/contracts#${r.contract_id}`,
        dedupe: `review-reminder:${r.id}:${r.review_extensions}`
      });
      reminded += 1;
    }
  }
  return { completed, reminded };
}

/** Accepts cancellation requests the other side left unanswered for 48 hours (refunds as in a manual acceptance). */
export async function expireCancellationRequests(sql: Sql, now: Date, accept: AcceptCancellationFn): Promise<number> {
  const cutoff = new Date(now.getTime() - CANCELLATION_REPLY_HOURS * HOUR);
  const rows = await sql<{ id: string; contract_id: string }[]>`
    SELECT k.id, k.contract_id FROM contract_cancellations k JOIN contracts c ON c.id = k.contract_id
    WHERE k.status = 'open' AND c.status = 'active' AND k.created_at <= ${cutoff.toISOString()}
    ORDER BY k.created_at ASC LIMIT 200
  `.catch(() => []);
  let done = 0;
  for (const r of rows) if ((await accept(sql, r.contract_id, r.id)).cancelled) done += 1;
  return done;
}

/**
 * Dispute reply window: reminds the side that has not answered two days before the
 * deadline, and tells staff once a dispute is ready for a decision (deduplicated).
 */
export async function runDisputeDeadlines(sql: Sql, now: Date): Promise<{ reminded: number; ready: number }> {
  const disputes = await sql<{ id: string; contract_id: string; opened_by_party: string; created_at: Date; freelancer_user_id: string; organization_id: string; replied: boolean }[]>`
    SELECT d.id, d.contract_id, d.opened_by_party, d.created_at, c.freelancer_user_id, c.organization_id,
           EXISTS (SELECT 1 FROM dispute_statements s WHERE s.dispute_id = d.id AND s.party <> d.opened_by_party) AS replied
    FROM disputes d JOIN contracts c ON c.id = d.contract_id
    WHERE d.status = 'open'
    ORDER BY d.created_at ASC LIMIT 200
  `.catch(() => []);
  let reminded = 0;
  let ready = 0;
  for (const d of disputes) {
    const due = at(d.created_at) + DISPUTE_REPLY_DAYS * DAY;
    if (!d.replied && now.getTime() < due && due - now.getTime() <= 2 * DAY) {
      const other = d.opened_by_party === "client" ? [d.freelancer_user_id] : await organizationManagers(sql, d.organization_id);
      await notifyUsers(sql, other, {
        kind: "dispute.reply_reminder",
        title: "Answer the dispute within 2 days",
        message: "Add your side before the deadline. After it, staff decide with what is on file.",
        link: `/contracts#${d.contract_id}`,
        dedupe: `dispute-reminder:${d.id}`
      });
      reminded += 1;
    }
    if (d.replied || now.getTime() >= due) {
      const staff = (await sql<{ user_id: string }[]>`
        SELECT DISTINCT user_id FROM user_roles WHERE role IN ('admin', 'moderator') AND status = 'active'
      `.catch(() => [])).map((r) => r.user_id);
      await notifyUsers(sql, staff, {
        kind: "dispute.ready",
        title: "A dispute is ready for a decision",
        message: d.replied ? "Both sides have stated their case." : "The reply window ended without an answer; decide with what is on file.",
        link: "/admin#disputes-heading",
        dedupe: `dispute-ready:${d.id}`
      });
      ready += 1;
    }
  }
  return { reminded, ready };
}

/** Records on a contract that a deadline acted (both parties are told). */
export async function recordDeadlineEvent(sql: Queryable, contractId: string, eventType: string, details: Record<string, unknown>): Promise<void> {
  await recordContractEvent(sql, contractId, null, "system", eventType, details);
}
