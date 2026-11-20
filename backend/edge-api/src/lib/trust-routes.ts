import type { Env } from "../types";
import { alertSavedSearches } from "./growth-routes";
import { notifyUsers, organizationManagers } from "./notify";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { FLAGS } from "./flags";
import { loadRoles } from "./identity";
import { versionOut } from "./listings";
import type { ListingRow, VersionRow } from "./listings";

/**
 * Trust and admin (Phase 7 batch 1):
 *
 * Any signed-in user
 *   POST /api/v1/reports {target_type, target_id, reason, details}
 *   GET  /api/v1/me/reports
 * Staff: moderator or admin (others get 404)
 *   GET  /api/v1/admin/moderation/listings                 listings held for review, with screen findings
 *   POST /api/v1/admin/moderation/listings/{id} {decision: approve|return, note}
 *   GET  /api/v1/admin/reports?status=open|actioned|dismissed
 *   POST /api/v1/admin/reports/{id} {decision: action|dismiss, note, hide_listing?}
 *   GET  /api/v1/admin/overview                            counts, queue ages, AI usage, flags
 * Admin only
 *   POST /api/v1/admin/flags/{key} {enabled}               (payments.live cannot be changed here)
 *
 * Every staff decision is written to the append-only `moderation_actions` log.
 * Agents never decide these: staff do (Master Plan 3.5: suspend, decide dispute = human only).
 */

export interface TrustRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
}

const defaultDeps: TrustRouteDeps = { database, authenticate: authenticateRequest };

export const REPORT_TARGETS = ["listing", "user", "proposal", "contract_message", "review", "service"] as const;
export const REPORT_REASONS = ["spam", "scam", "off_platform", "abuse", "prohibited", "fake", "other"] as const;
const MAX_OPEN_REPORTS_PER_USER = 20;
/** Flags staff may not flip from the dashboard. */
const LOCKED_FLAGS = new Set<string>([FLAGS.paymentsLive]);

async function logAction(sql: Queryable, actor: string, targetType: string, targetId: string, action: string, note: string): Promise<void> {
  await sql`
    INSERT INTO moderation_actions (id, actor_user_id, target_type, target_id, action, note, created_at)
    VALUES (${crypto.randomUUID()}, ${actor}, ${targetType}, ${targetId}, ${action}, ${note.slice(0, 2000)}, now())
  `;
}

interface ReportRow {
  id: string;
  reporter_user_id: string | null;
  target_type: string;
  target_id: string;
  reason: string;
  details: string;
  status: string;
  resolution_note: string;
  resolved_at: Date | null;
  created_at: Date;
}

function reportOut(r: ReportRow, includeReporter: boolean) {
  return {
    id: r.id,
    target_type: r.target_type,
    target_id: r.target_id,
    reason: r.reason,
    details: r.details,
    status: r.status,
    resolution_note: r.resolution_note,
    resolved_at: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
    created_at: new Date(r.created_at).toISOString(),
    ...(includeReporter ? { reporter_user_id: r.reporter_user_id } : {})
  };
}

