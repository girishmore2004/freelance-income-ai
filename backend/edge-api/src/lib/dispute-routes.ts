import type { Env } from "../types";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { FLAGS, isEnabled } from "./flags";
import { canManageOrganization, loadRoles, organizationForMember } from "./identity";
import { screenText } from "./listings";
import { contractVersionOut } from "./contracts";
import type { ContractRow, ContractVersionRow, Party } from "./contracts";
import { recordContractEvent } from "./contract-events";
import { notifyUsers } from "./notify";
import { intentOut, refundIntent, releaseMilestone } from "./payments";
import type { IntentRow } from "./payments";

/**
 * Disputes, account suspension and appeals (Phase 7 batch 2; Master Plan 3.5:
 * "decide dispute" and "suspend" are human-only).
 *
 * Parties (client owners/admins, or the freelancer)
 *   GET  /api/v1/contracts/{id}/dispute                 latest dispute with statements
 *   POST /api/v1/contracts/{id}/dispute                 {reason, description, desired_outcome}
 *   POST /api/v1/disputes/{id}/statements               {body}
 *   POST /api/v1/disputes/{id}/withdraw                 the side that opened it
 * Staff (moderator or admin; others get 404)
 *   GET  /api/v1/admin/disputes?status=open|resolved|withdrawn
 *   GET  /api/v1/admin/disputes/{id}                    evidence pack (P3), assembled from the record
 *   POST /api/v1/admin/disputes/{id}/resolve            {resolution, note}; money-moving outcomes are admin-only
 *   GET  /api/v1/admin/suspensions?status=active|lifted
 *   POST /api/v1/admin/users/{id}/suspend               {reason}
 *   POST /api/v1/admin/suspensions/{id}/lift            {note}
 *   POST /api/v1/admin/suspensions/{id}/appeal          {decision: uphold|overturn, note}
 * The suspended user
 *   GET  /api/v1/me/suspension
 *   POST /api/v1/me/suspension/appeal                   {text}, once per suspension
 *
 * The evidence pack is deterministic: it gathers what the platform recorded.
 * No model reads it or proposes an outcome. Staff decide, and every decision
 * is written to the append-only `moderation_actions` log.
 */

export interface DisputeRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
}

const defaultDeps: DisputeRouteDeps = { database, authenticate: authenticateRequest };

export const DISPUTE_REASONS = ["quality", "non_delivery", "scope", "payment", "communication", "other"] as const;
export const DISPUTE_RESOLUTIONS = ["release_funded", "refund_funded", "no_action"] as const;
export type DisputeResolution = (typeof DISPUTE_RESOLUTIONS)[number];
const MAX_STATEMENTS_PER_PARTY = 20;

export interface DisputeRow {
  id: string;
  contract_id: string;
  opened_by_party: Party;
  opened_by: string | null;
  reason: string;
  description: string;
  desired_outcome: string;
  status: string;
  resolution: DisputeResolution | null;
  resolution_note: string;
  resolved_by: string | null;
  resolved_at: Date | null;
  created_at: Date;
}

interface StatementRow {
  id: string;
  dispute_id: string;
  party: Party;
  user_id: string | null;
  body: string;
  created_at: Date;
}

