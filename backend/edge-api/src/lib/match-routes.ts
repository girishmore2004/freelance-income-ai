import type { Env } from "../types";
import { notifyUsers, organizationManagers } from "./notify";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database, textArray } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { FLAGS, isEnabled } from "./flags";
import { canManageOrganization, loadRoles, organizationForMember } from "./identity";
import { publicListingOut, screenText, versionOut } from "./listings";
import type { ListingRow, VersionRow } from "./listings";
import { listingFromJoined } from "./listing-routes";
import type { JoinedListingRow } from "./listing-routes";
import { freelancerCard, shortlist } from "./matching";
import type { CandidateRow, ListingForMatch } from "./matching";

/**
 * Two-sided discovery (Phase 2 batch 2):
 *
 * Freelancer
 *   GET  /api/v1/me/marketplace-profile                    opt-in state
 *   PUT  /api/v1/me/marketplace-profile {visible}          opt in / out of being suggested to clients
 *   GET  /api/v1/me/invitations                            invitations received
 *   POST /api/v1/me/invitations/{id}/respond {response}    accept | decline
 *
 * Client (client role + organisation membership; non-members get 404)
 *   GET  /api/v1/listings/{id}/matches                     Match and Shortlist agent (C2)
 *   GET  /api/v1/listings/{id}/invitations                 invitations sent for a listing
 *   POST /api/v1/listings/{id}/invitations {freelancer_user_id, message}   owner/admin
 *   POST /api/v1/listings/{id}/invitations/{inv}/withdraw  owner/admin
 *   GET  /api/v1/organizations/{org}/saved-freelancers
 *   POST /api/v1/organizations/{org}/saved-freelancers {freelancer_user_id, note}
 *   DELETE /api/v1/organizations/{org}/saved-freelancers/{freelancerUserId}
 *
 * Everything is behind `marketplace.client_side`. Clients only ever see
 * freelancers who opted in and hold an active freelancer role, and only the
 * fields in `freelancerCard` (no email, phone or links).
 */

export interface MatchRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
  now: () => Date;
}

const defaultDeps: MatchRouteDeps = { database, authenticate: authenticateRequest, now: () => new Date() };

const DISABLED = "The client marketplace is not open yet.";
const CANDIDATE_LIMIT = 500;
const MAX_INVITATIONS_PER_LISTING = 30;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_SAVED_PER_ORG = 200;
const INVITABLE_STATUSES = ["published", "hiring"];
const MATCHABLE_STATUSES = ["draft", "in_review", "published", "hiring", "paused"];

/** Freelancers clients may see: opted in, active freelancer role, not suspended. */
async function visibleCandidates(sql: Queryable, excludeOrganizationId: string): Promise<CandidateRow[]> {
  return sql<CandidateRow[]>`
    SELECT p.user_id, p.full_name, p.headline, p.skills, p.services, p.minimum_budget, p.hourly_rate,
           p.currency, p.weekly_hours, p.timezone, p.dealbreakers, u.created_at AS user_created_at, (to_jsonb(p)->>'verified_at') AS verified_at,
           rt.rating_avg, rt.rating_count
    FROM profiles p
    JOIN users u ON u.id = p.user_id
    JOIN user_roles r ON r.user_id = p.user_id AND r.role = 'freelancer' AND r.status = 'active'
    LEFT JOIN LATERAL (
      SELECT avg(rv.rating)::float AS rating_avg, count(*)::int AS rating_count
      FROM contract_reviews rv JOIN contracts ct ON ct.id = rv.contract_id
      WHERE ct.freelancer_user_id = p.user_id AND rv.reviewer_party = 'client'
        AND (ct.completed_at < now() - interval '14 days'
             OR EXISTS (SELECT 1 FROM contract_reviews rf WHERE rf.contract_id = ct.id AND rf.reviewer_party = 'freelancer'))
    ) rt ON true
    WHERE p.marketplace_visible = true
      AND NOT EXISTS (
        SELECT 1 FROM organization_memberships m
        WHERE m.organization_id = ${excludeOrganizationId} AND m.user_id = p.user_id
      )
    ORDER BY p.marketplace_visible_at DESC NULLS LAST, p.user_id
    LIMIT ${CANDIDATE_LIMIT}
  `;
}