export async function handleTrustRoute(request: Request, env: Env, requestId: string, deps: TrustRouteDeps = defaultDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const listingDecision = path.match(/^\/api\/v1\/admin\/moderation\/listings\/([\w-]{1,64})$/);
  const reportDecision = path.match(/^\/api\/v1\/admin\/reports\/([\w-]{1,64})$/);
  const flag = path.match(/^\/api\/v1\/admin\/flags\/([a-z_.]{3,80})$/);
  const known =
    (method === "POST" && (path === "/api/v1/reports" || listingDecision !== null || reportDecision !== null || flag !== null)) ||
    (method === "GET" && (path === "/api/v1/me/reports" || path === "/api/v1/admin/moderation/listings" || path === "/api/v1/admin/reports" || path === "/api/v1/admin/overview"));
  if (!known) return null;

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);

  try {
    /* ---------------- reporting (any user) ---------------- */
    if (path === "/api/v1/reports") {
      const payload = (await body(request)) ?? {};
      const targetType = payload.target_type;
      const targetId = typeof payload.target_id === "string" ? payload.target_id.trim() : "";
      const reason = payload.reason;
      const details = typeof payload.details === "string" ? payload.details.trim() : "";
      const errors: Record<string, string> = {};
      if (!REPORT_TARGETS.includes(targetType as never)) errors.target_type = "Choose what you are reporting.";
      if (!/^[\w-]{1,64}$/.test(targetId)) errors.target_id = "Missing target.";
      if (!REPORT_REASONS.includes(reason as never)) errors.reason = "Choose a reason.";
      if (details.length > 2000) errors.details = "Keep details under 2,000 characters.";
      if (Object.keys(errors).length) return failure("INVALID_REPORT", "Check the highlighted fields.", 422, requestId, [errors]);
      if (targetType === "user" && targetId === userId) return failure("INVALID_REPORT", "You cannot report yourself.", 422, requestId);
      if (targetType === "listing") {
        const exists = await sql<{ id: string; own: boolean }[]>`
          SELECT l.id, EXISTS (
            SELECT 1 FROM organization_memberships m
            WHERE m.organization_id = l.organization_id AND m.user_id = ${userId} AND m.status = 'active'
          ) AS own
          FROM project_listings l WHERE l.id = ${targetId} LIMIT 1
        `;
        if (!exists[0]) return failure("NOT_FOUND", "Project not found", 404, requestId);
        if (exists[0].own) return failure("INVALID_REPORT", "You cannot report a project of your own client account.", 422, requestId);
      }
      if (targetType === "user") {
        const exists = await sql<{ id: string }[]>`SELECT id FROM users WHERE id = ${targetId} LIMIT 1`;
        if (!exists[0]) return failure("NOT_FOUND", "User not found", 404, requestId);
      }
      if (targetType === "service") {
        const exists = await sql<{ freelancer_user_id: string }[]>`SELECT freelancer_user_id FROM services WHERE id = ${targetId} AND status <> 'removed' LIMIT 1`.catch(() => []);
        if (!exists[0]) return failure("NOT_FOUND", "Service not found", 404, requestId);
        if (exists[0].freelancer_user_id === userId) return failure("INVALID_REPORT", "You cannot report your own service.", 422, requestId);
      }
      const open = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM reports WHERE reporter_user_id = ${userId} AND status = 'open'`;
      if ((open[0]?.n ?? 0) >= MAX_OPEN_REPORTS_PER_USER) {
        return failure("LIMIT_REACHED", "You have many open reports. Please wait for staff to review them.", 429, requestId);
      }
      const rows = await sql<ReportRow[]>`
        INSERT INTO reports (id, reporter_user_id, target_type, target_id, reason, details, status, created_at)
        VALUES (${crypto.randomUUID()}, ${userId}, ${targetType as string}, ${targetId}, ${reason as string}, ${details}, 'open', now())
        ON CONFLICT (reporter_user_id, target_type, target_id) WHERE status = 'open' DO NOTHING
        RETURNING *
      `;
      if (!rows[0]) return failure("ALREADY_REPORTED", "You already reported this. Staff will review it.", 409, requestId);
      console.warn(JSON.stringify({ service: "freelance-income-ai-api-edge", event: "trust.report_created", alert: true, target_type: targetType, reason }));
      return success(reportOut(rows[0], false), "Thank you. Staff will review your report.", 201, requestId);
    }

    if (path === "/api/v1/me/reports") {
      const rows = await sql<ReportRow[]>`SELECT * FROM reports WHERE reporter_user_id = ${userId} ORDER BY created_at DESC LIMIT 50`;
      return success(rows.map((r) => reportOut(r, false)), "Your reports", 200, requestId);
    }

    /* ---------------- staff ---------------- */
    const roles = await loadRoles(sql, userId);
    const isAdmin = roles.includes("admin");
    if (!isAdmin && !roles.includes("moderator")) return failure("NOT_FOUND", "Not found", 404, requestId);

    if (path === "/api/v1/admin/moderation/listings") {
      const rows = await sql<(ListingRow & VersionRow & { organization_name: string; l_created_at: Date; l_updated_at: Date })[]>`
        SELECT l.id, l.organization_id, l.category_slug, l.status, l.visibility, l.moderation_status, l.moderation_notes, l.current_version,
               l.published_at, l.closes_at, l.created_at AS l_created_at, l.updated_at AS l_updated_at,
               v.version, v.title, v.outcome, v.description, v.deliverables_json, v.skills_json, v.experience_level, v.budget_model,
               v.budget_min_minor, v.budget_max_minor, v.currency, v.deadline, v.milestones_json, v.acceptance_json, v.revision_rounds,
               v.languages_json, v.timezone, v.confidentiality, v.ownership_notes, v.assumptions_json, v.content_hash, v.created_at,
               o.name AS organization_name
        FROM project_listings l
        JOIN project_listing_versions v ON v.listing_id = l.id AND v.version = l.current_version
        JOIN organizations o ON o.id = l.organization_id
        WHERE l.status = 'in_review'
        ORDER BY l.updated_at ASC
        LIMIT 100
      `;
      return success(
        rows.map((r) => ({
          id: r.id,
          organization_name: r.organization_name,
          findings: r.moderation_notes ? r.moderation_notes.split(",").filter(Boolean) : [],
          waiting_since: new Date(r.l_updated_at).toISOString(),
          brief: versionOut({ ...r, category_slug: r.category_slug })
        })),
        "Listings waiting for review",
        200,
        requestId
      );
    }

    if (listingDecision) {
      const payload = (await body(request)) ?? {};
      const decision = payload.decision;
      const note = typeof payload.note === "string" ? payload.note.trim() : "";
      if (decision !== "approve" && decision !== "return") return failure("INVALID_DECISION", "Decision must be approve or return.", 422, requestId);
      if (decision === "return" && note.length < 10) return failure("NOTE_REQUIRED", "Tell the client what to change (at least 10 characters).", 422, requestId);
      const done = await sql.begin(async (tx) => {
        const rows = decision === "approve"
          ? await tx<{ id: string }[]>`
              UPDATE project_listings SET status = 'published', moderation_status = 'approved', moderation_notes = '',
                published_at = COALESCE(published_at, now()), updated_at = now()
              WHERE id = ${listingDecision[1]} AND status = 'in_review' RETURNING id
            `
          : await tx<{ id: string }[]>`
              UPDATE project_listings SET status = 'draft', moderation_status = 'rejected', moderation_notes = ${note.slice(0, 1000)}, updated_at = now()
              WHERE id = ${listingDecision[1]} AND status = 'in_review' RETURNING id
            `;
        if (!rows[0]) return false;
        await logAction(tx, userId, "listing", listingDecision[1], decision === "approve" ? "listing.approved" : "listing.returned", note);
        return true;
      });
      if (!done) return failure("NOT_IN_REVIEW", "This listing is not waiting for review.", 409, requestId);
      if (decision === "approve") await alertSavedSearches(sql, listingDecision[1]);
      const decided = (await sql<{ organization_id: string }[]>`SELECT organization_id FROM project_listings WHERE id = ${listingDecision[1]} LIMIT 1`)[0];
      if (decided) {
        await notifyUsers(sql, await organizationManagers(sql, decided.organization_id), {
          kind: `listing.${decision === "approve" ? "approved" : "returned"}`,
          title: decision === "approve" ? "Your project was approved and published" : "Your project needs changes before publishing",
          message: decision === "approve" ? "Freelancers can now see it and send proposals." : note,
          link: "/client/projects",
          dedupe: `moderation:${listingDecision[1]}:${decision}:${Date.now()}`
        });
      }
      return success({ id: listingDecision[1], decision }, decision === "approve" ? "Listing approved and published" : "Listing returned to the client", 200, requestId);
    }

    if (path === "/api/v1/admin/reports") {
      const status = url.searchParams.get("status") ?? "open";
      if (!["open", "actioned", "dismissed"].includes(status)) return failure("INVALID_STATUS", "Unknown status.", 422, requestId);
      const rows = await sql<ReportRow[]>`SELECT * FROM reports WHERE status = ${status} ORDER BY created_at ASC LIMIT 200`;
      return success(rows.map((r) => reportOut(r, true)), "Reports", 200, requestId);
    }

    if (reportDecision) {
      const payload = (await body(request)) ?? {};
      const decision = payload.decision;
      const note = typeof payload.note === "string" ? payload.note.trim() : "";
      if (decision !== "action" && decision !== "dismiss") return failure("INVALID_DECISION", "Decision must be action or dismiss.", 422, requestId);
      if (note.length < 5) return failure("NOTE_REQUIRED", "Record what you decided and why (at least 5 characters).", 422, requestId);
      const result = await sql.begin(async (tx) => {
        const report = (await tx<ReportRow[]>`SELECT * FROM reports WHERE id = ${reportDecision[1]} FOR UPDATE`)[0];
        if (!report || report.status !== "open") return { code: "CLOSED" as const };
        await tx`
          UPDATE reports SET status = ${decision === "action" ? "actioned" : "dismissed"}, resolution_note = ${note.slice(0, 2000)},
            resolved_by = ${userId}, resolved_at = now()
          WHERE id = ${report.id}
        `;
        await logAction(tx, userId, "report", report.id, decision === "action" ? "report.actioned" : "report.dismissed", note);
        let hidden = false;
        if (decision === "action" && payload.hide_listing === true && report.target_type === "listing") {
          // A3 platform action: hide pending review (back to the moderation queue), never delete.
          const rows = await tx<{ id: string }[]>`
            UPDATE project_listings SET status = 'in_review', moderation_status = 'flagged',
              moderation_notes = ${`reported:${report.reason}`}, updated_at = now()
            WHERE id = ${report.target_id} AND status IN ('published', 'paused') RETURNING id
          `;
          if (rows[0]) {
            hidden = true;
            await logAction(tx, userId, "listing", report.target_id, "listing.hidden_pending_review", `Report ${report.id}: ${note}`);
          }
        }
        if (decision === "action" && payload.hide_listing === true && report.target_type === "service") {
          // Same rule for services: hidden pending a moderator's review, never deleted.
          const rows = await tx<{ id: string }[]>`
            UPDATE services SET status = 'in_review', moderation_note = ${`reported:${report.reason}`}, updated_at = now()
            WHERE id = ${report.target_id} AND status IN ('published', 'paused') RETURNING id
          `;
          if (rows[0]) {
            hidden = true;
            await logAction(tx, userId, "service", report.target_id, "service.hidden_pending_review", `Report ${report.id}: ${note}`);
          }
        }
        return { code: "OK" as const, hidden };
      });
      if (result.code === "CLOSED") return failure("REPORT_CLOSED", "This report is already resolved.", 409, requestId);
      const reporter = (await sql<{ reporter_user_id: string | null }[]>`SELECT reporter_user_id FROM reports WHERE id = ${reportDecision[1]} LIMIT 1`)[0];
      await notifyUsers(sql, [reporter?.reporter_user_id], {
        kind: "report.resolved",
        title: "Your report was reviewed",
        message: decision === "action" ? "Thank you. Staff took action." : "Thank you. Staff reviewed it and took no action.",
        link: "/projects",
        dedupe: `report:${reportDecision[1]}`
      });
      return success({ id: reportDecision[1], decision, listing_hidden: result.hidden }, decision === "action" ? (result.hidden ? "Report actioned; hidden pending review" : "Report actioned") : "Report dismissed", 200, requestId);
    }

    if (path === "/api/v1/admin/overview") {
      const counts = (await sql<Record<string, string | number | null>[]>`
        SELECT
          (SELECT count(*) FROM users) AS users,
          (SELECT count(*) FROM user_roles WHERE role = 'client' AND status = 'active') AS clients,
          (SELECT count(*) FROM project_listings WHERE status = 'published') AS listings_published,
          (SELECT count(*) FROM project_listings WHERE status = 'in_review') AS listings_in_review,
          (SELECT EXTRACT(EPOCH FROM now() - min(updated_at))::int FROM project_listings WHERE status = 'in_review') AS oldest_review_seconds,
          (SELECT count(*) FROM listing_proposals) AS proposals,
          (SELECT count(*) FROM contracts WHERE status = 'active') AS contracts_active,
          (SELECT count(*) FROM contracts WHERE status = 'completed') AS contracts_completed,
          (SELECT count(*) FROM reports WHERE status = 'open') AS reports_open,
          (SELECT EXTRACT(EPOCH FROM now() - min(created_at))::int FROM reports WHERE status = 'open') AS oldest_report_seconds,
          (SELECT count(*) FROM ai_usage_events WHERE created_at >= date_trunc('day', now())) AS ai_calls_today,
          (SELECT COALESCE(sum(estimated_cost_micros), 0) FROM ai_usage_events WHERE created_at >= date_trunc('day', now())) AS ai_cost_today_micros,
          (SELECT COALESCE(sum(estimated_cost_micros), 0) FROM ai_usage_events WHERE created_at >= date_trunc('month', now())) AS ai_cost_month_micros
      `)[0] ?? {};
      const flags = await sql<{ key: string; enabled: boolean; description: string; updated_by: string; updated_at: Date }[]>`
        SELECT key, enabled, description, updated_by, updated_at FROM feature_flags ORDER BY key
      `;
      const num = (v: string | number | null | undefined) => (v === null || v === undefined ? null : Number(v));
      return success(
        {
          counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, num(v)])),
          flags: flags.map((f) => ({ key: f.key, enabled: Boolean(f.enabled), description: f.description, locked: LOCKED_FLAGS.has(f.key), updated_by: f.updated_by, updated_at: new Date(f.updated_at).toISOString() })),
          is_admin: isAdmin
        },
        "Admin overview",
        200,
        requestId
      );
    }

    // flags (admin only)
    if (!isAdmin) return failure("FORBIDDEN", "Only an admin can change feature flags.", 403, requestId);
    const key = flag![1];
    if (LOCKED_FLAGS.has(key)) {
      return failure("FLAG_LOCKED", "Real payments stay off until the legal entity, payment provider and accounting are approved (D-1/D-2). This flag cannot be changed from the dashboard.", 409, requestId);
    }
    const payload = (await body(request)) ?? {};
    if (typeof payload.enabled !== "boolean") return failure("INVALID_VALUE", "enabled must be true or false.", 422, requestId);
    const enabled: boolean = payload.enabled;
    const updated = await sql.begin(async (tx) => {
      const rows = await tx<{ key: string; enabled: boolean }[]>`
        UPDATE feature_flags SET enabled = ${enabled}, updated_by = ${`admin:${userId}`}, updated_at = now() WHERE key = ${key} RETURNING key, enabled
      `;
      if (rows[0]) await logAction(tx, userId, "flag", key, enabled ? "flag.enabled" : "flag.disabled", "");
      return rows[0] ?? null;
    });
    if (!updated) return failure("NOT_FOUND", "Unknown flag", 404, requestId);
    console.warn(JSON.stringify({ service: "freelance-income-ai-api-edge", event: "admin.flag_changed", alert: true, key, enabled: updated.enabled, by: userId }));
    return success({ key: updated.key, enabled: Boolean(updated.enabled) }, `${key} is now ${updated.enabled ? "ON" : "OFF"}`, 200, requestId);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
