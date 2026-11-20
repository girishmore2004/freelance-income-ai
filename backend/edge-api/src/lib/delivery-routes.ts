import type { Env } from "../types";
import { recordTrustSignal } from "./agent-complete-routes";
import { notifyUsers, organizationManagers } from "./notify";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { FLAGS, isEnabled } from "./flags";
import { canManageOrganization, organizationForMember } from "./identity";
import { screenText } from "./listings";
import { contractVersionOut } from "./contracts";
import type { ContractRow, ContractVersionRow, Party } from "./contracts";
import { recordContractEvent } from "./contract-events";
import { releaseMilestone } from "./payments";
import { attachFilesToSubmission, filesBySubmission } from "./file-routes";
import { MAX_REVIEW_EXTENSIONS, REVIEW_EXTENSION_DAYS, isLate, lateCancelAllowed, serviceReviewDeadline } from "./deadlines";

/**
 * Shared delivery workspace (Phase 3 batch 2), for the two parties of a contract:
 *
 *   GET  /api/v1/contracts/{id}/workspace                      milestones + states, messages, activity
 *   POST /api/v1/contracts/{id}/messages {body}                either party (offered or active)
 *   POST /api/v1/contracts/{id}/milestones/{i}/submit {note, links[]}      freelancer, active contract
 *   POST /api/v1/contracts/{id}/milestones/{i}/review {decision, note}     client owner/admin
 *
 * Milestone state = its latest submission: pending → submitted → approved, or
 * revision_requested → submitted again. Revision requests per milestone are
 * limited to the contract's agreed revision rounds. When every milestone is
 * approved the contract is completed. Approval records acceptance of the work
 * only: no money moves (payments are BLOCKED on D-1/D-2).
 */

export interface DeliveryRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
  /** Clock for deadlines (tests); defaults to now. */
  now?: () => Date;
}

const defaultDeps: DeliveryRouteDeps = { database, authenticate: authenticateRequest };

const MAX_MESSAGE = 5000;
const MAX_NOTE = 5000;
const MAX_LINKS = 10;
const NO_FUNDS = "Approval records that the work is accepted. No payment was released because this milestone was not funded.";
const RELEASED = "The milestone's funds were released to the freelancer.";

interface SubmissionRow {
  id: string;
  milestone_index: number;
  contract_version: number;
  status: string;
  note: string;
  links_json: string;
  submitted_at: Date;
  reviewed_at: Date | null;
  review_note: string;
}

export type MilestoneState = "pending" | "submitted" | "approved" | "revision_requested";

export interface MilestoneView {
  index: number;
  title: string;
  amount_minor: number;
  due_date: string | null;
  state: MilestoneState;
  revisions_used: number;
  submissions: Array<{ id: string; status: string; note: string; links: string[]; submitted_at: string; reviewed_at: string | null; review_note: string; files: Array<{ id: string; filename: string; size_bytes: number }> }>;
}

function parseLinks(value: string): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Pure: combines agreed milestones with submissions (newest first per milestone). */
export function milestoneViews(
  milestones: Array<{ title: string; amount_minor: number; due_date: string | null }>,
  submissions: SubmissionRow[],
  files: Map<string, Array<{ id: string; filename: string; size_bytes: number }>> = new Map()
): MilestoneView[] {
  return milestones.map((m, index) => {
    const mine = submissions
      .filter((s) => s.milestone_index === index)
      .sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime());
    return {
      index,
      title: m.title,
      amount_minor: Number(m.amount_minor),
      due_date: m.due_date ?? null,
      state: (mine[0]?.status as MilestoneState | undefined) ?? "pending",
      revisions_used: mine.filter((s) => s.status === "revision_requested").length,
      submissions: mine.map((s) => ({
        id: s.id,
        status: s.status,
        note: s.note,
        links: parseLinks(s.links_json),
        submitted_at: new Date(s.submitted_at).toISOString(),
        reviewed_at: s.reviewed_at ? new Date(s.reviewed_at).toISOString() : null,
        review_note: s.review_note,
        files: files.get(s.id) ?? []
      }))
    };
  });
}

