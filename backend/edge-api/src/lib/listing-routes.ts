import type { Env } from "../types";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { FLAGS, isEnabled } from "./flags";
import { canManageOrganization, loadRoles, organizationForMember } from "./identity";
import { buildBrief } from "./brief-builder";
import type { CategoryTemplate } from "./brief-builder";
import {
  EDITABLE_STATUSES,
  briefHash,
  canTransition,
  isListingAction,
  listingOut,
  nextStatus,
  parseClosesAt,
  publicListingOut,
  publicationGaps,
  screenBrief,
  validateBrief
} from "./listings";
import type { Brief, ListingRow, VersionRow } from "./listings";

/**
 * Native project listings (Phase 2):
 *
 *   GET  /api/v1/project-categories                         enabled categories + templates
 *   POST /api/v1/organizations/{org}/brief-assistant        AI Brief Builder draft (not stored)
 *   GET  /api/v1/organizations/{org}/listings               the organisation's listings
 *   POST /api/v1/organizations/{org}/listings               create a draft (version 1)
 *   GET  /api/v1/listings/{id}                              member view with version history
 *   PUT  /api/v1/listings/{id}        {base_version, ...}   edit → new immutable version
 *   POST /api/v1/listings/{id}/transition {action}          submit | pause | resume | close | cancel
 *   GET  /api/v1/marketplace/listings?category=&q=&before=  published public listings
 *   GET  /api/v1/marketplace/listings/{id}                  one published public listing
 *
 * All behind the `marketplace.client_side` flag. Organisation endpoints need
 * the client role and an active membership (non-members get 404); state
 * changes need owner/admin. The marketplace needs any signed-in account.
 */

export interface ListingRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
  buildBrief: typeof buildBrief;
}

const defaultDeps: ListingRouteDeps = { database, authenticate: authenticateRequest, buildBrief };

const DISABLED = "The client marketplace is not open yet.";
const PAGE_SIZE = 20;

/** Listing columns are selected under l_* aliases so they never collide with version columns. */
export type JoinedListingRow = VersionRow & {
  l_id: string;
  l_organization_id: string;
  l_category_slug: string;
  l_status: string;
  l_visibility: string;
  l_moderation_status: string;
  l_moderation_notes: string;
  l_current_version: number;
  l_published_at: Date | null;
  l_closes_at: Date | null;
  l_created_at: Date;
  l_updated_at: Date;
  client_name?: string;
  client_verified_at?: string | null;
};
type JoinedRow = JoinedListingRow;

export function listingFromJoined(row: JoinedRow): ListingRow {
  return {
    id: row.l_id,
    organization_id: row.l_organization_id,
    category_slug: row.l_category_slug,
    status: row.l_status,
    visibility: row.l_visibility,
    moderation_status: row.l_moderation_status,
    moderation_notes: row.l_moderation_notes,
    current_version: row.l_current_version,
    published_at: row.l_published_at,
    closes_at: row.l_closes_at,
    created_at: row.l_created_at,
    updated_at: row.l_updated_at
  };
}

interface CategoryRow {
  slug: string;
  name: string;
  description: string;
  template_json: string;
}

function parseTemplate(value: string): CategoryTemplate {
  try {
    const t = JSON.parse(value || "{}") as Partial<CategoryTemplate>;
    return {
      inputs: Array.isArray(t.inputs) ? t.inputs.map(String) : [],
      stages: Array.isArray(t.stages) ? t.stages.map(String) : [],
      acceptance: Array.isArray(t.acceptance) ? t.acceptance.map(String) : [],
      default_revisions: Number.isInteger(t.default_revisions) ? Number(t.default_revisions) : 2
    };
  } catch {
    return { inputs: [], stages: [], acceptance: [], default_revisions: 2 };
  }
}

async function enabledCategories(sql: Queryable): Promise<CategoryRow[]> {
  return sql<CategoryRow[]>`SELECT slug, name, description, template_json FROM project_categories WHERE enabled = true ORDER BY sort_order, name`;
}

