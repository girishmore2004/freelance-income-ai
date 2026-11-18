import type { Env } from "../types";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { canManageOrganization, loadRoles, organizationForMember } from "./identity";
import { tableExists } from "./external-pipeline";
import { FLAGS, isEnabled } from "./flags";
import { screenText } from "./listings";
import { intakeOf, loadQuota, validateIntake } from "./fair-proposals";

/**
 * Fair proposals and blocking (U23; Master Plan B12, Step 6).
 *
 *   GET  /api/v1/me/proposal-quota                  freelancer: weekly limit, used, remaining, why
 *   GET  /api/v1/listings/{id}/intake               client member: cap, open/closed, proposals received
 *   POST /api/v1/listings/{id}/intake {max_proposals: 1–500 | null, accepting}   owner/admin
 *   GET  /api/v1/me/blocks                          blocks I made (as freelancer, or for client accounts I manage)
 *   POST /api/v1/blocks {listing_id | proposal_id | organization_id | freelancer_user_id + organization_id, reason?}
 *   POST /api/v1/blocks/{id}/remove                 only the side that made it
 *
 * Who can block: a freelancer blocks a client account (from its project or a
 * proposal); an owner/admin of a client account blocks a freelancer. Not while
 * an offer or contract between them is open (finish it, or report a problem).
 * Making a block withdraws (freelancer) or declines (client) the open
 * proposals between them and withdraws pending invitations, in one transaction.
 */

export interface FairRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
}

const defaultDeps: FairRouteDeps = { database, authenticate: authenticateRequest };

const DISABLED = "The client marketplace is not open yet.";
const PENDING = "Blocking needs database migration 0078.";
const id = (v: unknown): string | null => (typeof v === "string" && /^[\w-]{1,64}$/.test(v) ? v : null);

type Target = { freelancer_user_id: string; organization_id: string; side: "freelancer" | "client" };

/** Works out who blocks whom from the request, checking the caller's right to do it. */
async function resolveTarget(sql: Queryable, userId: string, roles: string[], payload: Record<string, unknown>): Promise<Target | { code: string; message: string; status: number }> {
  const listingId = id(payload.listing_id);
  const proposalId = id(payload.proposal_id);
  const orgId = id(payload.organization_id);
  const freelancerId = id(payload.freelancer_user_id);

  if (proposalId) {
    const row = (await sql<{ freelancer_user_id: string; organization_id: string }[]>`
      SELECT p.freelancer_user_id, l.organization_id FROM listing_proposals p JOIN project_listings l ON l.id = p.listing_id WHERE p.id = ${proposalId} LIMIT 1
    `)[0];
    if (!row) return { code: "NOT_FOUND", message: "Proposal not found", status: 404 };
    if (row.freelancer_user_id === userId) return { ...row, side: "freelancer" };
    const org = await organizationForMember(sql, userId, row.organization_id);
    if (!org) return { code: "NOT_FOUND", message: "Proposal not found", status: 404 };
    if (!canManageOrganization(org.membership_role)) return { code: "FORBIDDEN", message: "Only owners and admins of the client account can block.", status: 403 };
    return { ...row, side: "client" };
  }
  if (listingId || (orgId && !freelancerId)) {
    if (!roles.includes("freelancer")) return { code: "FREELANCER_ROLE_REQUIRED", message: "Turn on the freelancer role first.", status: 403 };
    let organizationId = orgId;
    if (listingId) {
      const row = (await sql<{ organization_id: string }[]>`SELECT organization_id FROM project_listings WHERE id = ${listingId} LIMIT 1`)[0];
      if (!row) return { code: "NOT_FOUND", message: "Project not found", status: 404 };
      organizationId = row.organization_id;
    } else {
      const row = (await sql<{ id: string }[]>`SELECT id FROM organizations WHERE id = ${organizationId} LIMIT 1`)[0];
      if (!row) return { code: "NOT_FOUND", message: "Client account not found", status: 404 };
    }
    if (await organizationForMember(sql, userId, organizationId as string)) return { code: "INVALID_BLOCK", message: "You are a member of this client account.", status: 422 };
    return { freelancer_user_id: userId, organization_id: organizationId as string, side: "freelancer" };
  }
  if (freelancerId && orgId) {
    const org = await organizationForMember(sql, userId, orgId);
    if (!org) return { code: "NOT_FOUND", message: "Client account not found", status: 404 };
    if (!canManageOrganization(org.membership_role)) return { code: "FORBIDDEN", message: "Only owners and admins of the client account can block.", status: 403 };
    if (freelancerId === userId || (await organizationForMember(sql, freelancerId, orgId))) return { code: "INVALID_BLOCK", message: "You cannot block a member of your own client account.", status: 422 };
    const exists = (await sql`SELECT 1 FROM users WHERE id = ${freelancerId} LIMIT 1`).length > 0;
    if (!exists) return { code: "NOT_FOUND", message: "Freelancer not found", status: 404 };
    return { freelancer_user_id: freelancerId, organization_id: orgId, side: "client" };
  }
  return { code: "INVALID_BLOCK", message: "Choose who to block.", status: 422 };
}

