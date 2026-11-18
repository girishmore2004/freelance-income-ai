import type { Env } from "../types";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database, textArray } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { FLAGS, isEnabled } from "./flags";
import { publicListingOut } from "./listings";
import type { ListingRow, VersionRow } from "./listings";
import { screenText } from "./listings";
import { tableExists } from "./external-pipeline";

/**
 * Freelancer planning (U7; PRODUCT_EXPERIENCE_SPEC §3–4):
 *
 *   GET    /api/v1/me/saved-listings                         saved native projects, newest first
 *   POST   /api/v1/marketplace/listings/{id}/save {note?}    save (or update the note); visible projects only
 *   DELETE /api/v1/marketplace/listings/{id}/save
 *   GET    /api/v1/me/calendar?from=YYYY-MM-DD&days=1..92    dated items from the caller's own records
 *
 * The calendar never stores anything: it lists milestone due dates on the
 * caller's contracts (either side), closing dates and deadlines of saved
 * projects, and closing dates and deadlines of projects the caller's
 * organisations posted. Saving is behind `marketplace.client_side`.
 */

export interface PlannerRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
  now: () => Date;
}

const defaultDeps: PlannerRouteDeps = { database, authenticate: authenticateRequest, now: () => new Date() };
const MAX_SAVED = 200;

export type CalendarType = "milestone_due" | "saved_closes" | "saved_deadline" | "listing_closes" | "listing_deadline" | "follow_up" | "interview" | "task_due";

export interface CalendarEvent {
  date: string;
  type: CalendarType;
  title: string;
  detail: string;
  href: string;
  overdue: boolean;
  side: "freelancer" | "client" | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function isDay(v: unknown): v is string {
  if (typeof v !== "string" || !DAY.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Calendar window: `from` defaults to today; `days` 1–92 (default 42). */
export function calendarWindow(from: string | null, days: string | null, today: Date): { from: string; to: string } | null {
  const start = from === null || from === "" ? today.toISOString().slice(0, 10) : from;
  if (!isDay(start)) return null;
  const n = days === null || days === "" ? 42 : Number(days);
  if (!Number.isInteger(n) || n < 1 || n > 92) return null;
  return { from: start, to: addDays(start, n - 1) };
}

/** Milestone due dates of contracts, skipping approved milestones; overdue items before the window are kept. */
export function milestoneEvents(
  contracts: Array<{ id: string; title: string; milestones_json: string; side: "freelancer" | "client" }>,
  approved: Set<string>,
  window: { from: string; to: string },
  today: string
): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const c of contracts) {
    let milestones: Array<{ title?: unknown; due_date?: unknown }> = [];
    try {
      const parsed = JSON.parse(c.milestones_json || "[]");
      milestones = Array.isArray(parsed) ? parsed : [];
    } catch {
      milestones = [];
    }
    milestones.forEach((m, i) => {
      if (!isDay(m.due_date) || approved.has(`${c.id}:${i}`)) return;
      const due = m.due_date;
      const overdue = due < today;
      if (due > window.to || (due < window.from && !overdue)) return;
      out.push({
        date: due,
        type: "milestone_due",
        title: `${c.title}: ${String(m.title ?? `Milestone ${i + 1}`)}`,
        detail: c.side === "freelancer" ? "Deliver this milestone" : "Delivery due from your freelancer",
        href: "/contracts",
        overdue,
        side: c.side
      });
    });
  }
  return out;
}

export function sortEvents(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type) || a.title.localeCompare(b.title));
}

type SavedRow = ListingRow & VersionRow & { organization_name: string; client_verified_at: string | null; saved_at: Date; note: string; l_created_at: Date };

