import type { Env } from "../types";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database, iso, jsonList, oppOut, proposalOut } from "./core-routes";
import type { Sql } from "./core-routes";
import { failure, success } from "./response";
import { screenText } from "./listings";
import { allowedTransitions, analyseOpportunity, nextStep, tableExists } from "./external-pipeline";

/**
 * One external opportunity as a project-centric record (U8):
 *
 *   GET  /api/v1/opportunities/{id}/timeline   analysis, proposals with versions and approvals,
 *                                              submissions (applications), events, allowed next statuses
 *   POST /api/v1/opportunities/{id}/events     {kind: follow_up|interview|note, note, due_date?}
 *   POST /api/v1/opportunity-events/{id}/done  mark a follow-up or interview as done
 *   GET  /api/v1/me/follow-ups                 open follow-ups and interviews, soonest first
 *
 * Owner-only: other users get 404. Global Drafts, Approvals and Applications
 * on the dashboard are filtered views of the same proposal, approval and
 * application rows shown here.
 */

export interface OpportunityRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
  now: () => Date;
}

const defaultDeps: OpportunityRouteDeps = { database, authenticate: authenticateRequest, now: () => new Date() };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function validateEvent(input: Record<string, unknown>, today: string): { ok: true; value: { kind: "follow_up" | "interview" | "note"; note: string; due_date: string | null } } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const kind = input.kind;
  if (kind !== "follow_up" && kind !== "interview" && kind !== "note") errors.kind = "Choose follow-up, interview or note.";
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length < 2 || note.length > 2000) errors.note = "Write 2 to 2,000 characters.";
  else if (screenText(note).some((f) => f.code === "upfront_fee" || f.code === "prohibited_work")) errors.note = "This note looks like a scam or prohibited request; it was not saved.";
  let due: string | null = null;
  if (input.due_date !== undefined && input.due_date !== null && input.due_date !== "") {
    const d = String(input.due_date);
    const parsed = new Date(`${d}T00:00:00Z`);
    if (!DAY.test(d) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== d) errors.due_date = "Use a real date (YYYY-MM-DD).";
    else if (d < today) errors.due_date = "Choose today or a later date.";
    else due = d;
  }
  if ((kind === "follow_up" || kind === "interview") && !due && !errors.due_date) errors.due_date = "Follow-ups and interviews need a date.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { kind: kind as "follow_up" | "interview" | "note", note, due_date: due } };
}

const day = (v: unknown) => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

