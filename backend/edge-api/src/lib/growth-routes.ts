import type { Env } from "../types";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database, jsonList, safeHttpUrl } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { ensureClientAccount, loadRoles } from "./identity";
import { FLAGS, isEnabled } from "./flags";
import { notifyUsers } from "./notify";
import { tableExists } from "./external-pipeline";
import { normaliseSkill } from "./matching";
import { billingGaps, clientFacts, clientProfileGaps, clientSteps, freelancerFacts, freelancerProfileGaps, freelancerSteps, onboardingOut } from "./onboarding";

/**
 * Helping freelancers find and win work faster (U12).
 *
 *   GET  /api/v1/me/saved-searches                   my saved Find work filters, each with how many matching projects are new
 *   POST /api/v1/me/saved-searches {name, query?, category_slug?, min_budget_minor?, skills?, alerts?}
 *   POST /api/v1/saved-searches/{id} {name?, alerts?}
 *   POST /api/v1/saved-searches/{id}/seen            reset the "new" count
 *   POST /api/v1/saved-searches/{id}/delete
 *   GET  /api/v1/me/profile-checklist                what is missing from my profile, in the order that helps matching most
 *   GET  /api/v1/me/onboarding?side=client|freelancer  step-by-step start for the overview (U31, D-31; warn only)
 *
 * Alerts: `alertSavedSearches` runs when a public project is published (by
 * the client or a moderator) and notifies each freelancer whose saved search
 * matches, once per project. Matching is deterministic and explained by the
 * search's own words, category, budget and skills.
 */

export interface GrowthRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
}

const defaultDeps: GrowthRouteDeps = { database, authenticate: authenticateRequest };

export const MAX_SAVED_SEARCHES = 10;

export type SearchFilter = { query: string; category_slug: string; min_budget_minor: number | null; skills: string[] };
export type ListingFacts = { title: string; outcome: string; description: string; category_slug: string; budget_min_minor: number | null; budget_max_minor: number | null; skills: string[] };

/** Every word of the query appears; same category; top of budget reaches the minimum; at least one skill shared. Pure. */
export function searchMatches(search: SearchFilter, listing: ListingFacts): boolean {
  const text = `${listing.title} ${listing.outcome} ${listing.description}`.toLowerCase();
  const words = search.query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (words.some((w) => !text.includes(w))) return false;
  if (search.category_slug && search.category_slug !== listing.category_slug) return false;
  if (search.min_budget_minor !== null) {
    const top = listing.budget_max_minor ?? listing.budget_min_minor;
    if (top === null || top < search.min_budget_minor) return false;
  }
  if (search.skills.length) {
    const have = new Set(listing.skills.map(normaliseSkill));
    if (!search.skills.some((s) => have.has(normaliseSkill(s)))) return false;
  }
  return true;
}

export function validateSearch(input: Record<string, unknown>): { ok: true; value: SearchFilter & { name: string; alerts: boolean } } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 2 || name.length > 80) errors.name = "Name the search (2–80 characters).";
  const query = typeof input.query === "string" ? input.query.trim().slice(0, 100) : "";
  const category = typeof input.category_slug === "string" ? input.category_slug.trim() : "";
  if (category && !/^[a-z0-9_]{1,60}$/.test(category)) errors.category_slug = "Unknown category.";
  let min: number | null = null;
  if (input.min_budget_minor !== undefined && input.min_budget_minor !== null && input.min_budget_minor !== "") {
    min = Number(input.min_budget_minor);
    if (!Number.isInteger(min) || min < 0 || min > 1e12) errors.min_budget_minor = "Use a whole amount of 0 or more.";
  }
  const rawSkills = Array.isArray(input.skills) ? input.skills : [];
  const skills = [...new Set(rawSkills.map((s) => String(s).trim()).filter(Boolean))].slice(0, 10);
  if (skills.some((s) => s.length > 40)) errors.skills = "Keep each skill under 40 characters.";
  if (!query && !category && min === null && !skills.length) errors.query = "Add at least one filter: words, a category, a budget or skills.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { name, query, category_slug: category, min_budget_minor: min, skills, alerts: input.alerts !== false } };
}

export type ChecklistItem = { key: string; label: string; done: boolean; why: string; href: string };