interface SuspensionRow {
  id: string;
  user_id: string;
  reason: string;
  status: string;
  created_by: string | null;
  created_at: Date;
  lifted_by: string | null;
  lifted_at: Date | null;
  lift_note: string;
  appeal_text: string;
  appeal_status: string;
  appeal_at: Date | null;
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

export function disputeOut(d: DisputeRow, statements: StatementRow[], viewer: Party | "staff") {
  return {
    id: d.id,
    contract_id: d.contract_id,
    opened_by: d.opened_by_party,
    mine: viewer !== "staff" && d.opened_by_party === viewer,
    reason: d.reason,
    description: d.description,
    desired_outcome: d.desired_outcome,
    status: d.status,
    resolution: d.resolution,
    resolution_note: d.resolution_note,
    resolved_at: iso(d.resolved_at),
    created_at: iso(d.created_at),
    statements: statements.map((s) => ({ id: s.id, party: s.party, body: s.body, created_at: iso(s.created_at) }))
  };
}

function suspensionOut(s: SuspensionRow) {
  return {
    id: s.id,
    user_id: s.user_id,
    reason: s.reason,
    status: s.status,
    created_at: iso(s.created_at),
    lifted_at: iso(s.lifted_at),
    lift_note: s.lift_note,
    appeal_text: s.appeal_text,
    appeal_status: s.appeal_status,
    appeal_at: iso(s.appeal_at)
  };
}

/** Validates a party's dispute. Pure; exported for tests. */
export function validateDispute(input: Record<string, unknown>): { ok: true; value: { reason: string; description: string; desired_outcome: string } } | { ok: false; errors: Record<string, string> } {
  const reason = input.reason;
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const desired = typeof input.desired_outcome === "string" ? input.desired_outcome.trim() : "";
  const errors: Record<string, string> = {};
  if (!DISPUTE_REASONS.includes(reason as never)) errors.reason = "Choose what the dispute is about.";
  if (description.length < 30 || description.length > 4000) errors.description = "Describe what happened (30–4,000 characters).";
  if (desired.length > 1000) errors.desired_outcome = "Keep the outcome you want under 1,000 characters.";
  if (!errors.description && screenText(description).length) errors.description = "Keep contact and payment details off the platform record.";
  if (!errors.desired_outcome && desired && screenText(desired).length) errors.desired_outcome = "Keep contact and payment details off the platform record.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { reason: reason as string, description, desired_outcome: desired } };
}

async function logAction(sql: Queryable, actor: string, targetType: string, targetId: string, action: string, note: string): Promise<void> {
  await sql`
    INSERT INTO moderation_actions (id, actor_user_id, target_type, target_id, action, note, created_at)
    VALUES (${crypto.randomUUID()}, ${actor}, ${targetType}, ${targetId}, ${action}, ${note.slice(0, 2000)}, now())
  `;
}

async function sideOf(sql: Queryable, userId: string, contract: ContractRow): Promise<{ party: Party; canManage: boolean } | null> {
  if (contract.freelancer_user_id === userId) return { party: "freelancer", canManage: true };
  const org = await organizationForMember(sql, userId, contract.organization_id);
  return org ? { party: "client", canManage: canManageOrganization(org.membership_role) } : null;
}

async function statementsFor(sql: Queryable, disputeId: string): Promise<StatementRow[]> {
  return sql<StatementRow[]>`SELECT * FROM dispute_statements WHERE dispute_id = ${disputeId} ORDER BY created_at ASC LIMIT 200`;
}

/**
 * Carries out a staff resolution. Idempotent: every money step is keyed per
 * payment and every status change is conditional, so running it again after
 * a partial failure completes the same outcome without moving money twice.
 */
export async function applyResolution(sql: Sql, dispute: DisputeRow, actorUserId: string): Promise<{ released: number; refunded: number }> {
  let released = 0;
  let refunded = 0;
  if (dispute.resolution === "release_funded") {
    const funded = await sql<{ milestone_index: number }[]>`
      SELECT DISTINCT milestone_index FROM payment_intents WHERE contract_id = ${dispute.contract_id} AND status = 'funded'
    `;
    for (const f of funded) {
      if ((await releaseMilestone(sql, dispute.contract_id, Number(f.milestone_index), { disputeId: dispute.id })) === "released") released += 1;
    }
    const done = await sql<{ id: string }[]>`
      UPDATE contracts SET status = 'completed', completed_at = COALESCE(completed_at, now()), updated_at = now()
      WHERE id = ${dispute.contract_id} AND status = 'active' RETURNING id
    `;
    if (done[0]) await recordContractEvent(sql, dispute.contract_id, actorUserId, "system", "contract.completed", { dispute_id: dispute.id });
  } else if (dispute.resolution === "refund_funded") {
    const open = await sql<IntentRow[]>`SELECT * FROM payment_intents WHERE contract_id = ${dispute.contract_id} AND status IN ('created', 'funded')`;
    for (const intent of open) if ((await refundIntent(sql, intent, `Dispute decision ${dispute.id}`)) === "refunded") refunded += 1;
    const done = await sql<{ id: string }[]>`
      UPDATE contracts SET status = 'cancelled', updated_at = now() WHERE id = ${dispute.contract_id} AND status = 'active' RETURNING id
    `;
    if (done[0]) await recordContractEvent(sql, dispute.contract_id, actorUserId, "system", "contract.cancelled", { dispute_id: dispute.id });
  }
  return { released, refunded };
}

/** Everything the platform recorded about a disputed contract (P3 evidence pack). */
export async function evidencePack(sql: Queryable, dispute: DisputeRow) {
  const contract = (await sql<ContractRow[]>`SELECT * FROM contracts WHERE id = ${dispute.contract_id} LIMIT 1`)[0];
  const versions = await sql<ContractVersionRow[]>`SELECT * FROM contract_versions WHERE contract_id = ${dispute.contract_id} ORDER BY version ASC`;
  const events = await sql<{ actor_party: string; event_type: string; details_json: unknown; created_at: Date }[]>`
    SELECT actor_party, event_type, details_json, created_at FROM contract_events WHERE contract_id = ${dispute.contract_id} ORDER BY created_at ASC LIMIT 500
  `;
  const submissions = await sql<{ milestone_index: number; contract_version: number; status: string; note: string; links_json: unknown; submitted_at: Date; reviewed_at: Date | null; review_note: string | null }[]>`
    SELECT milestone_index, contract_version, status, note, links_json, submitted_at, reviewed_at, review_note
    FROM milestone_submissions WHERE contract_id = ${dispute.contract_id} ORDER BY submitted_at ASC LIMIT 200
  `;
  const messages = await sql<{ sender_party: string; body: string; created_at: Date }[]>`
    SELECT sender_party, body, created_at FROM contract_messages WHERE contract_id = ${dispute.contract_id} ORDER BY created_at ASC LIMIT 500
  `;
  const payments = await sql<IntentRow[]>`SELECT * FROM payment_intents WHERE contract_id = ${dispute.contract_id} ORDER BY created_at ASC`;
  const cancellations = await sql<{ requested_by_party: string; reason: string; status: string; created_at: Date }[]>`
    SELECT requested_by_party, reason, status, created_at FROM contract_cancellations WHERE contract_id = ${dispute.contract_id} ORDER BY created_at ASC
  `;
  let files: Array<{ id: string; party: string; filename: string; size_bytes: number; submission_id: string | null; created_at: string | null }> = [];
  try {
    files = (await sql<{ id: string; party: string; filename: string; size_bytes: string | number; submission_id: string | null; created_at: Date }[]>`
      SELECT id, party, filename, size_bytes, submission_id, created_at FROM contract_files WHERE contract_id = ${dispute.contract_id} AND status = 'ready' ORDER BY created_at ASC LIMIT 200
    `).map((f) => ({ id: f.id, party: f.party, filename: f.filename, size_bytes: Number(f.size_bytes), submission_id: f.submission_id, created_at: iso(f.created_at) }));
  } catch {
    // Migration 0065 not applied yet.
  }
  const previous = await sql<DisputeRow[]>`
    SELECT * FROM disputes WHERE contract_id = ${dispute.contract_id} AND id <> ${dispute.id} ORDER BY created_at ASC
  `;
  const parse = (v: unknown) => (typeof v === "string" ? (JSON.parse(v) as unknown) : v);
  const agreed = versions.find((v) => v.version === (contract?.agreed_version ?? contract?.current_version));
  const agreedTerms = agreed ? contractVersionOut(agreed) : null;
  const funded = payments.filter((p) => p.status === "funded");
  const approvedIndexes = new Set(submissions.filter((s) => s.status === "approved").map((s) => s.milestone_index));
  return {
    contract: contract
      ? { id: contract.id, status: contract.status, agreed_version: contract.agreed_version ?? null, activated_at: iso(contract.activated_at), completed_at: iso(contract.completed_at ?? null) }
      : null,
    agreed_terms: agreedTerms,
    versions: versions.map(contractVersionOut),
    submissions: submissions.map((s) => ({ ...s, links: parse(s.links_json), links_json: undefined, submitted_at: iso(s.submitted_at), reviewed_at: iso(s.reviewed_at) })),
    messages: messages.map((m) => ({ party: m.sender_party, body: m.body, created_at: iso(m.created_at) })),
    events: events.map((e) => ({ party: e.actor_party, type: e.event_type, details: parse(e.details_json), created_at: iso(e.created_at) })),
    payments: payments.map(intentOut),
    files,
    cancellations: cancellations.map((c) => ({ ...c, created_at: iso(c.created_at) })),
    previous_disputes: previous.map((d) => ({ id: d.id, status: d.status, resolution: d.resolution, created_at: iso(d.created_at) })),
    summary: {
      milestones: agreedTerms?.milestones.length ?? 0,
      milestones_approved: approvedIndexes.size,
      funded_unreleased_minor: funded.reduce((sum, p) => sum + Number(p.amount_minor), 0),
      funded_unreleased_count: funded.length,
      submissions: submissions.length,
      messages: messages.length
    }
  };
}

export async function handleDisputeRoute(request: Request, env: Env, requestId: string, deps: DisputeRouteDeps = defaultDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const contractDispute = path.match(/^\/api\/v1\/contracts\/([\w-]{1,64})\/dispute$/);
  const partyAction = path.match(/^\/api\/v1\/disputes\/([\w-]{1,64})\/(statements|withdraw)$/);
  const adminDispute = path.match(/^\/api\/v1\/admin\/disputes\/([\w-]{1,64})(?:\/(resolve))?$/);
  const suspendUser = path.match(/^\/api\/v1\/admin\/users\/([\w-]{1,64})\/suspend$/);
  const suspensionAction = path.match(/^\/api\/v1\/admin\/suspensions\/([\w-]{1,64})\/(lift|appeal)$/);
  const known =
    (method === "GET" && (contractDispute !== null || path === "/api/v1/admin/disputes" || (adminDispute !== null && !adminDispute[2]) || path === "/api/v1/admin/suspensions" || path === "/api/v1/me/suspension")) ||
    (method === "POST" && (contractDispute !== null || partyAction !== null || (adminDispute !== null && adminDispute[2] === "resolve") || suspendUser !== null || suspensionAction !== null || path === "/api/v1/me/suspension/appeal"));
  if (!known) return null;

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);