async function savedListings(sql: Queryable, userId: string) {
  const rows = await sql<SavedRow[]>`
    SELECT l.id, l.organization_id, l.category_slug, l.status, l.visibility, l.moderation_status, l.moderation_notes, l.current_version,
           l.published_at, l.closes_at, l.created_at AS l_created_at, l.updated_at,
           v.version, v.title, v.outcome, v.description, v.deliverables_json, v.skills_json, v.experience_level, v.budget_model,
           v.budget_min_minor, v.budget_max_minor, v.currency, v.deadline, v.milestones_json, v.acceptance_json, v.revision_rounds,
           v.languages_json, v.timezone, v.confidentiality, v.ownership_notes, v.assumptions_json, v.content_hash, v.created_at,
           o.name AS organization_name, (to_jsonb(o)->>'verified_at') AS client_verified_at, s.created_at AS saved_at, s.note
    FROM saved_listings s
    JOIN project_listings l ON l.id = s.listing_id
    JOIN project_listing_versions v ON v.listing_id = l.id AND v.version = l.current_version
    JOIN organizations o ON o.id = l.organization_id
    WHERE s.user_id = ${userId}
    ORDER BY s.created_at DESC
    LIMIT ${MAX_SAVED}
  `;
  return rows.map((r) => {
    const listing = publicListingOut(r, r, r.organization_name, r.client_verified_at);
    const open = r.status === "published" && (!r.closes_at || new Date(r.closes_at) > new Date());
    return { ...listing, status: r.status, open, note: r.note, saved_at: new Date(r.saved_at).toISOString() };
  });
}