async function insertVersion(tx: Queryable, listingId: string, version: number, brief: Brief, hash: string, userId: string): Promise<void> {
  await tx`
    INSERT INTO project_listing_versions
      (id, listing_id, version, title, category_slug, outcome, description, deliverables_json, skills_json,
       experience_level, budget_model, budget_min_minor, budget_max_minor, currency, deadline, milestones_json,
       acceptance_json, revision_rounds, languages_json, timezone, confidentiality, ownership_notes,
       assumptions_json, content_hash, created_by, created_at)
    VALUES
      (${crypto.randomUUID()}, ${listingId}, ${version}, ${brief.title}, ${brief.category_slug}, ${brief.outcome},
       ${brief.description}, ${JSON.stringify(brief.deliverables)}, ${JSON.stringify(brief.skills)},
       ${brief.experience_level}, ${brief.budget_model}, ${brief.budget_min_minor}, ${brief.budget_max_minor},
       ${brief.currency}, ${brief.deadline}, ${JSON.stringify(brief.milestones)}, ${JSON.stringify(brief.acceptance_criteria)},
       ${brief.revision_rounds}, ${JSON.stringify(brief.languages)}, ${brief.timezone}, ${brief.confidentiality},
       ${brief.ownership_notes}, ${JSON.stringify(brief.assumptions)}, ${hash}, ${userId}, now())
  `;
}