  try {
    /* ---------------- the suspended user ---------------- */
    if (path === "/api/v1/me/suspension") {
      const row = (await sql<SuspensionRow[]>`
        SELECT * FROM account_suspensions WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 1
      `)[0];
      const active = row && row.status === "active" ? row : null;
      return success(
        { suspended: Boolean(active), suspension: row ? suspensionOut(row) : null, can_appeal: Boolean(active && active.appeal_status === "none") },
        active ? "Your account is suspended" : "Your account is in good standing",
        200,
        requestId
      );
    }

    if (path === "/api/v1/me/suspension/appeal") {
      const payload = (await body(request)) ?? {};
      const text = typeof payload.text === "string" ? payload.text.trim() : "";
      if (text.length < 30 || text.length > 4000) return failure("APPEAL_TEXT_REQUIRED", "Explain why the suspension should be lifted (30–4,000 characters).", 422, requestId);
      const rows = await sql<SuspensionRow[]>`
        UPDATE account_suspensions SET appeal_text = ${text}, appeal_status = 'pending', appeal_at = now()
        WHERE user_id = ${userId} AND status = 'active' AND appeal_status = 'none'
        RETURNING *
      `;
      if (!rows[0]) return failure("CANNOT_APPEAL", "There is no active suspension you can appeal, or you already appealed.", 409, requestId);
      console.warn(JSON.stringify({ service: "freelance-income-ai-api-edge", event: "trust.appeal_submitted", alert: true, suspension_id: rows[0].id }));
      return success(suspensionOut(rows[0]), "Appeal submitted. A staff member will review it.", 201, requestId);
    }

    /* ---------------- parties ---------------- */
    if (contractDispute || partyAction) {
      if (!(await isEnabled(env, sql, FLAGS.clientMarketplace, false))) return failure("NOT_FOUND", "Not found", 404, requestId);
      let dispute: DisputeRow | undefined;
      let contractId: string;
      if (partyAction) {
        dispute = (await sql<DisputeRow[]>`SELECT * FROM disputes WHERE id = ${partyAction[1]} LIMIT 1`)[0];
        if (!dispute) return failure("NOT_FOUND", "Dispute not found", 404, requestId);
        contractId = dispute.contract_id;
      } else {
        contractId = contractDispute![1];
      }
      const contract = (await sql<ContractRow[]>`SELECT * FROM contracts WHERE id = ${contractId} LIMIT 1`)[0];
      const side = contract ? await sideOf(sql, userId, contract) : null;
      if (!contract || !side) return failure("NOT_FOUND", partyAction ? "Dispute not found" : "Contract not found", 404, requestId);

      if (contractDispute && method === "GET") {
        const latest = (await sql<DisputeRow[]>`SELECT * FROM disputes WHERE contract_id = ${contract.id} ORDER BY created_at DESC LIMIT 1`)[0];
        return success(
          {
            dispute: latest ? disputeOut(latest, await statementsFor(sql, latest.id), side.party) : null,
            can_open: side.canManage && contract.status === "active" && (!latest || latest.status !== "open")
          },
          "Dispute",
          200,
          requestId
        );
      }

      if (!side.canManage) return failure("FORBIDDEN", "Only owners and admins can act for the client.", 403, requestId);
      const payload = (await body(request)) ?? {};

      if (contractDispute) {
        if (contract.status !== "active") return failure("CONTRACT_NOT_ACTIVE", "Disputes can only be raised on active contracts.", 409, requestId);
        const checked = validateDispute(payload);
        if (!checked.ok) return failure("INVALID_DISPUTE", "Check the highlighted fields.", 422, requestId, [checked.errors]);
        const rows = await sql<DisputeRow[]>`
          INSERT INTO disputes (id, contract_id, opened_by_party, opened_by, reason, description, desired_outcome, status, created_at)
          VALUES (${crypto.randomUUID()}, ${contract.id}, ${side.party}, ${userId}, ${checked.value.reason}, ${checked.value.description},
                  ${checked.value.desired_outcome}, 'open', now())
          ON CONFLICT (contract_id) WHERE status = 'open' DO NOTHING
          RETURNING *
        `;
        if (!rows[0]) return failure("ALREADY_OPEN", "A dispute is already open on this contract.", 409, requestId);
        await recordContractEvent(sql, contract.id, userId, side.party, "dispute.opened", { reason: checked.value.reason });
        console.warn(JSON.stringify({ service: "freelance-income-ai-api-edge", event: "trust.dispute_opened", alert: true, dispute_id: rows[0].id, reason: checked.value.reason }));
        return success(disputeOut(rows[0], [], side.party), "Dispute opened. Staff will review the contract record and both sides' statements.", 201, requestId);
      }

      // party action on an existing dispute
      if (dispute!.status !== "open") return failure("DISPUTE_CLOSED", "This dispute is no longer open.", 409, requestId);
      if (partyAction![2] === "withdraw") {
        if (dispute!.opened_by_party !== side.party) return failure("FORBIDDEN", "Only the side that opened the dispute can withdraw it.", 403, requestId);
        const rows = await sql<{ id: string }[]>`UPDATE disputes SET status = 'withdrawn', resolved_at = now() WHERE id = ${dispute!.id} AND status = 'open' RETURNING id`;
        if (!rows[0]) return failure("DISPUTE_CLOSED", "This dispute is no longer open.", 409, requestId);
        await recordContractEvent(sql, contract.id, userId, side.party, "dispute.withdrawn", {});
        return success({ id: dispute!.id }, "Dispute withdrawn", 200, requestId);
      }

      const text = typeof payload.body === "string" ? payload.body.trim() : "";
      if (text.length < 5 || text.length > 4000) return failure("INVALID_STATEMENT", "Write 5–4,000 characters.", 422, requestId);
      if (screenText(text).length) return failure("MESSAGE_NOT_ALLOWED", "Keep contact and payment details off the platform record.", 422, requestId);
      const count = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM dispute_statements WHERE dispute_id = ${dispute!.id} AND party = ${side.party}`;
      if ((count[0]?.n ?? 0) >= MAX_STATEMENTS_PER_PARTY) return failure("LIMIT_REACHED", "You have added the maximum number of statements.", 429, requestId);
      const rows = await sql<StatementRow[]>`
        INSERT INTO dispute_statements (id, dispute_id, party, user_id, body, created_at)
        VALUES (${crypto.randomUUID()}, ${dispute!.id}, ${side.party}, ${userId}, ${text}, now())
        RETURNING *
      `;
      await recordContractEvent(sql, contract.id, userId, side.party, "dispute.statement_added", {});
      return success({ id: rows[0].id, party: rows[0].party, body: rows[0].body, created_at: iso(rows[0].created_at) }, "Statement added", 201, requestId);
    }

    /* ---------------- staff ---------------- */
    const roles = await loadRoles(sql, userId);
    const isAdmin = roles.includes("admin");
    if (!isAdmin && !roles.includes("moderator")) return failure("NOT_FOUND", "Not found", 404, requestId);

    if (path === "/api/v1/admin/disputes") {
      const status = url.searchParams.get("status") ?? "open";
      if (!["open", "resolved", "withdrawn"].includes(status)) return failure("INVALID_STATUS", "Unknown status.", 422, requestId);
      const rows = await sql<(DisputeRow & { contract_title: string | null; freelancer_name: string | null; organization_name: string | null; funded_minor: string | number | null })[]>`
        SELECT d.*, v.title AS contract_title, COALESCE(NULLIF(p.full_name, ''), 'Freelancer') AS freelancer_name, o.name AS organization_name,
               (SELECT COALESCE(sum(i.amount_minor), 0) FROM payment_intents i WHERE i.contract_id = d.contract_id AND i.status = 'funded') AS funded_minor
        FROM disputes d
        JOIN contracts c ON c.id = d.contract_id
        LEFT JOIN contract_versions v ON v.contract_id = c.id AND v.version = COALESCE(c.agreed_version, c.current_version)
        LEFT JOIN profiles p ON p.user_id = c.freelancer_user_id
        LEFT JOIN organizations o ON o.id = c.organization_id
        WHERE d.status = ${status}
        ORDER BY d.created_at ASC
        LIMIT 200
      `;
      return success(
        rows.map((r) => ({
          ...disputeOut(r, [], "staff"),
          contract_title: r.contract_title ?? "",
          freelancer_name: r.freelancer_name ?? "",
          organization_name: r.organization_name ?? "",
          funded_unreleased_minor: Number(r.funded_minor ?? 0)
        })),
        "Disputes",
        200,
        requestId
      );
    }

    if (adminDispute) {
      const dispute = (await sql<DisputeRow[]>`SELECT * FROM disputes WHERE id = ${adminDispute[1]} LIMIT 1`)[0];
      if (!dispute) return failure("NOT_FOUND", "Dispute not found", 404, requestId);

      if (!adminDispute[2]) {
        return success(
          { dispute: disputeOut(dispute, await statementsFor(sql, dispute.id), "staff"), evidence: await evidencePack(sql, dispute), can_move_money: isAdmin },
          "Dispute evidence pack",
          200,
          requestId
        );
      }

      const payload = (await body(request)) ?? {};
      const resolution = payload.resolution;
      const note = typeof payload.note === "string" ? payload.note.trim() : "";
      if (!DISPUTE_RESOLUTIONS.includes(resolution as never)) return failure("INVALID_RESOLUTION", "Resolution must be release_funded, refund_funded or no_action.", 422, requestId);
      if (note.length < 20 || note.length > 4000) return failure("NOTE_REQUIRED", "Explain the decision for both parties (20–4,000 characters).", 422, requestId);
      if (resolution !== "no_action" && !isAdmin) return failure("FORBIDDEN", "Only an admin can decide an outcome that moves money.", 403, requestId);

      // A repeat of the same decision completes any step that did not finish; a different decision is refused.
      if (dispute.status === "resolved") {
        if (dispute.resolution !== resolution) return failure("DISPUTE_CLOSED", "This dispute is already resolved with a different outcome.", 409, requestId);
        const result = await applyResolution(sql, dispute, userId);
        return success({ id: dispute.id, resolution, ...result }, "Decision already recorded; any unfinished step was completed.", 200, requestId);
      }
      if (dispute.status !== "open") return failure("DISPUTE_CLOSED", "This dispute is no longer open.", 409, requestId);

      const claimed = await sql.begin(async (tx) => {
        const rows = await tx<DisputeRow[]>`
          UPDATE disputes SET status = 'resolved', resolution = ${resolution as string}, resolution_note = ${note}, resolved_by = ${userId}, resolved_at = now()
          WHERE id = ${dispute.id} AND status = 'open' RETURNING *
        `;
        if (!rows[0]) return null;
        await logAction(tx, userId, "dispute", dispute.id, `dispute.${resolution as string}`, note);
        await recordContractEvent(tx, dispute.contract_id, userId, "system", "dispute.resolved", { resolution });
        return rows[0];
      });
      if (!claimed) return failure("DISPUTE_CLOSED", "This dispute is no longer open.", 409, requestId);
      const result = await applyResolution(sql, claimed, userId);
      const message =
        resolution === "release_funded"
          ? `Decision recorded. ${result.released} funded milestone(s) released to the freelancer; contract completed.`
          : resolution === "refund_funded"
            ? `Decision recorded. ${result.refunded} funded milestone(s) refunded to the client; contract cancelled.`
            : "Decision recorded. No money moved; the contract continues.";
      return success({ id: dispute.id, resolution, ...result }, message, 200, requestId);
    }

    if (path === "/api/v1/admin/suspensions") {
      const status = url.searchParams.get("status") ?? "active";
      if (!["active", "lifted"].includes(status)) return failure("INVALID_STATUS", "Unknown status.", 422, requestId);
      const rows = await sql<(SuspensionRow & { email: string; full_name: string | null })[]>`
        SELECT s.*, u.email, p.full_name
        FROM account_suspensions s
        JOIN users u ON u.id = s.user_id
        LEFT JOIN profiles p ON p.user_id = s.user_id
        WHERE s.status = ${status}
        ORDER BY (s.appeal_status = 'pending') DESC, s.created_at DESC
        LIMIT 200
      `;
      return success(rows.map((r) => ({ ...suspensionOut(r), email: r.email, name: r.full_name ?? "" })), "Suspensions", 200, requestId);
    }

    if (suspendUser) {
      const target = suspendUser[1];
      const payload = (await body(request)) ?? {};
      const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
      if (reason.length < 20 || reason.length > 2000) return failure("REASON_REQUIRED", "Give the reason the person will see (20–2,000 characters).", 422, requestId);
      if (target === userId) return failure("FORBIDDEN", "You cannot suspend yourself.", 403, requestId);
      const exists = await sql<{ id: string }[]>`SELECT id FROM users WHERE id = ${target} LIMIT 1`;
      if (!exists[0]) return failure("NOT_FOUND", "User not found", 404, requestId);
      const targetRoles = await loadRoles(sql, target);
      if (targetRoles.some((r) => ["admin", "finance", "moderator"].includes(r))) {
        return failure("FORBIDDEN", "Staff accounts cannot be suspended here. Remove the staff role first.", 403, requestId);
      }
      const created = await sql.begin(async (tx) => {
        const rows = await tx<SuspensionRow[]>`
          INSERT INTO account_suspensions (id, user_id, reason, status, created_by, created_at)
          VALUES (${crypto.randomUUID()}, ${target}, ${reason}, 'active', ${userId}, now())
          ON CONFLICT (user_id) WHERE status = 'active' DO NOTHING
          RETURNING *
        `;
        if (!rows[0]) return null;
        await tx`UPDATE users SET suspended_at = now() WHERE id = ${target}`;
        // Leave discovery; the person cannot switch it back on while suspended.
        await tx`UPDATE profiles SET marketplace_visible = false WHERE user_id = ${target}`;
        await logAction(tx, userId, "user", target, "user.suspended", reason);
        return rows[0];
      });
      if (!created) return failure("ALREADY_SUSPENDED", "This account is already suspended.", 409, requestId);
      await notifyUsers(sql, [target], {
        kind: "account.suspended",
        title: "Your account has been suspended",
        message: `${reason} You can appeal from your Account page.`,
        link: "/account",
        dedupe: `suspension:${created.id}`
      });
      console.warn(JSON.stringify({ service: "freelance-income-ai-api-edge", event: "trust.user_suspended", alert: true, suspension_id: created.id, by: userId }));
      return success(suspensionOut(created), "Account suspended. The person can sign in, see the reason and appeal.", 201, requestId);
    }

    // lift / appeal decision
    const action = suspensionAction![2];
    const payload = (await body(request)) ?? {};
    const note = typeof payload.note === "string" ? payload.note.trim() : "";
    if (note.length < 10 || note.length > 2000) return failure("NOTE_REQUIRED", "Record the reason for the decision (10–2,000 characters).", 422, requestId);
    const suspension = (await sql<SuspensionRow[]>`SELECT * FROM account_suspensions WHERE id = ${suspensionAction![1]} LIMIT 1`)[0];
    if (!suspension) return failure("NOT_FOUND", "Suspension not found", 404, requestId);
    if (suspension.status !== "active") return failure("NOT_ACTIVE", "This suspension is already lifted.", 409, requestId);

    let decision: "lift" | "overturn" | "uphold";
    if (action === "lift") {
      decision = "lift";
    } else {
      if (payload.decision !== "uphold" && payload.decision !== "overturn") return failure("INVALID_DECISION", "Decision must be uphold or overturn.", 422, requestId);
      if (suspension.appeal_status !== "pending") return failure("NO_APPEAL", "There is no pending appeal on this suspension.", 409, requestId);
      // A second person reviews the appeal; the suspending staff member can still lift it outright.
      if (suspension.created_by === userId) return failure("SECOND_REVIEWER_REQUIRED", "A different staff member must decide this appeal. You can lift the suspension instead.", 403, requestId);
      decision = payload.decision;
    }

    const done = await sql.begin(async (tx) => {
      if (decision === "uphold") {
        const rows = await tx<{ id: string }[]>`
          UPDATE account_suspensions SET appeal_status = 'upheld', lift_note = ${note} WHERE id = ${suspension.id} AND status = 'active' AND appeal_status = 'pending' RETURNING id
        `;
        if (!rows[0]) return false;
        await logAction(tx, userId, "suspension", suspension.id, "appeal.upheld", note);
        return true;
      }
      const rows = await tx<{ id: string }[]>`
        UPDATE account_suspensions
        SET status = 'lifted', lifted_by = ${userId}, lifted_at = now(), lift_note = ${note},
            appeal_status = CASE WHEN appeal_status = 'pending' THEN 'overturned' ELSE appeal_status END
        WHERE id = ${suspension.id} AND status = 'active' RETURNING id
      `;
      if (!rows[0]) return false;
      await tx`UPDATE users SET suspended_at = NULL WHERE id = ${suspension.user_id}`;
      await logAction(tx, userId, "suspension", suspension.id, decision === "lift" ? "user.unsuspended" : "appeal.overturned", note);
      return true;
    });
    if (!done) return failure("NOT_ACTIVE", "This suspension changed while you were deciding. Reload and try again.", 409, requestId);
    await notifyUsers(sql, [suspension.user_id], {
      kind: decision === "uphold" ? "appeal.upheld" : "account.reinstated",
      title: decision === "uphold" ? "Your appeal was reviewed: the suspension stays" : "Your account has been reinstated",
      message: decision === "uphold" ? note : `${note} You can switch marketplace visibility back on from Find work.`,
      link: "/account",
      dedupe: `suspension:${suspension.id}:${decision}`
    });
    return success(
      { id: suspension.id, decision },
      decision === "uphold" ? "Appeal rejected; the suspension stays." : "Suspension lifted.",
      200,
      requestId
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