/** Only absolute https links, at most MAX_LINKS, each ≤ 500 characters. */
export function validateLinks(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_LINKS) return null;
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string" || raw.length > 500) return null;
    try {
      const url = new URL(raw.trim());
      if (url.protocol !== "https:" || !url.hostname.includes(".")) return null;
      out.push(url.toString());
    } catch {
      return null;
    }
  }
  return out;
}

async function sideOf(sql: Queryable, userId: string, contract: ContractRow): Promise<{ party: Party; canManage: boolean } | null> {
  if (contract.freelancer_user_id === userId) return { party: "freelancer", canManage: true };
  const org = await organizationForMember(sql, userId, contract.organization_id);
  return org ? { party: "client", canManage: canManageOrganization(org.membership_role) } : null;
}

async function agreedTerms(sql: Queryable, contract: ContractRow): Promise<ContractVersionRow | null> {
  return (
    (await sql<ContractVersionRow[]>`
      SELECT * FROM contract_versions WHERE contract_id = ${contract.id} AND version = ${contract.agreed_version ?? contract.current_version} LIMIT 1
    `)[0] ?? null
  );
}

export type DecisionResult =
  | { code: "OK"; completed: boolean }
  | { code: "CLOSED" }
  | { code: "NO_MILESTONE" }
  | { code: "NOTHING_TO_REVIEW" }
  | { code: "NO_REVISIONS_LEFT"; rounds: number };

/**
 * Decides the delivery waiting on a milestone, in one transaction: the client's Approve or
 * revision request, or the automatic completion of a service-order delivery (actor "system",
 * U29). Releasing the funded payment happens after commit (releaseMilestone).
 */