async function currentVersion(sql: Queryable, listing: ListingRow): Promise<VersionRow | null> {
  const rows = await sql<VersionRow[]>`
    SELECT * FROM project_listing_versions WHERE listing_id = ${listing.id} AND version = ${listing.current_version} LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Rebuilds a Brief from a stored version (used when submitting). */
function briefFromVersion(v: VersionRow, visibility: string): Brief {
  const out = JSON.parse(JSON.stringify({ ...v })) as VersionRow;
  const list = (s: string) => {
    try {
      const p = JSON.parse(s || "[]");
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  };
  return {
    title: out.title,
    category_slug: out.category_slug,
    outcome: out.outcome,
    description: out.description,
    deliverables: list(out.deliverables_json),
    skills: list(out.skills_json),
    experience_level: out.experience_level as Brief["experience_level"],
    budget_model: out.budget_model as Brief["budget_model"],
    budget_min_minor: out.budget_min_minor === null ? null : Number(out.budget_min_minor),
    budget_max_minor: out.budget_max_minor === null ? null : Number(out.budget_max_minor),
    currency: out.currency,
    deadline: out.deadline ? String(out.deadline).slice(0, 10) : null,
    milestones: list(out.milestones_json),
    acceptance_criteria: list(out.acceptance_json),
    revision_rounds: out.revision_rounds,
    languages: list(out.languages_json),
    timezone: out.timezone,
    confidentiality: out.confidentiality as Brief["confidentiality"],
    ownership_notes: out.ownership_notes,
    assumptions: list(out.assumptions_json),
    visibility: visibility as Brief["visibility"]
  };
}

export async function handleListingRoute(
  request: Request,
  env: Env,
  requestId: string,
  deps: ListingRouteDeps = defaultDeps
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  const orgListings = path.match(/^\/api\/v1\/organizations\/([\w-]{1,64})\/listings$/);
  const orgAssist = path.match(/^\/api\/v1\/organizations\/([\w-]{1,64})\/brief-assistant$/);
  const listingMatch = path.match(/^\/api\/v1\/listings\/([\w-]{1,64})(\/transition)?$/);
  const marketMatch = path.match(/^\/api\/v1\/marketplace\/listings(?:\/([\w-]{1,64}))?$/);

  const known =
    (method === "GET" && path === "/api/v1/project-categories") ||
    (orgAssist !== null && method === "POST") ||
    (orgListings !== null && (method === "GET" || method === "POST")) ||
    (listingMatch !== null && ((!listingMatch[2] && (method === "GET" || method === "PUT")) || (listingMatch[2] !== undefined && method === "POST"))) ||
    (marketMatch !== null && method === "GET");
  if (!known) return null;

  // Visitors may browse published public projects and categories (spec §2); everything else needs a session.
  const publicRead = method === "GET" && (marketMatch !== null || path === "/api/v1/project-categories");
  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response && !(publicRead && auth.status === 401)) return auth;
  const viewerId: string | null = auth instanceof Response ? null : auth.user.id;
  const sql = deps.database(env);

  try {
    if (!(await isEnabled(env, sql, FLAGS.clientMarketplace, false))) {
      return failure("FEATURE_DISABLED", DISABLED, 403, requestId);
    }

    // ---------------- categories ----------------
    if (path === "/api/v1/project-categories") {
      const rows = await enabledCategories(sql);
      return success(rows.map((c) => ({ slug: c.slug, name: c.name, description: c.description, template: parseTemplate(c.template_json) })), "Categories", 200, requestId);
    }

    // ---------------- marketplace (freelancer view) ----------------
    if (marketMatch) {
      if (marketMatch[1]) {
        const rows = await sql<JoinedRow[]>`
          SELECT l.id AS l_id, l.organization_id AS l_organization_id, l.category_slug AS l_category_slug, l.status AS l_status, l.visibility AS l_visibility, l.moderation_status AS l_moderation_status, l.moderation_notes AS l_moderation_notes, l.current_version AS l_current_version, l.published_at AS l_published_at, l.closes_at AS l_closes_at, l.created_at AS l_created_at, l.updated_at AS l_updated_at, v.*, o.name AS client_name, (to_jsonb(o)->>'verified_at') AS client_verified_at
          FROM project_listings l
          JOIN project_listing_versions v ON v.listing_id = l.id AND v.version = l.current_version
          JOIN organizations o ON o.id = l.organization_id
          WHERE l.id = ${marketMatch[1]} AND l.status IN ('published', 'hiring')
            AND (l.visibility = 'public' OR EXISTS (
              SELECT 1 FROM listing_invitations i
              WHERE i.listing_id = l.id AND i.freelancer_user_id = ${viewerId} AND i.status IN ('pending', 'accepted')
            ))
            AND (l.closes_at IS NULL OR l.closes_at > now()) AND o.status = 'active'
          LIMIT 1
        `;
        if (!rows[0]) return failure("NOT_FOUND", "Project not found", 404, requestId);
        const row = rows[0];
        return success(publicListingOut(listingFromJoined(row), row, row.client_name ?? "", row.client_verified_at ?? null), "Project", 200, requestId);
      }

      const category = (url.searchParams.get("category") ?? "").slice(0, 60);
      const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
      const before = url.searchParams.get("before");
      const beforeDate = before && !Number.isNaN(Date.parse(before)) ? new Date(before) : null;
      const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const rows = await sql<JoinedRow[]>`
        SELECT l.id AS l_id, l.organization_id AS l_organization_id, l.category_slug AS l_category_slug, l.status AS l_status, l.visibility AS l_visibility, l.moderation_status AS l_moderation_status, l.moderation_notes AS l_moderation_notes, l.current_version AS l_current_version, l.published_at AS l_published_at, l.closes_at AS l_closes_at, l.created_at AS l_created_at, l.updated_at AS l_updated_at, v.*, o.name AS client_name, (to_jsonb(o)->>'verified_at') AS client_verified_at
        FROM project_listings l
        JOIN project_listing_versions v ON v.listing_id = l.id AND v.version = l.current_version
        JOIN organizations o ON o.id = l.organization_id
        WHERE l.status = 'published' AND l.visibility = 'public'
          AND (l.closes_at IS NULL OR l.closes_at > now()) AND o.status = 'active'
          AND (${category} = '' OR l.category_slug = ${category})
          AND (${q} = '' OR v.title ILIKE ${pattern} OR v.outcome ILIKE ${pattern})
          AND (${beforeDate}::timestamptz IS NULL OR l.published_at < ${beforeDate})
        ORDER BY l.published_at DESC
        LIMIT ${PAGE_SIZE + 1}
      `;
      const page = rows.slice(0, PAGE_SIZE).map((row) => publicListingOut(listingFromJoined(row), row, row.client_name ?? "", row.client_verified_at ?? null));
      const next = rows.length > PAGE_SIZE ? page[page.length - 1]?.published_at ?? null : null;
      return success({ items: page, next_before: next }, "Projects", 200, requestId);
    }

    // Everything below is the client side and needs a session.
    if (!viewerId) return failure("AUTHENTICATION_REQUIRED", "Authentication required", 401, requestId);
    const userId: string = viewerId;
    const roles = await loadRoles(sql, userId);
    if (!roles.includes("client")) {
      return failure("CLIENT_ROLE_REQUIRED", "Turn on the client (hiring) role first.", 403, requestId);
    }

    // ---------------- brief assistant ----------------
    if (orgAssist) {
      const org = await organizationForMember(sql, userId, orgAssist[1]);
      if (!org) return failure("NOT_FOUND", "Organisation not found", 404, requestId);
      const payload = (await body(request)) ?? {};
      const notes = typeof payload.notes === "string" ? payload.notes : "";
      if (notes.trim().length < 20) return failure("NOTES_TOO_SHORT", "Describe the project in at least 20 characters.", 422, requestId);
      const categories = await enabledCategories(sql);
      const category = categories.find((c) => c.slug === payload.category_slug);
      if (!category) return failure("INVALID_CATEGORY", "Choose an available category.", 422, requestId);
      const result = await deps.buildBrief(env, sql, userId, { notes, categoryName: category.name, template: parseTemplate(category.template_json) });
      await sql`
        INSERT INTO agent_runs (id, user_id, agent_name, status, summary, created_at)
        VALUES (${crypto.randomUUID()}, ${userId}, 'brief_builder', 'completed', ${`Drafted a ${category.name} brief (${result.source})`}, now())
      `;
      return success({ ...result, category_slug: category.slug }, result.note ?? "Draft brief ready for your review", 200, requestId);
    }

    // ---------------- organisation listings ----------------
    if (orgListings) {
      const org = await organizationForMember(sql, userId, orgListings[1]);
      if (!org) return failure("NOT_FOUND", "Organisation not found", 404, requestId);

      if (method === "GET") {
        const rows = await sql<JoinedRow[]>`
          SELECT l.id AS l_id, l.organization_id AS l_organization_id, l.category_slug AS l_category_slug, l.status AS l_status, l.visibility AS l_visibility, l.moderation_status AS l_moderation_status, l.moderation_notes AS l_moderation_notes, l.current_version AS l_current_version, l.published_at AS l_published_at, l.closes_at AS l_closes_at, l.created_at AS l_created_at, l.updated_at AS l_updated_at, v.*
          FROM project_listings l
          JOIN project_listing_versions v ON v.listing_id = l.id AND v.version = l.current_version
          WHERE l.organization_id = ${org.id}
          ORDER BY l.created_at DESC
          LIMIT 100
        `;
        return success(rows.map((row) => listingOut(listingFromJoined(row), row)), "Listings", 200, requestId);
      }

      const categories = new Set((await enabledCategories(sql)).map((c) => c.slug));
      const createPayload = (await body(request)) ?? {};
      const validation = validateBrief(createPayload, categories);
      const closes = parseClosesAt(createPayload.closes_at);
      if (!validation.ok || !closes.ok) {
        const errors = { ...(validation.ok ? {} : validation.errors), ...(closes.ok ? {} : { closes_at: closes.error }) };
        return failure("INVALID_BRIEF", "Check the highlighted fields.", 422, requestId, [errors]);
      }
      const brief = validation.brief;
      const hash = await briefHash(brief);
      const listingId = crypto.randomUUID();
      await sql.begin(async (tx) => {
        await tx`
          INSERT INTO project_listings
            (id, organization_id, created_by, category_slug, status, visibility, moderation_status, moderation_notes,
             current_version, closes_at, created_at, updated_at)
          VALUES (${listingId}, ${org.id}, ${userId}, ${brief.category_slug}, 'draft', ${brief.visibility}, 'not_screened', '', 1,
                  ${closes.value ?? null}, now(), now())
        `;
        await insertVersion(tx, listingId, 1, brief, hash, userId);
      });
      return await respondWithListing(sql, listingId, "Draft saved", 201, requestId);
    }

    // ---------------- one listing ----------------
    if (listingMatch) {
      const listingId = listingMatch[1];
      const rows = await sql<ListingRow[]>`SELECT * FROM project_listings WHERE id = ${listingId} LIMIT 1`;
      const listing = rows[0];
      const org = listing ? await organizationForMember(sql, userId, listing.organization_id) : null;
      if (!listing || !org) return failure("NOT_FOUND", "Listing not found", 404, requestId);

      if (method === "GET") {
        const version = await currentVersion(sql, listing);
        if (!version) return failure("NOT_FOUND", "Listing not found", 404, requestId);
        const history = await sql<{ version: number; content_hash: string; created_at: Date }[]>`
          SELECT version, content_hash, created_at FROM project_listing_versions WHERE listing_id = ${listingId} ORDER BY version DESC LIMIT 50
        `;
        return success(
          { ...listingOut(listing, version), versions: history.map((h) => ({ version: h.version, content_hash: h.content_hash, created_at: new Date(h.created_at).toISOString() })) },
          "Listing",
          200,
          requestId
        );
      }

      const payload = (await body(request)) ?? {};

      if (method === "PUT") {
        const baseVersion = Number(payload.base_version);
        const categories = new Set((await enabledCategories(sql)).map((c) => c.slug));
        const validation = validateBrief(payload, categories);
        const closes = parseClosesAt(payload.closes_at);
        if (!validation.ok || !closes.ok) {
          const errors = { ...(validation.ok ? {} : validation.errors), ...(closes.ok ? {} : { closes_at: closes.error }) };
          return failure("INVALID_BRIEF", "Check the highlighted fields.", 422, requestId, [errors]);
        }
        const brief = validation.brief;
        const hash = await briefHash(brief);

        const outcome = await sql.begin(async (tx) => {
          const locked = (await tx<ListingRow[]>`SELECT * FROM project_listings WHERE id = ${listingId} FOR UPDATE`)[0];
          if (!locked || !EDITABLE_STATUSES.includes(locked.status as never)) return { code: "NOT_EDITABLE" as const };
          if (baseVersion !== locked.current_version) return { code: "VERSION_CONFLICT" as const, current: locked.current_version };
          const current = await currentVersion(tx, locked);
          const closesAt = closes.value === undefined ? (locked.closes_at ? new Date(locked.closes_at).toISOString() : null) : closes.value;
          const closesChanged = closesAt !== (locked.closes_at ? new Date(locked.closes_at).toISOString() : null);
          if (current && current.content_hash === hash && locked.visibility === brief.visibility) {
            if (!closesChanged) return { code: "UNCHANGED" as const };
            // Only the closing date changed: no new brief version.
            await tx`UPDATE project_listings SET closes_at = ${closesAt}, updated_at = now() WHERE id = ${listingId}`;
            return { code: "CLOSES_ONLY" as const };
          }

          const version = locked.current_version + 1;
          await insertVersion(tx, listingId, version, brief, hash, userId);
          // Published edits are re-screened; flagged ones go back to moderation.
          let status = locked.status;
          let moderation = locked.moderation_status;
          let notes = locked.moderation_notes;
          if (locked.status === "in_review") {
            status = "draft";
            moderation = "not_screened";
            notes = "";
          } else if (locked.status === "published") {
            const findings = screenBrief(brief);
            if (findings.length) {
              status = "in_review";
              moderation = "flagged";
              notes = findings.map((f) => f.code).join(",");
            }
          }
          await tx`
            UPDATE project_listings SET current_version = ${version}, category_slug = ${brief.category_slug},
              visibility = ${brief.visibility}, status = ${status}, moderation_status = ${moderation},
              moderation_notes = ${notes}, closes_at = ${closesAt}, updated_at = now()
            WHERE id = ${listingId}
          `;
          return { code: "OK" as const };
        });

        if (outcome.code === "NOT_EDITABLE") return failure("NOT_EDITABLE", "This listing can no longer be edited.", 409, requestId);
        if (outcome.code === "VERSION_CONFLICT") {
          return failure("VERSION_CONFLICT", `Someone saved a newer version (${outcome.current}). Reload and apply your changes again.`, 409, requestId);
        }
        return await respondWithListing(sql, listingId, outcome.code === "UNCHANGED" ? "No changes to save" : outcome.code === "CLOSES_ONLY" ? "Closing date updated" : "New version saved", 200, requestId);
      }

      // ---------------- transitions ----------------
      if (!canManageOrganization(org.membership_role)) {
        return failure("FORBIDDEN", "Only owners and admins can change a listing's status.", 403, requestId);
      }
      const action = payload.action;
      if (!isListingAction(action)) return failure("INVALID_ACTION", "Action must be submit, pause, resume, close or cancel.", 422, requestId);

      const result = await sql.begin(async (tx) => {
        const locked = (await tx<ListingRow[]>`SELECT * FROM project_listings WHERE id = ${listingId} FOR UPDATE`)[0];
        if (!locked || !canTransition(locked.status, action)) return { code: "INVALID_TRANSITION" as const, status: locked?.status ?? "unknown" };

        if (action !== "submit") {
          await tx`UPDATE project_listings SET status = ${nextStatus(action)}, updated_at = now() WHERE id = ${listingId}`;
          return { code: "OK" as const };
        }

        const version = await currentVersion(tx, locked);
        if (!version) return { code: "INVALID_TRANSITION" as const, status: locked.status };
        const brief = briefFromVersion(version, locked.visibility);
        const gaps = publicationGaps(brief);
        if (gaps.length) return { code: "INCOMPLETE" as const, gaps };

        const findings = screenBrief(brief);
        if (findings.length) {
          await tx`
            UPDATE project_listings SET status = 'in_review', moderation_status = 'flagged',
              moderation_notes = ${findings.map((f) => f.code).join(",")}, updated_at = now()
            WHERE id = ${listingId}
          `;
          return { code: "IN_REVIEW" as const };
        }
        await tx`
          UPDATE project_listings SET status = 'published', moderation_status = 'passed', moderation_notes = '',
            published_at = COALESCE(published_at, now()), updated_at = now()
          WHERE id = ${listingId}
        `;
        return { code: "OK" as const };
      });

      if (result.code === "INVALID_TRANSITION") {
        return failure("INVALID_TRANSITION", `A ${result.status} listing cannot be changed with "${action}".`, 409, requestId);
      }
      if (result.code === "INCOMPLETE") {
        return failure("INCOMPLETE_BRIEF", "Complete the brief before submitting.", 422, requestId, [{ gaps: result.gaps }]);
      }
      const message =
        result.code === "IN_REVIEW"
          ? "Submitted. A moderator will review this listing before it is published."
          : action === "submit"
            ? "Published"
            : `Listing ${nextStatus(action as Exclude<typeof action, "submit">)}`;
      return await respondWithListing(sql, listingId, message, 200, requestId);
    }

    return null;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function respondWithListing(sql: Sql, listingId: string, message: string, status: number, requestId: string): Promise<Response> {
  const listing = (await sql<ListingRow[]>`SELECT * FROM project_listings WHERE id = ${listingId} LIMIT 1`)[0];
  const version = listing ? await currentVersion(sql, listing) : null;
  if (!listing || !version) return failure("NOT_FOUND", "Listing not found", 404, requestId);
  return success(listingOut(listing, version), message, status, requestId);
}