/** Ordered by how much each item helps matching and client trust. Pure. */
export function profileChecklist(p: Record<string, unknown> | undefined, extra: { visible: boolean; verified: boolean; proposals: number }): { score: number; items: ChecklistItem[] } {
  const skills = jsonList(p?.skills);
  const services = jsonList(p?.services);
  const links = jsonList(p?.portfolio_links).filter((l) => safeHttpUrl(l));
  // A project in the profile's own list (U17) with a link counts as a link to your work.
  try {
    const items = JSON.parse(String(p?.portfolio_items_json ?? "[]"));
    if (Array.isArray(items)) for (const it of items) if (safeHttpUrl(it?.link)) links.push(String(it.link));
  } catch {
    // malformed list: links only
  }
  const str = (k: string) => (typeof p?.[k] === "string" ? String(p[k]).trim() : "");
  const num = (k: string) => Number(p?.[k] ?? 0);
  const items: ChecklistItem[] = [
    { key: "name", label: "Add your name", done: str("full_name").length > 1, why: "Clients see it on every proposal.", href: "/profile" },
    { key: "skills", label: "List at least 3 skills", done: skills.length >= 3, why: "Matching scores projects mostly on skills.", href: "/profile" },
    { key: "headline", label: "Write a one-line headline", done: str("headline").length >= 10, why: "It is the first line clients read.", href: "/profile" },
    { key: "portfolio", label: "Add a link to your work", done: links.length > 0, why: "Proposals can only cite work from your profile.", href: "/profile" },
    { key: "rate", label: "Set your hourly rate or minimum budget", done: num("hourly_rate") > 0 || num("minimum_budget") > 0, why: "Budget fit is part of every match.", href: "/profile" },
    { key: "services", label: "Describe the services you offer", done: services.length > 0, why: "Helps clients searching the directory.", href: "/profile" },
    { key: "availability", label: "Set weekly hours and time zone", done: num("weekly_hours") > 0 && str("timezone").length > 0, why: "Clients filter by availability and time zone.", href: "/profile" },
    { key: "visible", label: "Show your profile to clients", done: extra.visible, why: "Clients can only invite freelancers who opted in.", href: "/projects" },
    { key: "first_proposal", label: "Send your first proposal", done: extra.proposals > 0, why: "Proposal Studio checks it before you send.", href: "/projects" },
    { key: "verified", label: "Ask staff to review your profile", done: extra.verified, why: "Adds a Reviewed badge clients can see.", href: "/account" }
  ];
  const score = Math.round((items.filter((i) => i.done).length / items.length) * 100);
  return { score, items };
}

type SearchRow = { id: string; user_id: string; name: string; query: string; category_slug: string; min_budget_minor: string | number | null; skills_json: string; alerts: boolean; last_seen_at: Date; created_at: Date };
type PublicRow = { id: string; title: string; outcome: string; description: string; category_slug: string; budget_min_minor: string | number | null; budget_max_minor: string | number | null; skills_json: string; confidentiality: string; published_at: Date; organization_id: string };

const filterOf = (r: SearchRow): SearchFilter => ({
  query: r.query, category_slug: r.category_slug, min_budget_minor: r.min_budget_minor === null ? null : Number(r.min_budget_minor), skills: jsonList(r.skills_json)
});
const factsOf = (l: PublicRow): ListingFacts => ({
  title: l.title, outcome: l.outcome, description: l.confidentiality === "confidential" ? "" : l.description, category_slug: l.category_slug,
  budget_min_minor: l.budget_min_minor === null ? null : Number(l.budget_min_minor), budget_max_minor: l.budget_max_minor === null ? null : Number(l.budget_max_minor),
  skills: jsonList(l.skills_json)
});

async function recentPublic(sql: Queryable, since: string, listingId?: string): Promise<PublicRow[]> {
  return sql<PublicRow[]>`
    SELECT l.id, v.title, v.outcome, v.description, l.category_slug, v.budget_min_minor, v.budget_max_minor, v.skills_json, v.confidentiality, l.published_at, l.organization_id
    FROM project_listings l
    JOIN project_listing_versions v ON v.listing_id = l.id AND v.version = l.current_version
    JOIN organizations o ON o.id = l.organization_id
    WHERE l.status = 'published' AND l.visibility = 'public' AND o.status = 'active'
      AND (l.closes_at IS NULL OR l.closes_at > now()) AND l.published_at > ${since}::timestamptz
      AND (${listingId ?? ""} = '' OR l.id = ${listingId ?? ""})
    ORDER BY l.published_at DESC
    LIMIT 300
  `;
}