export async function handleOpportunityRoute(request: Request, env: Env, requestId: string, deps: OpportunityRouteDeps = defaultDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const timeline = path.match(/^\/api\/v1\/opportunities\/([\w-]{1,64})\/timeline$/);
  const events = path.match(/^\/api\/v1\/opportunities\/([\w-]{1,64})\/events$/);
  const done = path.match(/^\/api\/v1\/opportunity-events\/([\w-]{1,64})\/done$/);
  const known = (timeline && method === "GET") || (events && method === "POST") || (done && method === "POST") || (path === "/api/v1/me/follow-ups" && method === "GET");
  if (!known) return null;

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);
  const today = deps.now().toISOString().slice(0, 10);

  try {
    const ready = await tableExists(sql, "opportunity_events");

    if (path === "/api/v1/me/follow-ups") {
      if (!ready) return success([], "Follow-ups need database migration 0069", 200, requestId);
      const rows = await sql<Array<{ id: string; opportunity_id: string; kind: string; note: string; due_date: string | Date; title: string; status: string }>>`
        SELECT e.id, e.opportunity_id, e.kind, e.note, e.due_date, o.title, o.status
        FROM opportunity_events e JOIN opportunities o ON o.id = e.opportunity_id
        WHERE e.user_id = ${userId} AND e.kind IN ('follow_up', 'interview') AND e.done_at IS NULL AND e.due_date IS NOT NULL
        ORDER BY e.due_date ASC LIMIT 100
      `;
      return success(rows.map((r) => ({ ...r, due_date: day(r.due_date), overdue: (day(r.due_date) ?? today) < today })), "Follow-ups", 200, requestId);
    }

    if (done) {
      if (!ready) return failure("MIGRATION_PENDING", "Follow-ups need database migration 0069.", 503, requestId);
      const rows = await sql<Array<{ id: string }>>`
        UPDATE opportunity_events SET done_at = now()
        WHERE id = ${done[1]} AND user_id = ${userId} AND kind IN ('follow_up', 'interview') AND done_at IS NULL
        RETURNING id
      `;
      if (!rows[0]) return failure("NOT_FOUND", "Open follow-up not found", 404, requestId);
      return success({ id: rows[0].id, done: true }, "Marked as done", 200, requestId);
    }

    const oppId = (timeline ?? events)![1];
    const opp = (await sql<Record<string, unknown>[]>`SELECT * FROM opportunities WHERE id = ${oppId} AND user_id = ${userId} LIMIT 1`)[0];
    if (!opp) return failure("NOT_FOUND", "Opportunity not found", 404, requestId);

    if (events) {
      if (!ready) return failure("MIGRATION_PENDING", "Follow-ups and notes need database migration 0069.", 503, requestId);
      const v = validateEvent((await body(request)) ?? {}, today);
      if (!v.ok) return failure("INVALID_EVENT", "Check the highlighted fields.", 422, requestId, [v.errors]);
      const count = (await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM opportunity_events WHERE opportunity_id = ${oppId}`)[0]?.n ?? 0;
      if (count >= 200) return failure("LIMIT_REACHED", "This opportunity already has 200 entries.", 409, requestId);
      const rows = await sql<Record<string, unknown>[]>`
        INSERT INTO opportunity_events (id, opportunity_id, user_id, kind, note, due_date, created_at)
        VALUES (${crypto.randomUUID()}, ${oppId}, ${userId}, ${v.value.kind}, ${v.value.note}, ${v.value.due_date}, now())
        RETURNING id, kind, note, due_date, created_at
      `;
      const r = rows[0];
      return success({ ...r, due_date: day(r.due_date), created_at: iso(r.created_at) }, v.value.kind === "note" ? "Note added" : "Added to your calendar", 201, requestId);
    }

    // ---- timeline ----
    const profileRow = (await sql<Record<string, unknown>[]>`SELECT skills, portfolio_links, minimum_budget, currency FROM profiles WHERE user_id = ${userId} LIMIT 1`)[0];
    const profile = {
      skills: jsonList(profileRow?.skills),
      portfolio_links: jsonList(profileRow?.portfolio_links),
      minimum_budget: profileRow?.minimum_budget === null || profileRow?.minimum_budget === undefined ? null : Number(profileRow.minimum_budget),
      currency: String(profileRow?.currency || "INR")
    };
    const proposals = await sql<Record<string, unknown>[]>`SELECT * FROM proposals WHERE opportunity_id = ${oppId} AND user_id = ${userId} ORDER BY created_at ASC LIMIT 20`;
    const ids = proposals.map((p) => String(p.id));
    const [approvals, versions, applications, eventRows] = await Promise.all([
      ids.length ? sql<Record<string, unknown>[]>`SELECT * FROM approvals WHERE proposal_id = ANY(${ids}) AND user_id = ${userId} ORDER BY created_at ASC` : Promise.resolve([]),
      ids.length && (await tableExists(sql, "proposal_versions"))
        ? sql<Record<string, unknown>[]>`SELECT proposal_id, version, content, proposed_price, currency, source, created_at FROM proposal_versions WHERE proposal_id = ANY(${ids}) ORDER BY version DESC LIMIT 100`
        : Promise.resolve([]),
      sql<Record<string, unknown>[]>`
        SELECT a.id, a.proposal_id, a.channel, a.status, a.recipient, a.external_ref, a.sent_at, a.created_at,
               (SELECT count(*)::int FROM application_messages m WHERE m.application_id = a.id AND m.direction = 'in') AS replies
        FROM applications a WHERE a.opportunity_id = ${oppId} AND a.user_id = ${userId} ORDER BY a.created_at ASC LIMIT 20
      `.catch(() => [] as Record<string, unknown>[]),
      ready
        ? sql<Record<string, unknown>[]>`SELECT id, kind, from_status, to_status, note, due_date, done_at, application_id, created_at FROM opportunity_events WHERE opportunity_id = ${oppId} ORDER BY created_at DESC LIMIT 200`
        : Promise.resolve([])
    ]);
    const status = String(opp.status || "new");
    return success(
      {
        opportunity: oppOut(opp),
        analysis: analyseOpportunity(opp, profile, deps.now()),
        proposals: proposals.map((p) => ({
          ...proposalOut(p),
          versions: versions.filter((v) => v.proposal_id === p.id).map((v) => ({
            version: Number(v.version), content: String(v.content), proposed_price: v.proposed_price === null ? null : Number(v.proposed_price),
            currency: String(v.currency), source: String(v.source), created_at: iso(v.created_at)
          })),
          approvals: approvals.filter((a) => a.proposal_id === p.id).map((a) => ({ id: a.id, decision: a.decision, note: a.note, created_at: iso(a.created_at), decided_at: iso(a.decided_at) }))
        })),
        applications: applications.map((a) => ({
          id: a.id, proposal_id: a.proposal_id, channel: a.channel, status: a.status, recipient: a.recipient, reference: a.external_ref,
          sent_at: iso(a.sent_at), created_at: iso(a.created_at), replies: Number(a.replies ?? 0)
        })),
        events: eventRows.map((e) => ({ ...e, due_date: day(e.due_date), done_at: iso(e.done_at), created_at: iso(e.created_at) })),
        status,
        allowed_transitions: allowedTransitions(status),
        next_step: nextStep(status),
        history_available: ready,
        external_notice: "Apply, sign the contract and get paid on the original platform. This record tracks your work on it; it never moves money."
      },
      "Opportunity timeline",
      200,
      requestId
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