export async function handlePlannerRoute(request: Request, env: Env, requestId: string, deps: PlannerRouteDeps = defaultDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const save = path.match(/^\/api\/v1\/marketplace\/listings\/([\w-]{1,64})\/save$/);
  const known =
    (path === "/api/v1/me/saved-listings" && method === "GET") ||
    (path === "/api/v1/me/calendar" && method === "GET") ||
    (save !== null && (method === "POST" || method === "DELETE"));
  if (!known) return null;

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);
  const now = deps.now();
  const today = now.toISOString().slice(0, 10);

  try {
    if (path === "/api/v1/me/calendar") {
      const window = calendarWindow(url.searchParams.get("from"), url.searchParams.get("days"), now);
      if (!window) return failure("INVALID_RANGE", "Use from=YYYY-MM-DD and days between 1 and 92.", 422, requestId);
      const orgs = (await sql<Array<{ organization_id: string }>>`
        SELECT organization_id FROM organization_memberships WHERE user_id = ${userId} AND status = 'active'
      `).map((r) => r.organization_id);
      const orgList = orgs;
      const [contracts, saved, posted] = await Promise.all([
        sql<Array<{ id: string; title: string; milestones_json: string; side: "freelancer" | "client" }>>`
          SELECT c.id, v.title, v.milestones_json, CASE WHEN c.freelancer_user_id = ${userId} THEN 'freelancer' ELSE 'client' END AS side
          FROM contracts c JOIN contract_versions v ON v.contract_id = c.id AND v.version = COALESCE(c.agreed_version, c.current_version)
          WHERE c.status = 'active' AND (c.freelancer_user_id = ${userId} OR c.organization_id = ANY(${textArray(orgList)}::text[]))
          LIMIT 200
        `,
        sql<Array<{ id: string; title: string; closes_at: Date | null; deadline: string | Date | null; status: string }>>`
          SELECT l.id, v.title, l.closes_at, v.deadline, l.status
          FROM saved_listings s JOIN project_listings l ON l.id = s.listing_id
          JOIN project_listing_versions v ON v.listing_id = l.id AND v.version = l.current_version
          WHERE s.user_id = ${userId} AND l.status IN ('published', 'hiring')
          LIMIT ${MAX_SAVED}
        `.catch(() => []),
        sql<Array<{ id: string; title: string; closes_at: Date | null; deadline: string | Date | null; status: string }>>`
          SELECT l.id, v.title, l.closes_at, v.deadline, l.status
          FROM project_listings l JOIN project_listing_versions v ON v.listing_id = l.id AND v.version = l.current_version
          WHERE l.organization_id = ANY(${textArray(orgList)}::text[]) AND l.status IN ('published', 'hiring', 'paused')
          LIMIT 200
        `
      ]);
      const approved = contracts.length
        ? new Set((await sql<Array<{ contract_id: string; milestone_index: number }>>`
            SELECT DISTINCT contract_id, milestone_index FROM milestone_submissions WHERE contract_id = ANY(${textArray(contracts.map((c) => c.id))}::text[]) AND status = 'approved'
          `).map((r) => `${r.contract_id}:${Number(r.milestone_index)}`))
        : new Set<string>();
      const dayOf = (v: string | Date | null) => (v === null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
      const inWindow = (d: string | null): d is string => d !== null && d >= window.from && d <= window.to;
      const events: CalendarEvent[] = milestoneEvents(contracts, approved, window, today);
      for (const s of saved) {
        const closes = dayOf(s.closes_at);
        if (inWindow(closes)) events.push({ date: closes, type: "saved_closes", title: s.title, detail: "Saved project stops taking proposals", href: "/projects?view=saved", overdue: false, side: "freelancer" });
        const deadline = dayOf(s.deadline);
        if (inWindow(deadline)) events.push({ date: deadline, type: "saved_deadline", title: s.title, detail: "Client's deadline for a saved project", href: "/projects?view=saved", overdue: false, side: "freelancer" });
      }
      for (const p of posted) {
        const closes = dayOf(p.closes_at);
        if (inWindow(closes)) events.push({ date: closes, type: "listing_closes", title: p.title, detail: "Your project stops taking proposals", href: "/client/projects", overdue: false, side: "client" });
        const deadline = dayOf(p.deadline);
        if (inWindow(deadline)) events.push({ date: deadline, type: "listing_deadline", title: p.title, detail: "Your project's deadline", href: "/client/projects", overdue: deadline < today, side: "client" });
      }
      if (await tableExists(sql, "opportunity_events")) {
        const followUps = await sql<Array<{ kind: "follow_up" | "interview"; note: string; due_date: string | Date; opportunity_id: string; title: string }>>`
          SELECT e.kind, e.note, e.due_date, e.opportunity_id, o.title
          FROM opportunity_events e JOIN opportunities o ON o.id = e.opportunity_id
          WHERE e.user_id = ${userId} AND e.kind IN ('follow_up', 'interview') AND e.done_at IS NULL
            AND e.due_date IS NOT NULL AND e.due_date <= ${window.to}
          LIMIT 200
        `;
        for (const f of followUps) {
          const d = dayOf(f.due_date);
          if (!d) continue;
          const overdue = d < today;
          if (d < window.from && !overdue) continue;
          events.push({ date: d, type: f.kind, title: f.title, detail: f.note.slice(0, 140), href: `/opportunities?id=${encodeURIComponent(f.opportunity_id)}`, overdue, side: "freelancer" });
        }
      }
      if (contracts.length && (await tableExists(sql, "contract_tasks"))) {
        // Open contract tasks with a due date (U11), for the side that owns them.
        const tasks = await sql<Array<{ contract_id: string; title: string; due_date: string | Date; owner_party: "client" | "freelancer" }>>`
          SELECT contract_id, title, due_date, owner_party FROM contract_tasks
          WHERE contract_id = ANY(${textArray(contracts.map((c) => c.id))}::text[]) AND status <> 'done' AND due_date IS NOT NULL AND due_date <= ${window.to}
          LIMIT 300
        `;
        for (const t of tasks) {
          const contract = contracts.find((c) => c.id === t.contract_id);
          if (!contract || contract.side !== t.owner_party) continue;
          const d = dayOf(t.due_date);
          if (!d) continue;
          const overdue = d < today;
          if (d < window.from && !overdue) continue;
          events.push({ date: d, type: "task_due", title: contract.title, detail: `Task: ${t.title.slice(0, 120)}`, href: `/contracts#${t.contract_id}`, overdue, side: t.owner_party });
        }
      }
      if (await tableExists(sql, "proposal_interviews")) {
        // Native interviews (U9): accepted and still-proposed times on proposals I sent or received.
        const interviews = await sql<Array<{ starts_at: Date; status: string; duration_minutes: number; mode: string; proposal_id: string; title: string; side: "freelancer" | "client" }>>`
          SELECT i.starts_at, i.status, i.duration_minutes, i.mode, i.proposal_id, v.title,
                 CASE WHEN p.freelancer_user_id = ${userId} THEN 'freelancer' ELSE 'client' END AS side
          FROM proposal_interviews i
          JOIN listing_proposals p ON p.id = i.proposal_id
          JOIN project_listings l ON l.id = p.listing_id
          JOIN project_listing_versions v ON v.listing_id = l.id AND v.version = l.current_version
          WHERE i.status IN ('proposed', 'accepted')
            AND i.starts_at >= ${window.from}::date AND i.starts_at < (${window.to}::date + 1)
            AND (p.freelancer_user_id = ${userId} OR l.organization_id = ANY(${textArray(orgList)}::text[]))
          LIMIT 200
        `;
        for (const i of interviews) {
          const at = new Date(i.starts_at);
          events.push({
            date: at.toISOString().slice(0, 10), type: "interview", title: i.title,
            detail: `${i.status === "accepted" ? "Interview" : "Proposed interview"} at ${at.toISOString().slice(11, 16)} UTC · ${i.duration_minutes} min ${i.mode}`,
            href: `/inbox?proposal=${encodeURIComponent(i.proposal_id)}`, overdue: false, side: i.side
          });
        }
      }
      return success({ from: window.from, to: window.to, today, events: sortEvents(events) }, "Calendar", 200, requestId);
    }

    if (!(await isEnabled(env, sql, FLAGS.clientMarketplace, false))) {
      return failure("FEATURE_DISABLED", "The client marketplace is not open yet.", 403, requestId);
    }

    if (path === "/api/v1/me/saved-listings") {
      return success(await savedListings(sql, userId), "Saved projects", 200, requestId);
    }

    const listingId = save![1];
    if (method === "DELETE") {
      await sql`DELETE FROM saved_listings WHERE user_id = ${userId} AND listing_id = ${listingId}`;
      return success({ listing_id: listingId, saved: false }, "Removed from saved projects", 200, requestId);
    }
    const payload = (await body(request)) ?? {};
    const note = typeof payload.note === "string" ? payload.note.trim() : "";
    if (note.length > 300) return failure("INVALID_NOTE", "Keep the note under 300 characters.", 422, requestId);
    if (note && screenText(note).length) return failure("INVALID_NOTE", "Keep contact and payment details out of notes.", 422, requestId);
    const visible = (await sql<Array<{ id: string }>>`
      SELECT l.id FROM project_listings l JOIN organizations o ON o.id = l.organization_id
      WHERE l.id = ${listingId} AND o.status = 'active' AND l.status IN ('published', 'hiring')
        AND (l.visibility = 'public' OR EXISTS (
          SELECT 1 FROM listing_invitations i WHERE i.listing_id = l.id AND i.freelancer_user_id = ${userId} AND i.status IN ('pending', 'accepted')))
      LIMIT 1
    `)[0];
    if (!visible) return failure("NOT_FOUND", "Project not found", 404, requestId);
    const count = (await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM saved_listings WHERE user_id = ${userId}`)[0]?.n ?? 0;
    const rows = await sql<Array<{ listing_id: string; note: string }>>`
      INSERT INTO saved_listings (id, user_id, listing_id, note, created_at)
      SELECT ${crypto.randomUUID()}, ${userId}, ${listingId}, ${note}, now()
      WHERE ${count} < ${MAX_SAVED} OR EXISTS (SELECT 1 FROM saved_listings WHERE user_id = ${userId} AND listing_id = ${listingId})
      ON CONFLICT (user_id, listing_id) DO UPDATE SET note = EXCLUDED.note
      RETURNING listing_id, note
    `;
    if (!rows[0]) return failure("LIMIT_REACHED", `You can save up to ${MAX_SAVED} projects. Remove some first.`, 409, requestId);
    return success({ listing_id: listingId, saved: true, note: rows[0].note }, "Saved", 200, requestId);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