/** Notifies freelancers whose saved search matches a newly published public project. Never throws. */
export async function alertSavedSearches(sql: Queryable, listingId: string): Promise<number> {
  try {
    if (!(await tableExists(sql, "saved_searches"))) return 0;
    const listing = (await recentPublic(sql, "1970-01-01", listingId))[0];
    if (!listing) return 0;
    const searches = await sql<SearchRow[]>`
      SELECT s.* FROM saved_searches s
      JOIN user_roles r ON r.user_id = s.user_id AND r.role = 'freelancer' AND r.status = 'active'
      WHERE s.alerts = true
        AND NOT EXISTS (SELECT 1 FROM organization_memberships m WHERE m.organization_id = ${listing.organization_id} AND m.user_id = s.user_id AND m.status = 'active')
      LIMIT 5000
    `;
    const facts = factsOf(listing);
    const byUser = new Map<string, string>();
    for (const s of searches) if (!byUser.has(s.user_id) && searchMatches(filterOf(s), facts)) byUser.set(s.user_id, s.name);
    for (const [userId, name] of byUser) {
      await notifyUsers(sql, [userId], {
        kind: "search.match",
        title: `New project for "${name}": ${listing.title}`,
        message: listing.outcome.slice(0, 200),
        link: `/projects?project=${listing.id}`,
        dedupe: `search-match:${listing.id}`
      });
    }
    return byUser.size;
  } catch (error) {
    console.warn(JSON.stringify({ service: "freelance-income-ai-api-edge", event: "search_alert.failed", error: error instanceof Error ? error.message : "unknown" }));
    return 0;
  }
}

/**
 * Daily digest of new external matches (U15): one notification per freelancer
 * per UTC day, listing the strongest new external opportunities found in the
 * last 24 hours. Runs from the 6-hourly cron; only the run between 03:00 and
 * 08:59 UTC sends. Never throws.
 */
export async function runDailyJobDigest(sql: Queryable, now: Date): Promise<number> {
  const hour = now.getUTCHours();
  if (hour < 3 || hour > 8) return 0;
  const today = now.toISOString().slice(0, 10);
  try {
    const rows = await sql<Array<{ user_id: string; n: number; top: string[] }>>`
      SELECT user_id, count(*)::int AS n,
             (array_agg(title ORDER BY match_score DESC NULLS LAST))[1:3] AS top
      FROM opportunities
      WHERE created_at > ${new Date(now.getTime() - 86_400_000).toISOString()}::timestamptz AND status = 'new' AND COALESCE(match_score, 0) >= 60
      GROUP BY user_id
      LIMIT 1000
    `;
    for (const r of rows) {
      await notifyUsers(sql, [r.user_id], {
        kind: "jobs.daily_digest",
        title: `${r.n} new strong match${r.n === 1 ? "" : "es"} today`,
        message: (r.top ?? []).filter(Boolean).map((t) => String(t).slice(0, 80)).join(" · "),
        link: "/projects?view=external",
        dedupe: `jobs-digest:${today}`
      });
    }
    return rows.length;
  } catch (error) {
    console.warn(JSON.stringify({ service: "freelance-income-ai-api-edge", event: "jobs_digest.failed", error: error instanceof Error ? error.message : "unknown" }));
    return 0;
  }
}