export async function visibleCandidate(sql: Queryable, freelancerUserId: string): Promise<CandidateRow | null> {
  const rows = await sql<CandidateRow[]>`
    SELECT p.user_id, p.full_name, p.headline, p.skills, p.services, p.minimum_budget, p.hourly_rate,
           p.currency, p.weekly_hours, p.timezone, p.dealbreakers, u.created_at AS user_created_at, (to_jsonb(p)->>'verified_at') AS verified_at,
           rt.rating_avg, rt.rating_count
    FROM profiles p
    JOIN users u ON u.id = p.user_id
    JOIN user_roles r ON r.user_id = p.user_id AND r.role = 'freelancer' AND r.status = 'active'
    LEFT JOIN LATERAL (
      SELECT avg(rv.rating)::float AS rating_avg, count(*)::int AS rating_count
      FROM contract_reviews rv JOIN contracts ct ON ct.id = rv.contract_id
      WHERE ct.freelancer_user_id = p.user_id AND rv.reviewer_party = 'client'
        AND (ct.completed_at < now() - interval '14 days'
             OR EXISTS (SELECT 1 FROM contract_reviews rf WHERE rf.contract_id = ct.id AND rf.reviewer_party = 'freelancer'))
    ) rt ON true
    WHERE p.user_id = ${freelancerUserId} AND p.marketplace_visible = true
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Public freelancer directory: the same visibility rule as matching (opted in,
 * active freelancer role; suspension switches visibility off), searchable by
 * name, headline, skills or services, newest first, 24 per page.
 */
export async function publicFreelancerPage(sql: Queryable, q: string, offset: number): Promise<{ rows: (CandidateRow & { completed: number })[]; more: boolean }> {
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await sql<(CandidateRow & { completed: number })[]>`
    SELECT p.user_id, p.full_name, p.headline, p.skills, p.services, p.minimum_budget, p.hourly_rate,
           p.currency, p.weekly_hours, p.timezone, p.dealbreakers, u.created_at AS user_created_at, (to_jsonb(p)->>'verified_at') AS verified_at,
           rt.rating_avg, rt.rating_count,
           (SELECT count(*)::int FROM contracts ct WHERE ct.freelancer_user_id = p.user_id AND ct.status = 'completed') AS completed
    FROM profiles p
    JOIN users u ON u.id = p.user_id
    JOIN user_roles r ON r.user_id = p.user_id AND r.role = 'freelancer' AND r.status = 'active'
    LEFT JOIN LATERAL (
      SELECT avg(rv.rating)::float AS rating_avg, count(*)::int AS rating_count
      FROM contract_reviews rv JOIN contracts ct ON ct.id = rv.contract_id
      WHERE ct.freelancer_user_id = p.user_id AND rv.reviewer_party = 'client'
        AND (ct.completed_at < now() - interval '14 days'
             OR EXISTS (SELECT 1 FROM contract_reviews rf WHERE rf.contract_id = ct.id AND rf.reviewer_party = 'freelancer'))
    ) rt ON true
    WHERE p.marketplace_visible = true
      AND (${q} = '' OR p.full_name ILIKE ${pattern} OR p.headline ILIKE ${pattern} OR p.skills ILIKE ${pattern} OR p.services ILIKE ${pattern})
    ORDER BY p.marketplace_visible_at DESC NULLS LAST, p.user_id
    LIMIT 25 OFFSET ${offset}
  `;
  return { rows: rows.slice(0, 24), more: rows.length > 24 };
}

interface InvitationRow {
  id: string;
  listing_id: string;
  freelancer_user_id: string;
  invited_by: string | null;
  message: string;
  match_score: number | null;
  status: string;
  created_at: Date;
  responded_at: Date | null;
}

function invitationOut(row: InvitationRow) {
  return {
    id: row.id,
    listing_id: row.listing_id,
    freelancer_user_id: row.freelancer_user_id,
    message: row.message,
    match_score: row.match_score,
    status: row.status,
    created_at: new Date(row.created_at).toISOString(),
    responded_at: row.responded_at ? new Date(row.responded_at).toISOString() : null
  };
}

function parseJsonList(value: string): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function idParam(value: unknown): string | null {
  return typeof value === "string" && /^[\w-]{1,64}$/.test(value) ? value : null;
}

/** Marks open listings whose closing date has passed as expired. Run by the 6-hourly cron. */
export async function expireDueListings(env: Env, sql: Queryable): Promise<number> {
  if (!(await isEnabled(env, sql, FLAGS.clientMarketplace, false))) return 0;
  const rows = await sql<{ id: string }[]>`
    UPDATE project_listings SET status = 'expired', updated_at = now()
    WHERE status IN ('published', 'hiring', 'paused') AND closes_at IS NOT NULL AND closes_at <= now()
    RETURNING id
  `;
  return rows.length;
}

export async function runScheduledListingExpiry(env: Env): Promise<void> {
  const sql = database(env);
  try {
    const expired = await expireDueListings(env, sql);
    if (expired) console.log(JSON.stringify({ service: "freelance-income-ai-api-edge", event: "listings.expired", count: expired }));
  } catch (error) {
    console.warn(JSON.stringify({ service: "freelance-income-ai-api-edge", event: "listings.expiry_failed", error: error instanceof Error ? error.message : "unknown" }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function handleMatchRoute(
  request: Request,
  env: Env,
  requestId: string,
  deps: MatchRouteDeps = defaultDeps
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  const meProfile = path === "/api/v1/me/marketplace-profile";
  const meInvitations = path === "/api/v1/me/invitations";
  const meRespond = path.match(/^\/api\/v1\/me\/invitations\/([\w-]{1,64})\/respond$/);
  const listingMatches = path.match(/^\/api\/v1\/listings\/([\w-]{1,64})\/matches$/);
  const listingInvites = path.match(/^\/api\/v1\/listings\/([\w-]{1,64})\/invitations$/);
  const listingWithdraw = path.match(/^\/api\/v1\/listings\/([\w-]{1,64})\/invitations\/([\w-]{1,64})\/withdraw$/);
  const saved = path.match(/^\/api\/v1\/organizations\/([\w-]{1,64})\/saved-freelancers(?:\/([\w-]{1,64}))?$/);

  const known =
    (meProfile && (method === "GET" || method === "PUT")) ||
    (meInvitations && method === "GET") ||
    (meRespond !== null && method === "POST") ||
    (listingMatches !== null && method === "GET") ||
    (listingInvites !== null && (method === "GET" || method === "POST")) ||
    (listingWithdraw !== null && method === "POST") ||
    (saved !== null && (saved[2] ? method === "DELETE" : method === "GET" || method === "POST"));
  if (!known) return null;

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);

  try {
    if (!(await isEnabled(env, sql, FLAGS.clientMarketplace, false))) {
      return failure("FEATURE_DISABLED", DISABLED, 403, requestId);
    }
    const roles = await loadRoles(sql, userId);

    // ---------------- freelancer side ----------------
    if (meProfile) {
      const rows = await sql<{ full_name: string; skills: string; marketplace_visible: boolean; marketplace_visible_at: Date | null }[]>`
        SELECT full_name, skills, marketplace_visible, marketplace_visible_at FROM profiles WHERE user_id = ${userId} LIMIT 1
      `;
      const profile = rows[0];
      const complete = Boolean(profile && profile.full_name.trim() && parseJsonList(profile.skills).length);

      if (method === "PUT") {
        const payload = (await body(request)) ?? {};
        if (typeof payload.visible !== "boolean") return failure("INVALID_VISIBILITY", "visible must be true or false.", 422, requestId);
        if (payload.visible) {
          if (!roles.includes("freelancer")) return failure("FREELANCER_ROLE_REQUIRED", "Turn on the freelancer role first.", 403, requestId);
          if (!complete) return failure("PROFILE_INCOMPLETE", "Add your name and at least one skill to your profile first.", 422, requestId);
        }
        if (profile) {
          await sql`
            UPDATE profiles SET marketplace_visible = ${payload.visible},
              marketplace_visible_at = ${payload.visible ? deps.now().toISOString() : null}
            WHERE user_id = ${userId}
          `;
        }
        return success(
          { visible: payload.visible, profile_complete: complete, has_freelancer_role: roles.includes("freelancer") },
          payload.visible ? "Clients can now find you in project matches" : "You are hidden from client matches",
          200,
          requestId
        );
      }
      return success(
        {
          visible: Boolean(profile?.marketplace_visible),
          visible_since: profile?.marketplace_visible_at ? new Date(profile.marketplace_visible_at).toISOString() : null,
          profile_complete: complete,
          has_freelancer_role: roles.includes("freelancer")
        },
        "Marketplace profile",
        200,
        requestId
      );
    }

    if (meInvitations) {
      const rows = await sql<(Omit<InvitationRow, "created_at"> & JoinedListingRow & { invitation_created_at: Date; v_created_at: Date; client_name: string })[]>`
        SELECT i.id, i.listing_id, i.freelancer_user_id, i.invited_by, i.message, i.match_score, i.status, i.created_at AS invitation_created_at, i.responded_at,
               (SELECT pp.id FROM listing_proposals pp WHERE pp.listing_id = i.listing_id AND pp.freelancer_user_id = i.freelancer_user_id AND pp.status <> 'withdrawn' LIMIT 1) AS my_proposal_id,
               l.id AS l_id, l.organization_id AS l_organization_id, l.category_slug AS l_category_slug, l.status AS l_status,
               l.visibility AS l_visibility, l.moderation_status AS l_moderation_status, l.moderation_notes AS l_moderation_notes,
               l.current_version AS l_current_version, l.published_at AS l_published_at, l.closes_at AS l_closes_at,
               l.created_at AS l_created_at, l.updated_at AS l_updated_at,
               v.version, v.title, v.category_slug, v.outcome, v.description, v.deliverables_json, v.skills_json,
               v.experience_level, v.budget_model, v.budget_min_minor, v.budget_max_minor, v.currency, v.deadline,
               v.milestones_json, v.acceptance_json, v.revision_rounds, v.languages_json, v.timezone, v.confidentiality,
               v.ownership_notes, v.assumptions_json, v.content_hash, v.created_at AS v_created_at, o.name AS client_name, (to_jsonb(o)->>'verified_at') AS client_verified_at
        FROM listing_invitations i
        JOIN project_listings l ON l.id = i.listing_id
        JOIN project_listing_versions v ON v.listing_id = l.id AND v.version = l.current_version
        JOIN organizations o ON o.id = l.organization_id
        WHERE i.freelancer_user_id = ${userId} AND i.status <> 'withdrawn'
        ORDER BY i.created_at DESC
        LIMIT 100
      `;
      const items = rows.map((row) => {
        const listing = listingFromJoined(row);
        const version: VersionRow = { ...row, created_at: row.v_created_at };
        return {
          ...invitationOut({ ...row, created_at: row.invitation_created_at }),
          listing_status: listing.status,
          // K-24: once the freelancer has proposed, the invitation points to that proposal instead of offering a second one.
          my_proposal_id: (row as { my_proposal_id?: string | null }).my_proposal_id ?? null,
          project: publicListingOut(listing, version, row.client_name ?? "", row.client_verified_at ?? null)
        };
      });
      return success(items, "Invitations", 200, requestId);
    }

    if (meRespond) {
      const payload = (await body(request)) ?? {};
      const response = payload.response;
      if (response !== "accept" && response !== "decline") return failure("INVALID_RESPONSE", "Response must be accept or decline.", 422, requestId);
      const result = await sql.begin(async (tx) => {
        const rows = await tx<(InvitationRow & { listing_status: string })[]>`
          SELECT i.*, l.status AS listing_status FROM listing_invitations i JOIN project_listings l ON l.id = i.listing_id
          WHERE i.id = ${meRespond[1]} AND i.freelancer_user_id = ${userId}
          FOR UPDATE OF i
        `;
        const invitation = rows[0];
        if (!invitation || invitation.status === "withdrawn") return { code: "NOT_FOUND" as const };
        if (invitation.status !== "pending") return { code: "ALREADY_ANSWERED" as const, status: invitation.status };
        if (response === "accept" && !INVITABLE_STATUSES.includes(invitation.listing_status)) return { code: "LISTING_CLOSED" as const };
        const status = response === "accept" ? "accepted" : "declined";
        await tx`UPDATE listing_invitations SET status = ${status}, responded_at = now() WHERE id = ${invitation.id}`;
        return { code: "OK" as const, invitation: { ...invitation, status, responded_at: new Date() } };
      });
      if (result.code === "NOT_FOUND") return failure("NOT_FOUND", "Invitation not found", 404, requestId);
      if (result.code === "ALREADY_ANSWERED") return failure("ALREADY_ANSWERED", `You already ${result.status} this invitation.`, 409, requestId);
      if (result.code === "LISTING_CLOSED") return failure("LISTING_CLOSED", "This project is no longer taking proposals.", 409, requestId);
      const invitedListing = (await sql<{ organization_id: string }[]>`SELECT organization_id FROM project_listings WHERE id = ${result.invitation.listing_id} LIMIT 1`)[0];
      if (invitedListing) {
        await notifyUsers(sql, await organizationManagers(sql, invitedListing.organization_id), {
          kind: `invitation.${response === "accept" ? "accepted" : "declined"}`,
          title: response === "accept" ? "A freelancer accepted your invitation" : "A freelancer declined your invitation",
          message: response === "accept" ? "Their proposal will appear under Proposals." : "You can invite someone else from Find freelancers.",
          link: "/client/projects",
          dedupe: `invitation-response:${result.invitation.id}`
        });
      }
      return success(
        invitationOut(result.invitation),
        response === "accept" ? "Invitation accepted. You can now send a proposal for this project." : "Invitation declined",
        200,
        requestId
      );
    }

    // ---------------- client side ----------------
    if (!roles.includes("client")) {
      return failure("CLIENT_ROLE_REQUIRED", "Turn on the client (hiring) role first.", 403, requestId);
    }

    if (saved) {
      const org = await organizationForMember(sql, userId, saved[1]);
      if (!org) return failure("NOT_FOUND", "Organisation not found", 404, requestId);

      if (method === "DELETE") {
        await sql`DELETE FROM saved_freelancers WHERE organization_id = ${org.id} AND freelancer_user_id = ${saved[2]!}`;
        return success({ freelancer_user_id: saved[2] }, "Removed from saved freelancers", 200, requestId);
      }

      if (method === "POST") {
        const payload = (await body(request)) ?? {};
        const freelancerId = idParam(payload.freelancer_user_id);
        if (!freelancerId) return failure("INVALID_FREELANCER", "Choose a freelancer.", 422, requestId);
        const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 300) : "";
        const candidate = await visibleCandidate(sql, freelancerId);
        if (!candidate) return failure("NOT_FOUND", "Freelancer not found", 404, requestId);
        const count = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM saved_freelancers WHERE organization_id = ${org.id}`;
        if ((count[0]?.n ?? 0) >= MAX_SAVED_PER_ORG) return failure("LIMIT_REACHED", `You can save up to ${MAX_SAVED_PER_ORG} freelancers.`, 409, requestId);
        await sql`
          INSERT INTO saved_freelancers (id, organization_id, freelancer_user_id, saved_by, note, created_at)
          VALUES (${crypto.randomUUID()}, ${org.id}, ${freelancerId}, ${userId}, ${note}, now())
          ON CONFLICT (organization_id, freelancer_user_id) DO UPDATE SET note = EXCLUDED.note
        `;
        return success({ freelancer: freelancerCard(candidate, deps.now()), note }, "Saved", 201, requestId);
      }

      const rows = await sql<(CandidateRow & { note: string; saved_at: Date })[]>`
        SELECT p.user_id, p.full_name, p.headline, p.skills, p.services, p.minimum_budget, p.hourly_rate,
               p.currency, p.weekly_hours, p.timezone, p.dealbreakers, u.created_at AS user_created_at, (to_jsonb(p)->>'verified_at') AS verified_at,
               s.note, s.created_at AS saved_at
        FROM saved_freelancers s
        JOIN profiles p ON p.user_id = s.freelancer_user_id
        JOIN users u ON u.id = s.freelancer_user_id
        JOIN user_roles r ON r.user_id = s.freelancer_user_id AND r.role = 'freelancer' AND r.status = 'active'
        WHERE s.organization_id = ${org.id} AND p.marketplace_visible = true
        ORDER BY s.created_at DESC
        LIMIT ${MAX_SAVED_PER_ORG}
      `;
      const now = deps.now();
      return success(
        rows.map((row) => ({ freelancer: freelancerCard(row, now), note: row.note, saved_at: new Date(row.saved_at).toISOString() })),
        "Saved freelancers",
        200,
        requestId
      );
    }

    const listingId = (listingMatches ?? listingInvites ?? listingWithdraw)![1];
    const listing = (await sql<ListingRow[]>`SELECT * FROM project_listings WHERE id = ${listingId} LIMIT 1`)[0];
    const org = listing ? await organizationForMember(sql, userId, listing.organization_id) : null;
    if (!listing || !org) return failure("NOT_FOUND", "Listing not found", 404, requestId);

    if (listingMatches) {
      if (!MATCHABLE_STATUSES.includes(listing.status)) {
        return failure("LISTING_CLOSED", "Matches are only available for open listings.", 409, requestId);
      }
      const version = (await sql<VersionRow[]>`
        SELECT * FROM project_listing_versions WHERE listing_id = ${listing.id} AND version = ${listing.current_version} LIMIT 1
      `)[0];
      if (!version) return failure("NOT_FOUND", "Listing not found", 404, requestId);
      const category = (await sql<{ name: string }[]>`SELECT name FROM project_categories WHERE slug = ${listing.category_slug} LIMIT 1`)[0];
      const brief = versionOut(version);
      const target: ListingForMatch = {
        title: brief.title,
        outcome: brief.outcome,
        description: brief.description,
        category_slug: listing.category_slug,
        category_name: category?.name ?? listing.category_slug,
        skills: brief.skills,
        budget_model: brief.budget_model,
        budget_min_minor: brief.budget_min_minor,
        budget_max_minor: brief.budget_max_minor,
        currency: brief.currency,
        timezone: brief.timezone
      };
      const now = deps.now();
      const candidates = await visibleCandidates(sql, org.id);
      const matches = shortlist(target, candidates, now);
      const ids = matches.map((m) => m.freelancer.user_id);
      const invited = ids.length
        ? await sql<{ freelancer_user_id: string; status: string }[]>`
            SELECT freelancer_user_id, status FROM listing_invitations WHERE listing_id = ${listing.id} AND freelancer_user_id = ANY(${textArray(ids)}::text[])
          `
        : [];
      const savedRows = ids.length
        ? await sql<{ freelancer_user_id: string }[]>`
            SELECT freelancer_user_id FROM saved_freelancers WHERE organization_id = ${org.id} AND freelancer_user_id = ANY(${textArray(ids)}::text[])
          `
        : [];
      const invitedMap = new Map(invited.map((r) => [r.freelancer_user_id, r.status]));
      const savedSet = new Set(savedRows.map((r) => r.freelancer_user_id));
      await sql`
        INSERT INTO agent_runs (id, user_id, agent_name, status, summary, created_at)
        VALUES (${crypto.randomUUID()}, ${userId}, 'match_shortlist', 'completed',
                ${`Ranked ${candidates.length} visible freelancers for listing ${listing.id}; shortlisted ${matches.length}`}, now())
      `;
      return success(
        {
          listing_id: listing.id,
          candidates_considered: candidates.length,
          method: "deterministic",
          matches: matches.map((m) => ({ ...m, invitation_status: invitedMap.get(m.freelancer.user_id) ?? null, saved: savedSet.has(m.freelancer.user_id) }))
        },
        matches.length ? "Suggested freelancers" : "No visible freelancers match this listing yet",
        200,
        requestId
      );
    }

    if (listingInvites && method === "GET") {
      const rows = await sql<(InvitationRow & CandidateRow)[]>`
        SELECT i.*, p.full_name, p.headline, p.skills, p.services, p.minimum_budget, p.hourly_rate,
               p.currency, p.weekly_hours, p.timezone, p.dealbreakers, p.user_id, u.created_at AS user_created_at, (to_jsonb(p)->>'verified_at') AS verified_at
        FROM listing_invitations i
        JOIN users u ON u.id = i.freelancer_user_id
        LEFT JOIN profiles p ON p.user_id = i.freelancer_user_id
        WHERE i.listing_id = ${listing.id}
        ORDER BY i.created_at DESC
        LIMIT 100
      `;
      const now = deps.now();
      return success(
        rows.map((row) => ({
          ...invitationOut(row),
          freelancer: freelancerCard({ ...row, user_id: row.freelancer_user_id, full_name: row.full_name ?? "", headline: row.headline ?? "", skills: row.skills ?? "[]", services: row.services ?? "[]", currency: row.currency ?? "INR", timezone: row.timezone ?? "", dealbreakers: "[]" }, now)
        })),
        "Invitations",
        200,
        requestId
      );
    }

    // Invitation changes need owner/admin.
    if (!canManageOrganization(org.membership_role)) {
      return failure("FORBIDDEN", "Only owners and admins can invite freelancers.", 403, requestId);
    }

    if (listingWithdraw) {
      const rows = await sql<InvitationRow[]>`
        UPDATE listing_invitations SET status = 'withdrawn', responded_at = now()
        WHERE id = ${listingWithdraw[2]} AND listing_id = ${listing.id} AND status IN ('pending', 'accepted')
        RETURNING *
      `;
      if (!rows[0]) return failure("NOT_FOUND", "Open invitation not found", 404, requestId);
      return success(invitationOut(rows[0]), "Invitation withdrawn", 200, requestId);
    }

    // POST invitation
    if (!INVITABLE_STATUSES.includes(listing.status)) {
      return failure("LISTING_NOT_OPEN", "Publish the listing before inviting freelancers.", 409, requestId);
    }
    if (listing.visibility === "private") {
      return failure("LISTING_PRIVATE", "Make the listing public or invite-only to invite freelancers.", 409, requestId);
    }
    const payload = (await body(request)) ?? {};
    const freelancerId = idParam(payload.freelancer_user_id);
    if (!freelancerId) return failure("INVALID_FREELANCER", "Choose a freelancer.", 422, requestId);
    if (freelancerId === userId) return failure("INVALID_FREELANCER", "You cannot invite yourself.", 422, requestId);
    const message = typeof payload.message === "string" ? payload.message.trim() : "";
    if (message.length > MAX_MESSAGE_LENGTH) return failure("MESSAGE_TOO_LONG", `Keep the message under ${MAX_MESSAGE_LENGTH} characters.`, 422, requestId);
    const findings = screenText(message);
    if (findings.length) {
      return failure(
        "MESSAGE_NOT_ALLOWED",
        "Keep contact and payment on the platform: remove phone numbers, emails, messaging apps or payment requests from the message.",
        422,
        requestId,
        [{ codes: findings.map((f) => f.code) }]
      );
    }
    // U14 "Hire again": a freelancer this client account completed a contract with can be
    // invited even when they are not listed in discovery (still not if suspended or not a freelancer).
    const candidate = (await visibleCandidate(sql, freelancerId)) ?? (await pastCollaborator(sql, freelancerId, org.id));
    if (!candidate) return failure("NOT_FOUND", "Freelancer not found", 404, requestId);
    const score = typeof payload.match_score === "number" && Number.isInteger(payload.match_score) && payload.match_score >= 0 && payload.match_score <= 100 ? payload.match_score : null;

    const result = await sql.begin(async (tx) => {
      await tx`SELECT id FROM project_listings WHERE id = ${listing.id} FOR UPDATE`;
      const count = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM listing_invitations WHERE listing_id = ${listing.id} AND status <> 'withdrawn'
      `;
      if ((count[0]?.n ?? 0) >= MAX_INVITATIONS_PER_LISTING) return { code: "LIMIT" as const };
      const rows = await tx<InvitationRow[]>`
        INSERT INTO listing_invitations (id, listing_id, freelancer_user_id, invited_by, message, match_score, status, created_at)
        VALUES (${crypto.randomUUID()}, ${listing.id}, ${freelancerId}, ${userId}, ${message}, ${score}, 'pending', now())
        ON CONFLICT (listing_id, freelancer_user_id) DO UPDATE
          SET status = 'pending', message = EXCLUDED.message, match_score = EXCLUDED.match_score,
              invited_by = EXCLUDED.invited_by, created_at = now(), responded_at = NULL
          WHERE listing_invitations.status = 'withdrawn'
        RETURNING *
      `;
      return rows[0] ? { code: "OK" as const, invitation: rows[0] } : { code: "DUPLICATE" as const };
    });
    if (result.code === "LIMIT") {
      return failure("LIMIT_REACHED", `A listing can have at most ${MAX_INVITATIONS_PER_LISTING} invitations.`, 409, requestId);
    }
    if (result.code === "DUPLICATE") return failure("ALREADY_INVITED", "This freelancer has already been invited.", 409, requestId);
    await notifyUsers(sql, [freelancerId], {
      kind: "invitation.received",
      title: `${org.name} invited you to propose on a project`,
      message: message || "Open Projects to see the invitation.",
      link: "/projects",
      dedupe: `invitation:${result.invitation.id}:${new Date(result.invitation.created_at).getTime()}`
    });
    return success(
      { ...invitationOut(result.invitation), freelancer: freelancerCard(candidate, deps.now()) },
      "Invitation sent",
      201,
      requestId
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** A freelancer who completed a contract with this organisation; null if suspended or no longer a freelancer. */
export async function pastCollaborator(sql: Queryable, freelancerUserId: string, organizationId: string): Promise<CandidateRow | null> {
  const rows = await sql<CandidateRow[]>`
    SELECT p.user_id, p.full_name, p.headline, p.skills, p.services, p.minimum_budget, p.hourly_rate,
           p.currency, p.weekly_hours, p.timezone, p.dealbreakers, u.created_at AS user_created_at, (to_jsonb(p)->>'verified_at') AS verified_at
    FROM profiles p
    JOIN users u ON u.id = p.user_id
    JOIN user_roles r ON r.user_id = p.user_id AND r.role = 'freelancer' AND r.status = 'active'
    WHERE p.user_id = ${freelancerUserId} AND (to_jsonb(u)->>'suspended_at') IS NULL
      AND EXISTS (SELECT 1 FROM contracts c WHERE c.organization_id = ${organizationId} AND c.freelancer_user_id = p.user_id AND c.status = 'completed')
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Exposed for tests. */
export const MATCH_LIMITS = { CANDIDATE_LIMIT, MAX_INVITATIONS_PER_LISTING, MAX_MESSAGE_LENGTH, MAX_SAVED_PER_ORG };