export async function handleFairRoute(request: Request, env: Env, requestId: string, deps: FairRouteDeps = defaultDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const intake = path.match(/^\/api\/v1\/listings\/([\w-]{1,64})\/intake$/);
  const remove = path.match(/^\/api\/v1\/blocks\/([\w-]{1,64})\/remove$/);
  const known =
    (method === "GET" && (path === "/api/v1/me/proposal-quota" || path === "/api/v1/me/blocks" || intake !== null)) ||
    (method === "POST" && (path === "/api/v1/blocks" || remove !== null || intake !== null));
  if (!known) return null;

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);
  try {
    if (!(await isEnabled(env, sql, FLAGS.clientMarketplace, false))) return failure("FEATURE_DISABLED", DISABLED, 403, requestId);

    if (path === "/api/v1/me/proposal-quota") {
      return success(await loadQuota(sql, userId), "Your proposal limit", 200, requestId);
    }

    if (intake) {
      const listing = (await sql<{ id: string; organization_id: string; status: string }[]>`SELECT id, organization_id, status FROM project_listings WHERE id = ${intake[1]} LIMIT 1`)[0];
      const org = listing ? await organizationForMember(sql, userId, listing.organization_id) : null;
      if (!listing || !org) return failure("NOT_FOUND", "Project not found", 404, requestId);
      if (method === "GET") return success({ ...(await intakeOf(sql, listing.id)), can_edit: canManageOrganization(org.membership_role) }, "Proposal intake", 200, requestId);
      if (!canManageOrganization(org.membership_role)) return failure("FORBIDDEN", "Only owners and admins of the client account can change this.", 403, requestId);
      const cols = await sql<{ name: string }[]>`SELECT column_name AS name FROM information_schema.columns WHERE table_name = 'project_listings' AND column_name = 'proposals_closed_at'`;
      if (!cols.length) return failure("MIGRATION_PENDING", "Proposal limits need database migration 0078.", 503, requestId);
      const v = validateIntake((await body(request)) ?? {});
      if (!v.ok) return failure("INVALID_INTAKE", "Check the highlighted fields.", 422, requestId, [v.errors]);
      const current = await intakeOf(sql, listing.id);
      if (v.value.accepting && v.value.max_proposals !== null && current.received >= v.value.max_proposals) {
        return failure("INVALID_INTAKE", "Check the highlighted fields.", 422, requestId, [{ max_proposals: `You already have ${current.received} proposals. Choose a higher limit, or stop taking proposals.` }]);
      }
      await sql`
        UPDATE project_listings
        SET max_proposals = ${v.value.max_proposals},
            proposals_closed_at = CASE WHEN ${v.value.accepting} THEN NULL ELSE COALESCE(proposals_closed_at, now()) END,
            updated_at = now()
        WHERE id = ${listing.id}
      `;
      return success({ ...(await intakeOf(sql, listing.id)), can_edit: true }, v.value.accepting ? "The project takes proposals." : "The project no longer takes new proposals.", 200, requestId);
    }

    if (!(await tableExists(sql, "marketplace_blocks"))) return failure("MIGRATION_PENDING", PENDING, 503, requestId);

    if (path === "/api/v1/me/blocks") {
      const rows = await sql<{ id: string; blocked_by: string; reason: string; created_at: Date; organization_name: string; freelancer_name: string | null }[]>`
        SELECT b.id, b.blocked_by, b.reason, b.created_at, o.name AS organization_name, p.full_name AS freelancer_name
        FROM marketplace_blocks b
        JOIN organizations o ON o.id = b.organization_id
        LEFT JOIN profiles p ON p.user_id = b.freelancer_user_id
        WHERE (b.blocked_by = 'freelancer' AND b.freelancer_user_id = ${userId})
           OR (b.blocked_by = 'client' AND EXISTS (
                SELECT 1 FROM organization_memberships m
                WHERE m.organization_id = b.organization_id AND m.user_id = ${userId} AND m.status = 'active' AND m.role IN ('owner', 'admin')))
        ORDER BY b.created_at DESC
        LIMIT 200
      `;
      return success(
        rows.map((r) => ({
          id: r.id,
          side: r.blocked_by,
          // What the person blocked: a client account (as freelancer) or a freelancer (for a client account).
          name: r.blocked_by === "freelancer" ? r.organization_name : (r.freelancer_name || "A freelancer"),
          for_account: r.blocked_by === "client" ? r.organization_name : null,
          reason: r.reason,
          created_at: new Date(r.created_at).toISOString()
        })),
        "Blocked",
        200,
        requestId
      );
    }

    if (remove) {
      const row = (await sql<{ id: string; blocked_by: string; freelancer_user_id: string; organization_id: string }[]>`
        SELECT id, blocked_by, freelancer_user_id, organization_id FROM marketplace_blocks WHERE id = ${remove[1]} LIMIT 1
      `)[0];
      let allowed = false;
      if (row?.blocked_by === "freelancer") allowed = row.freelancer_user_id === userId;
      else if (row?.blocked_by === "client") {
        const org = await organizationForMember(sql, userId, row.organization_id);
        allowed = Boolean(org && canManageOrganization(org.membership_role));
      }
      if (!row || !allowed) return failure("NOT_FOUND", "Block not found", 404, requestId);
      await sql`DELETE FROM marketplace_blocks WHERE id = ${row.id}`;
      return success({ id: row.id }, "Unblocked.", 200, requestId);
    }

    // POST /blocks
    const payload = (await body(request)) ?? {};
    const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
    if (reason.length > 500) return failure("INVALID_BLOCK", "Check the highlighted fields.", 422, requestId, [{ reason: "Keep the reason under 500 characters." }]);
    if (reason && screenText(reason).some((f) => f.code === "off_platform_contact")) {
      return failure("INVALID_BLOCK", "Check the highlighted fields.", 422, requestId, [{ reason: "Leave contact details out of the reason." }]);
    }
    const roles = await loadRoles(sql, userId);
    const target = await resolveTarget(sql, userId, roles, payload);
    if ("code" in target) return failure(target.code, target.message, target.status, requestId);

    const open = await sql`
      SELECT 1 FROM contracts WHERE freelancer_user_id = ${target.freelancer_user_id} AND organization_id = ${target.organization_id} AND status IN ('offered', 'active') LIMIT 1
    `;
    if (open.length) {
      return failure("CONTRACT_OPEN", "You have an open offer or contract with them. Finish or end it first, or use Report a problem on the contract.", 409, requestId);
    }

    const created = await sql.begin(async (tx) => {
      const rows = await tx<{ id: string }[]>`
        INSERT INTO marketplace_blocks (id, freelancer_user_id, organization_id, blocked_by, created_by_user_id, reason, created_at)
        VALUES (${crypto.randomUUID()}, ${target.freelancer_user_id}, ${target.organization_id}, ${target.side}, ${userId}, ${reason}, now())
        ON CONFLICT (freelancer_user_id, organization_id, blocked_by) DO NOTHING
        RETURNING id
      `;
      if (!rows[0]) return null;
      // Open proposals between them close: withdrawn by a freelancer's block, declined by a client's.
      const closed = await tx`
        UPDATE listing_proposals p SET status = ${target.side === "freelancer" ? "withdrawn" : "declined"}, updated_at = now()
        FROM project_listings l
        WHERE l.id = p.listing_id AND l.organization_id = ${target.organization_id}
          AND p.freelancer_user_id = ${target.freelancer_user_id} AND p.status IN ('submitted', 'shortlisted')
        RETURNING p.id
      `;
      const invitations = await tx`
        UPDATE listing_invitations i SET status = 'withdrawn', responded_at = COALESCE(i.responded_at, now())
        FROM project_listings l
        WHERE l.id = i.listing_id AND l.organization_id = ${target.organization_id}
          AND i.freelancer_user_id = ${target.freelancer_user_id} AND i.status = 'pending'
        RETURNING i.id
      `;
      return { id: rows[0].id, proposals_closed: closed.length, invitations_withdrawn: invitations.length };
    });
    if (!created) return failure("ALREADY_BLOCKED", "You already blocked them.", 409, requestId);
    return success(
      { ...created, side: target.side },
      target.side === "freelancer"
        ? "Blocked. You will not see this client's projects, and they cannot invite you or message you."
        : "Blocked. This freelancer cannot send proposals to your account, and you will not see them in matches.",
      201,
      requestId
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