export async function handleGrowthRoute(request: Request, env: Env, requestId: string, deps: GrowthRouteDeps = defaultDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const one = path.match(/^\/api\/v1\/saved-searches\/([\w-]{1,64})(?:\/(seen|delete))?$/);
  const known =
    (path === "/api/v1/me/saved-searches" && (method === "GET" || method === "POST")) ||
    (path === "/api/v1/me/profile-checklist" && method === "GET") ||
    (path === "/api/v1/me/onboarding" && method === "GET") ||
    (one !== null && method === "POST");
  if (!known) return null;

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);

  try {
    if (path === "/api/v1/me/onboarding") {
      const side = new URL(request.url).searchParams.get("side");
      if (side !== "client" && side !== "freelancer") return failure("VALIDATION_ERROR", "side must be client or freelancer", 422, requestId);
      const roles = await loadRoles(sql, userId);
      if (!roles.includes(side)) return success({ side, applies: false, steps: [], next: null, done: 0, total: 0, complete: false, profile_gaps: [], billing_gaps: [] }, "Not on this side", 200, requestId);
      if (side === "client") {
        let facts = await clientFacts(sql, userId);
        // Same as /me/identity: a client never starts by creating an account; one is made for them.
        if (!facts.profile && (await isEnabled(env, sql, FLAGS.clientMarketplace, false))) {
          await ensureClientAccount(sql, userId);
          facts = await clientFacts(sql, userId);
        }
        return success({ applies: true, ...onboardingOut("client", clientSteps(facts), { profile: clientProfileGaps(facts.profile), billing: billingGaps(facts.profile) }) }, "Get started", 200, requestId);
      }
      const facts = await freelancerFacts(sql, userId);
      return success({ applies: true, ...onboardingOut("freelancer", freelancerSteps(facts), { profile: freelancerProfileGaps(facts.profile) }) }, "Get started", 200, requestId);
    }

    if (path === "/api/v1/me/profile-checklist") {
      const roles = await loadRoles(sql, userId);
      if (!roles.includes("freelancer")) return success({ applies: false, score: 0, items: [] }, "Checklist", 200, requestId);
      const profile = (await sql<Array<Record<string, unknown>>>`SELECT to_jsonb(p) AS p FROM profiles p WHERE p.user_id = ${userId} LIMIT 1`)[0]?.p as Record<string, unknown> | undefined;
      const proposals = await sql<Array<{ n: number }>>`
        SELECT ((SELECT count(*) FROM proposals WHERE user_id = ${userId}) + COALESCE((SELECT count(*) FROM listing_proposals WHERE freelancer_user_id = ${userId}), 0))::int AS n
      `.catch(() => [{ n: 0 }]);
      const result = profileChecklist(profile, { visible: Boolean(profile?.marketplace_visible), verified: Boolean(profile?.verified_at), proposals: proposals[0]?.n ?? 0 });
      return success({ applies: true, ...result }, "Checklist", 200, requestId);
    }

    if (!(await tableExists(sql, "saved_searches"))) {
      if (method === "GET") return success({ available: false, items: [] }, "Saved searches", 200, requestId);
      return failure("MIGRATION_PENDING", "Saved searches need database migration 0073.", 503, requestId);
    }

    if (path === "/api/v1/me/saved-searches") {
      if (method === "GET") {
        const rows = await sql<SearchRow[]>`SELECT * FROM saved_searches WHERE user_id = ${userId} ORDER BY created_at ASC LIMIT ${MAX_SAVED_SEARCHES}`;
        const oldest = rows.reduce<string>((min, r) => { const t = new Date(r.last_seen_at).toISOString(); return t < min ? t : min; }, new Date().toISOString());
        const recent = rows.length ? await recentPublic(sql, oldest) : [];
        const items = rows.map((r) => {
          const f = filterOf(r);
          const fresh = recent.filter((l) => new Date(l.published_at) > new Date(r.last_seen_at) && searchMatches(f, factsOf(l)));
          return {
            id: r.id, name: r.name, query: r.query, category_slug: r.category_slug, min_budget_minor: f.min_budget_minor, skills: f.skills, alerts: r.alerts,
            new_count: fresh.length, new_projects: fresh.slice(0, 5).map((l) => ({ id: l.id, title: l.title })), last_seen_at: new Date(r.last_seen_at).toISOString()
          };
        });
        return success({ available: true, items, max: MAX_SAVED_SEARCHES }, "Saved searches", 200, requestId);
      }
      const v = validateSearch((await body(request)) ?? {});
      if (!v.ok) return failure("INVALID_SEARCH", "Check the highlighted fields.", 422, requestId, [v.errors]);
      const count = (await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM saved_searches WHERE user_id = ${userId}`)[0]?.n ?? 0;
      if (count >= MAX_SAVED_SEARCHES) return failure("LIMIT_REACHED", `You can keep up to ${MAX_SAVED_SEARCHES} saved searches.`, 409, requestId);
      const row = (await sql<SearchRow[]>`
        INSERT INTO saved_searches (id, user_id, name, query, category_slug, min_budget_minor, skills_json, alerts, last_seen_at, created_at, updated_at)
        VALUES (${crypto.randomUUID()}, ${userId}, ${v.value.name}, ${v.value.query}, ${v.value.category_slug}, ${v.value.min_budget_minor},
                ${JSON.stringify(v.value.skills)}, ${v.value.alerts}, now(), now(), now())
        RETURNING *
      `)[0];
      return success({ id: row.id, name: row.name, alerts: row.alerts }, v.value.alerts ? "Search saved. We'll notify you about new matching projects." : "Search saved", 201, requestId);
    }

    const search = (await sql<SearchRow[]>`SELECT * FROM saved_searches WHERE id = ${one![1]} AND user_id = ${userId} LIMIT 1`)[0];
    if (!search) return failure("NOT_FOUND", "Saved search not found", 404, requestId);
    if (one![2] === "delete") {
      await sql`DELETE FROM saved_searches WHERE id = ${search.id}`;
      return success({ id: search.id }, "Saved search removed", 200, requestId);
    }
    if (one![2] === "seen") {
      await sql`UPDATE saved_searches SET last_seen_at = now() WHERE id = ${search.id}`;
      return success({ id: search.id }, "Marked as seen", 200, requestId);
    }
    const payload = (await body(request)) ?? {};
    const name = typeof payload.name === "string" ? payload.name.trim() : search.name;
    if (name.length < 2 || name.length > 80) return failure("INVALID_SEARCH", "Name the search (2–80 characters).", 422, requestId, [{ name: "Name the search (2–80 characters)." }]);
    const alerts = typeof payload.alerts === "boolean" ? payload.alerts : search.alerts;
    await sql`UPDATE saved_searches SET name = ${name}, alerts = ${alerts}, updated_at = now() WHERE id = ${search.id}`;
    return success({ id: search.id, name, alerts }, alerts ? "Alerts on" : "Alerts off", 200, requestId);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