export async function decideSubmission(
  sql: Sql,
  contractId: string,
  index: number,
  decision: "approve" | "request_revision",
  note: string,
  actor: { userId: string | null; party: "client" | "system" }
): Promise<DecisionResult> {
  return sql.begin(async (tx) => {
    const locked = (await tx<ContractRow[]>`SELECT * FROM contracts WHERE id = ${contractId} FOR UPDATE`)[0];
    if (!locked || locked.status !== "active") return { code: "CLOSED" as const };
    const terms = await agreedTerms(tx, locked);
    const agreed = terms ? contractVersionOut(terms) : null;
    if (!agreed || index >= agreed.milestones.length) return { code: "NO_MILESTONE" as const };
    const open = (await tx<{ id: string }[]>`
      SELECT id FROM milestone_submissions WHERE contract_id = ${locked.id} AND milestone_index = ${index} AND status = 'submitted' LIMIT 1
    `)[0];
    if (!open) return { code: "NOTHING_TO_REVIEW" as const };
    if (decision === "request_revision") {
      const used = (await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM milestone_submissions
        WHERE contract_id = ${locked.id} AND milestone_index = ${index} AND status = 'revision_requested'
      `)[0]?.n ?? 0;
      if (used >= agreed.revision_rounds) return { code: "NO_REVISIONS_LEFT" as const, rounds: agreed.revision_rounds };
    }
    const status = decision === "approve" ? "approved" : "revision_requested";
    await tx`
      UPDATE milestone_submissions SET status = ${status}, reviewed_by = ${actor.userId}, reviewed_at = now(), review_note = ${note}
      WHERE id = ${open.id}
    `;
    await recordContractEvent(
      tx,
      locked.id,
      actor.userId,
      actor.party,
      actor.party === "system" ? "milestone.auto_completed" : decision === "approve" ? "milestone.approved" : "milestone.revision_requested",
      { milestone: index, title: agreed.milestones[index].title }
    );

    let completed = false;
    if (decision === "approve") {
      const approved = (await tx<{ milestone_index: number }[]>`
        SELECT DISTINCT milestone_index FROM milestone_submissions WHERE contract_id = ${locked.id} AND status = 'approved'
      `).map((r) => Number(r.milestone_index));
      completed = agreed.milestones.every((_, i) => approved.includes(i));
      if (completed) {
        await tx`UPDATE contracts SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = ${locked.id}`;
        await recordContractEvent(tx, locked.id, null, "system", "contract.completed", { total_minor: agreed.total_minor });
      }
    }
    if (!completed) await tx`UPDATE contracts SET updated_at = now() WHERE id = ${locked.id}`;
    return { code: "OK" as const, completed };
  });
}

export async function handleDeliveryRoute(
  request: Request,
  env: Env,
  requestId: string,
  deps: DeliveryRouteDeps = defaultDeps
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  const workspace = path.match(/^\/api\/v1\/contracts\/([\w-]{1,64})\/workspace$/);
  const messages = path.match(/^\/api\/v1\/contracts\/([\w-]{1,64})\/messages$/);
  const milestone = path.match(/^\/api\/v1\/contracts\/([\w-]{1,64})\/milestones\/(\d{1,2})\/(submit|review|extend-review)$/);

  const known = (workspace !== null && method === "GET") || (messages !== null && method === "POST") || (milestone !== null && method === "POST");
  if (!known) return null;

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);

  try {
    if (!(await isEnabled(env, sql, FLAGS.clientMarketplace, false))) {
      return failure("FEATURE_DISABLED", "The client marketplace is not open yet.", 403, requestId);
    }
    const contractId = (workspace ?? messages ?? milestone)![1];
    const contract = (await sql<ContractRow[]>`SELECT * FROM contracts WHERE id = ${contractId} LIMIT 1`)[0];
    const side = contract ? await sideOf(sql, userId, contract) : null;
    if (!contract || !side) return failure("NOT_FOUND", "Contract not found", 404, requestId);

    /* ---------------- workspace ---------------- */
    if (workspace) {
      const terms = await agreedTerms(sql, contract);
      if (!terms) return failure("NOT_FOUND", "Contract not found", 404, requestId);
      const agreed = contractVersionOut(terms);
      const submissions = await sql<SubmissionRow[]>`
        SELECT id, milestone_index, contract_version, status, note, links_json, submitted_at, reviewed_at, review_note
        FROM milestone_submissions WHERE contract_id = ${contract.id} ORDER BY submitted_at DESC LIMIT 400
      `;
      const thread = await sql<{ id: string; sender_party: string; sender_user_id: string | null; body: string; created_at: Date }[]>`
        SELECT id, sender_party, sender_user_id, body, created_at FROM contract_messages
        WHERE contract_id = ${contract.id} ORDER BY created_at DESC LIMIT 100
      `;
      const events = await sql<{ actor_party: string; event_type: string; details_json: string; created_at: Date }[]>`
        SELECT actor_party, event_type, details_json, created_at FROM contract_events
        WHERE contract_id = ${contract.id} ORDER BY created_at DESC LIMIT 50
      `;
      const baseViews = milestoneViews(agreed.milestones, submissions, await filesBySubmission(sql, contract.id));
      // U29: late milestones, and for service orders when a waiting delivery completes automatically.
      const serviceOrder = (await sql<{ id: string }[]>`SELECT id FROM service_orders WHERE contract_id = ${contract.id} LIMIT 1`.catch(() => []))[0] !== undefined;
      const extensions = serviceOrder
        ? new Map((await sql<{ id: string; review_extensions: number }[]>`
            SELECT id, review_extensions FROM milestone_submissions WHERE contract_id = ${contract.id} AND status = 'submitted'
          `.catch(() => [])).map((r) => [r.id, Number(r.review_extensions)]))
        : new Map<string, number>();
      const now = deps.now ? deps.now() : new Date();
      const views = baseViews.map((m) => {
        const open = m.state === "submitted" ? m.submissions[0] : undefined;
        const used = open ? extensions.get(open.id) ?? 0 : 0;
        return {
          ...m,
          late: contract.status === "active" && isLate(m, now),
          auto_complete_at: serviceOrder && open ? serviceReviewDeadline(open.submitted_at, used).toISOString() : null,
          review_extensions_left: serviceOrder && open ? Math.max(0, MAX_REVIEW_EXTENSIONS - used) : 0
        };
      });
      return success(
        {
          contract_id: contract.id,
          status: contract.status,
          party: side.party,
          can_manage: side.canManage,
          service_order: serviceOrder,
          late_cancel_allowed: contract.status === "active" && lateCancelAllowed(baseViews, now),
          revision_rounds: agreed.revision_rounds,
          currency: agreed.currency,
          milestones: views,
          approved_minor: views.filter((m) => m.state === "approved").reduce((sum, m) => sum + m.amount_minor, 0),
          total_minor: agreed.total_minor,
          messages: thread.reverse().map((m) => ({
            id: m.id,
            from: m.sender_party,
            mine: m.sender_user_id === userId,
            body: m.body,
            created_at: new Date(m.created_at).toISOString()
          })),
          activity: events.map((e) => {
            let details: Record<string, unknown> = {};
            try {
              details = JSON.parse(e.details_json || "{}") as Record<string, unknown>;
            } catch {
              details = {};
            }
            return { actor: e.actor_party, type: e.event_type, details, created_at: new Date(e.created_at).toISOString() };
          }),
          funding_note: "Approving a funded milestone releases its payment to the freelancer. Unfunded milestones are approved without payment."
        },
        "Workspace",
        200,
        requestId
      );
    }

    const payload = (await body(request)) ?? {};

    /* ---------------- messages ---------------- */
    if (messages) {
      if (!["offered", "active"].includes(contract.status)) return failure("CONTRACT_CLOSED", "Messages are closed for this contract.", 409, requestId);
      const text = typeof payload.body === "string" ? payload.body.trim() : "";
      if (!text) return failure("EMPTY_MESSAGE", "Write a message first.", 422, requestId);
      if (text.length > MAX_MESSAGE) return failure("MESSAGE_TOO_LONG", `Keep messages under ${MAX_MESSAGE} characters.`, 422, requestId);
      const findings = screenText(text);
      if (findings.length) {
        // P1: a refused attempt to share contact details or move payment is recorded for staff review.
        await recordTrustSignal(sql, userId, findings.map((f) => f.code), {
          type: "contract", id: contract.id, organization_id: contract.organization_id,
          counterpart_user_id: side.party === "client" ? contract.freelancer_user_id : null
        });
        return failure(
          "MESSAGE_NOT_ALLOWED",
          "Keep contact and payment on the platform: remove phone numbers, emails, messaging apps or payment requests.",
          422,
          requestId,
          [{ codes: findings.map((f) => f.code) }]
        );
      }
      const id = crypto.randomUUID();
      await sql`
        INSERT INTO contract_messages (id, contract_id, sender_user_id, sender_party, body, created_at)
        VALUES (${id}, ${contract.id}, ${userId}, ${side.party}, ${text}, now())
      `;
      const recipients = side.party === "client" ? [contract.freelancer_user_id] : await organizationManagers(sql, contract.organization_id);
      await notifyUsers(sql, recipients, { kind: "message.received", title: "New message on your contract", message: text.slice(0, 200), link: `/contracts#${contract.id}`, dedupe: `message:${id}` });
      return success({ id, from: side.party, mine: true, body: text }, "Message sent", 201, requestId);
    }

    /* ---------------- milestones ---------------- */
    const index = Number(milestone![2]);
    const step = milestone![3] as "submit" | "review" | "extend-review";
    if (contract.status !== "active") return failure("CONTRACT_NOT_ACTIVE", "Work can only be delivered on an active contract.", 409, requestId);

    /* U29: the client extends the review of a service-order delivery by 5 days (at most twice). */
    if (step === "extend-review") {
      if (side.party !== "client" || !side.canManage) return failure("FORBIDDEN", "Only owners and admins of the client account can extend the review.", 403, requestId);
      const serviceOrder = (await sql<{ id: string }[]>`SELECT id FROM service_orders WHERE contract_id = ${contract.id} LIMIT 1`.catch(() => []))[0];
      if (!serviceOrder) return failure("NOT_A_SERVICE_ORDER", "Only service orders complete automatically; project milestones wait for your review.", 409, requestId);
      const updated = await sql<{ review_extensions: number; submitted_at: Date }[]>`
        UPDATE milestone_submissions SET review_extensions = review_extensions + 1
        WHERE contract_id = ${contract.id} AND milestone_index = ${index} AND status = 'submitted' AND review_extensions < ${MAX_REVIEW_EXTENSIONS}
        RETURNING review_extensions, submitted_at
      `.catch(() => null);
      if (updated === null) return failure("MIGRATION_PENDING", "Extending reviews is available after the next database update.", 503, requestId);
      if (!updated[0]) {
        const waiting = (await sql<{ id: string }[]>`SELECT id FROM milestone_submissions WHERE contract_id = ${contract.id} AND milestone_index = ${index} AND status = 'submitted' LIMIT 1`)[0];
        return waiting
          ? failure("NO_EXTENSIONS_LEFT", `The review was already extended ${MAX_REVIEW_EXTENSIONS} times. Approve it or ask for a revision.`, 409, requestId)
          : failure("NOTHING_TO_REVIEW", "There is no delivery waiting for review on this milestone.", 409, requestId);
      }
      const until = serviceReviewDeadline(updated[0].submitted_at, Number(updated[0].review_extensions));
      await recordContractEvent(sql, contract.id, userId, "client", "milestone.review_extended", { milestone: index, until: until.toISOString() });
      return success(
        { milestone: index, auto_complete_at: until.toISOString(), review_extensions_left: MAX_REVIEW_EXTENSIONS - Number(updated[0].review_extensions) },
        `Review extended by ${REVIEW_EXTENSION_DAYS} days. It completes automatically on ${until.toISOString().slice(0, 10)} if you do nothing.`,
        200,
        requestId
      );
    }

    if (step === "submit") {
      if (side.party !== "freelancer") return failure("FORBIDDEN", "Only the freelancer delivers work.", 403, requestId);
      if (await isEnabled(env, sql, FLAGS.requireFunding, false)) {
        const funded = await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM payment_intents WHERE contract_id = ${contract.id} AND milestone_index = ${index} AND status IN ('funded', 'released')
        `;
        if ((funded[0]?.n ?? 0) === 0) {
          return failure("MILESTONE_NOT_FUNDED", "The client has not funded this milestone yet. Deliver once it is funded.", 409, requestId);
        }
      }
      const note = typeof payload.note === "string" ? payload.note.trim() : "";
      if (note.length < 10) return failure("INVALID_SUBMISSION", "Describe what you are delivering (at least 10 characters).", 422, requestId);
      if (note.length > MAX_NOTE) return failure("INVALID_SUBMISSION", `Keep the note under ${MAX_NOTE} characters.`, 422, requestId);
      const links = validateLinks(payload.links);
      if (!links) return failure("INVALID_LINKS", `Add up to ${MAX_LINKS} https links.`, 422, requestId);
      const fileIds = payload.file_ids === undefined ? [] : payload.file_ids;
      if (!Array.isArray(fileIds) || fileIds.length > 10 || !fileIds.every((f): f is string => typeof f === "string" && /^[\w-]{1,64}$/.test(f)) || new Set(fileIds).size !== fileIds.length) {
        return failure("INVALID_FILES", "Attach up to 10 uploaded files.", 422, requestId);
      }
      if (screenText(note).length) {
        return failure("MESSAGE_NOT_ALLOWED", "Keep contact and payment on the platform: remove phone numbers, emails, messaging apps or payment requests.", 422, requestId);
      }

      const result = await sql.begin(async (tx) => {
        const locked = (await tx<ContractRow[]>`SELECT * FROM contracts WHERE id = ${contract.id} FOR UPDATE`)[0];
        if (!locked || locked.status !== "active") return { code: "CLOSED" as const };
        const terms = await agreedTerms(tx, locked);
        const agreed = terms ? contractVersionOut(terms) : null;
        if (!agreed || index >= agreed.milestones.length) return { code: "NO_MILESTONE" as const };
        const latest = (await tx<{ status: string }[]>`
          SELECT status FROM milestone_submissions WHERE contract_id = ${locked.id} AND milestone_index = ${index}
          ORDER BY submitted_at DESC LIMIT 1
        `)[0];
        if (latest && latest.status !== "revision_requested") return { code: "WRONG_STATE" as const, state: latest.status };
        const submissionId = crypto.randomUUID();
        await tx`
          INSERT INTO milestone_submissions (id, contract_id, milestone_index, contract_version, status, note, links_json, submitted_by, submitted_at)
          VALUES (${submissionId}, ${locked.id}, ${index}, ${locked.agreed_version ?? locked.current_version}, 'submitted', ${note}, ${JSON.stringify(links)}, ${userId}, now())
        `;
        if (!(await attachFilesToSubmission(tx, locked.id, userId, submissionId, fileIds))) throw new FilesNotAttachable();
        await recordContractEvent(tx, locked.id, userId, "freelancer", "milestone.submitted", { milestone: index, title: agreed.milestones[index].title });
        await tx`UPDATE contracts SET updated_at = now() WHERE id = ${locked.id}`;
        return { code: "OK" as const };
      }).catch((error: unknown) => {
        if (error instanceof FilesNotAttachable) return { code: "FILES" as const };
        throw error;
      });
      if (result.code === "FILES") return failure("INVALID_FILES", "Some files are missing, were uploaded by someone else, or are already part of another delivery.", 422, requestId);
      if (result.code === "CLOSED") return failure("CONTRACT_NOT_ACTIVE", "Work can only be delivered on an active contract.", 409, requestId);
      if (result.code === "NO_MILESTONE") return failure("NOT_FOUND", "Milestone not found", 404, requestId);
      if (result.code === "WRONG_STATE") {
        return failure("MILESTONE_NOT_OPEN", result.state === "approved" ? "This milestone is already approved." : "This milestone is waiting for the client's review.", 409, requestId);
      }
      return success({ milestone: index, state: "submitted" }, "Delivered. The client will review it.", 201, requestId);
    }

    // review
    if (side.party !== "client") return failure("FORBIDDEN", "Only the client reviews deliveries.", 403, requestId);
    if (!side.canManage) return failure("FORBIDDEN", "Only owners and admins can approve work.", 403, requestId);
    const decision = payload.decision;
    if (decision !== "approve" && decision !== "request_revision") return failure("INVALID_DECISION", "Decision must be approve or request_revision.", 422, requestId);
    const verdict = decision as "approve" | "request_revision";
    const note = typeof payload.note === "string" ? payload.note.trim().slice(0, MAX_NOTE) : "";
    if (decision === "request_revision" && note.length < 10) {
      return failure("NOTE_REQUIRED", "Explain what needs to change (at least 10 characters).", 422, requestId);
    }

    const result = await decideSubmission(sql, contract.id, index, verdict, note, { userId, party: "client" });

    if (result.code === "CLOSED") return failure("CONTRACT_NOT_ACTIVE", "This contract is not active.", 409, requestId);
    if (result.code === "NO_MILESTONE") return failure("NOT_FOUND", "Milestone not found", 404, requestId);
    if (result.code === "NOTHING_TO_REVIEW") return failure("NOTHING_TO_REVIEW", "There is no delivery waiting for review on this milestone.", 409, requestId);
    if (result.code === "NO_REVISIONS_LEFT") {
      return failure(
        "NO_REVISIONS_LEFT",
        `The agreed revision rounds for this milestone (${result.rounds}) are used up. Approve it, or discuss next steps with the freelancer in messages.`,
        409,
        requestId
      );
    }
    let release = "not_funded";
    if (decision === "approve") {
      try {
        release = await releaseMilestone(sql, contract.id, index);
      } catch (error) {
        // The 6-hourly job retries releases of approved, funded milestones.
        console.error(JSON.stringify({ service: "freelance-income-ai-api-edge", event: "payments.release_failed", alert: true, contract_id: contract.id, milestone: index, error: error instanceof Error ? error.message : "unknown" }));
        release = "pending";
      }
    }
    const paymentNote = release === "released" || release === "already" ? RELEASED : release === "pending" ? "The payment release will be retried automatically." : NO_FUNDS;
    const message =
      decision === "request_revision"
        ? "Revision requested"
        : result.completed
          ? `All milestones approved. The contract is completed. ${paymentNote}`
          : `Milestone approved. ${paymentNote}`;
    return success({ milestone: index, state: decision === "approve" ? "approved" : "revision_requested", contract_completed: result.completed, payment: decision === "approve" ? release : null }, message, 200, requestId);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

class FilesNotAttachable extends Error {}
