import type { Env } from "../types";
import { rankEvidence, ruleAnswer } from "./agent-complete";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database, safeHttpUrl, textArray } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { reserveAiCall, settleAiCall } from "./ai-governor";
import { fenceInstruction, fenceUntrusted, newFenceId, reviewGeneratedText } from "./ai-guard";

/**
 * Freelancer business workspace on the Edge API (ports of the Python routes
 * behind /workspace, /agent and /coach, K-01), extended with marketplace data.
 *
 *   GET /api/v1/business-goals            PUT {monthly_income_target, weekly_hours_target, monthly_proposals_target, monthly_outreach_target, currency}
 *   GET /api/v1/workspace/overview        counts, alerts and deterministic recommendations from saved records
 *   GET /api/v1/workspace/events?limit=
 *   GET /api/v1/agent/action-plan?limit=  one prioritised, evidence-linked queue (read-only; nothing is executed)
 *   POST /api/v1/coach/ask {question}     F11 Business Coach: answers only from the account's records, cited; template fallback
 *   GET /api/v1/coach/history?limit=
 *
 * Every number comes from the caller's own records (or organisations they
 * manage). Legacy tables that are missing count as "not available" instead of
 * failing the page. Nothing here sends, submits, pays or changes records other
 * than goals, the event log and the coach history.
 */

export interface BusinessRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
  now?: () => Date;
}

const defaultDeps: BusinessRouteDeps = { database, authenticate: authenticateRequest };

const DEFAULT_GOALS = { monthly_income_target: 0, weekly_hours_target: 10, monthly_proposals_target: 4, monthly_outreach_target: 10, currency: "INR" };
const GOAL_FIELDS = new Set(Object.keys(DEFAULT_GOALS));

/** Runs a single-value query; a missing legacy table or column gives null instead of an error. */
async function tolerant<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch {
    return null;
  }
}

async function countOf(sql: Queryable, run: (q: Queryable) => Promise<Array<{ n: number | string | null }>>): Promise<number | null> {
  const rows = await tolerant(() => run(sql));
  return rows ? Number(rows[0]?.n ?? 0) : null;
}

export type GoalsInput = typeof DEFAULT_GOALS;

/** Validates a goals update. Pure; exported for tests. */
export function validateGoals(input: Record<string, unknown>): { ok: true; value: Partial<GoalsInput> } | { ok: false; message: string } {
  const value: Partial<GoalsInput> = {};
  for (const key of Object.keys(input)) {
    if (!GOAL_FIELDS.has(key)) return { ok: false, message: "Unsupported goal fields" };
  }
  if (input.currency !== undefined) {
    if (typeof input.currency !== "string" || !/^[A-Za-z]{3,8}$/.test(input.currency.trim())) return { ok: false, message: "Currency must be a 3-8 letter code" };
    value.currency = input.currency.trim().toUpperCase();
  }
  for (const key of ["monthly_proposals_target", "monthly_outreach_target"] as const) {
    if (input[key] === undefined) continue;
    const n = Number(input[key]);
    if (typeof input[key] === "boolean" || !Number.isInteger(n) || n < 0 || n > 10_000) return { ok: false, message: `${key} must be a whole number between 0 and 10000` };
    value[key] = n;
  }
  for (const [key, upper] of [["monthly_income_target", 1_000_000_000], ["weekly_hours_target", 168]] as const) {
    if (input[key] === undefined) continue;
    const n = Number(input[key]);
    if (typeof input[key] === "boolean" || !Number.isFinite(n) || n < 0 || n > upper) return { ok: false, message: `${key} must be between 0 and ${upper}` };
    value[key] = n;
  }
  return { ok: true, value };
}

/* ------------------------------------------------------------------ */
/* Action plan                                                         */
/* ------------------------------------------------------------------ */

export interface Action {
  priority: number;
  category: "finance" | "delivery" | "approval" | "communication" | "pipeline";
  title: string;
  reason: string;
  evidence: { type: string; id: string };
  suggested_action: string;
  due_date: string | null;
  requires_human_approval: true;
  href?: string;
  /** Which side of the account the action belongs to (null: account-wide). The pages show one side at a time. */
  side: "freelancer" | "client" | null;
}

export function duePriority(due: string | null, today: string, overdue = 1, onDay = 2, upcoming = 3): number {
  if (!due) return upcoming;
  if (due < today) return overdue;
  if (due === today) return onDay;
  return upcoming;
}

/** The first `limit` items of each side (account-wide items count for both), in the original order. Pure; exported for tests. */
export function topPerSide<T extends { side: "freelancer" | "client" | null }>(items: T[], limit: number): T[] {
  let f = 0;
  let c = 0;
  return items.filter((a) => {
    const forF = a.side !== "client" && f < limit;
    const forC = a.side !== "freelancer" && c < limit;
    if (a.side !== "client" && forF) f += 1;
    if (a.side !== "freelancer" && forC) c += 1;
    return forF || forC;
  });
}

/** Sorts by priority, then due date (undated last), then title. Pure; exported for tests. */
export function sortActions(actions: Action[]): Action[] {
  return [...actions].sort((a, b) => a.priority - b.priority || (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.title.localeCompare(b.title));
}

async function managedOrganizations(sql: Queryable, userId: string): Promise<string[]> {
  const rows = await tolerant(() => sql<{ organization_id: string }[]>`
    SELECT organization_id FROM organization_memberships WHERE user_id = ${userId} AND role IN ('owner', 'admin') AND status = 'active'
  `);
  return (rows ?? []).map((r) => r.organization_id);
}

export async function buildActionPlan(sql: Queryable, userId: string, today: string): Promise<Action[]> {
  const actions: Action[] = [];
  const add = (a: Omit<Action, "requires_human_approval">) => actions.push({ ...a, requires_human_approval: true });
  const orgs = await managedOrganizations(sql, userId);

  /* Marketplace — freelancer side */
  const offers = await tolerant(() => sql<{ id: string; title: string }[]>`
    SELECT c.id, v.title FROM contracts c JOIN contract_versions v ON v.contract_id = c.id AND v.version = c.current_version
    WHERE c.freelancer_user_id = ${userId} AND c.status = 'offered' AND v.freelancer_accepted_at IS NULL LIMIT 50
  `);
  for (const o of offers ?? []) add({ side: "freelancer", priority: 1, category: "pipeline", title: `Answer the offer: ${o.title}`, reason: "A client sent you contract terms.", evidence: { type: "contract", id: o.id }, suggested_action: "Accept, propose changes or decline the offer.", due_date: null, href: `/contracts#${o.id}` });

  const invitations = await tolerant(() => sql<{ id: string; listing_id: string }[]>`
    SELECT id, listing_id FROM listing_invitations WHERE freelancer_user_id = ${userId} AND status = 'pending' LIMIT 50
  `);
  for (const i of invitations ?? []) add({ side: "freelancer", priority: 2, category: "pipeline", title: "Reply to a project invitation", reason: "A client invited you to send a proposal.", evidence: { type: "listing_invitation", id: i.id }, suggested_action: "Open the project and send a proposal or decline.", due_date: null, href: "/projects" });

  const latestByMilestone = await tolerant(() => sql<{ contract_id: string; milestone_index: number; status: string; title: string }[]>`
    SELECT DISTINCT ON (s.contract_id, s.milestone_index) s.contract_id, s.milestone_index, s.status, v.title
    FROM milestone_submissions s JOIN contracts c ON c.id = s.contract_id
    JOIN contract_versions v ON v.contract_id = c.id AND v.version = COALESCE(c.agreed_version, c.current_version)
    WHERE c.freelancer_user_id = ${userId} AND c.status = 'active'
    ORDER BY s.contract_id, s.milestone_index, s.submitted_at DESC
  `);
  for (const r of (latestByMilestone ?? []).filter((x) => x.status === "revision_requested")) {
    add({ side: "freelancer", priority: 1, category: "delivery", title: `Revise ${r.title}, milestone ${Number(r.milestone_index) + 1}`, reason: "The client requested a revision.", evidence: { type: "contract", id: r.contract_id }, suggested_action: "Read the client's feedback and deliver again.", due_date: null, href: `/contracts#${r.contract_id}` });
  }

  /* Marketplace — client side (organisations the user manages) */
  if (orgs.length) {
    const reviews = await tolerant(() => sql<{ contract_id: string; milestone_index: number; title: string }[]>`
      SELECT s.contract_id, s.milestone_index, v.title FROM milestone_submissions s JOIN contracts c ON c.id = s.contract_id
      JOIN contract_versions v ON v.contract_id = c.id AND v.version = COALESCE(c.agreed_version, c.current_version)
      WHERE c.organization_id = ANY(${textArray(orgs)}::text[]) AND c.status = 'active' AND s.status = 'submitted' ORDER BY s.submitted_at ASC LIMIT 50
    `);
    for (const r of reviews ?? []) add({ side: "client", priority: 1, category: "delivery", title: `Review delivery: ${r.title}, milestone ${Number(r.milestone_index) + 1}`, reason: "The freelancer delivered work and is waiting for your decision.", evidence: { type: "contract", id: r.contract_id }, suggested_action: "Check the work against the acceptance criteria, then approve or request a revision.", due_date: null, href: `/contracts#${r.contract_id}` });

    const proposals = await tolerant(() => sql<{ listing_id: string; n: number }[]>`
      SELECT p.listing_id, count(*)::int AS n FROM listing_proposals p JOIN project_listings l ON l.id = p.listing_id
      WHERE l.organization_id = ANY(${textArray(orgs)}::text[]) AND p.status = 'submitted' GROUP BY p.listing_id LIMIT 50
    `);
    for (const p of proposals ?? []) add({ side: "client", priority: 2, category: "pipeline", title: `${p.n} new proposal${Number(p.n) === 1 ? "" : "s"} to review`, reason: "Freelancers replied to your project.", evidence: { type: "project_listing", id: p.listing_id }, suggested_action: "Compare proposals, shortlist or decline.", due_date: null, href: "/client/projects" });

    const clientOffers = await tolerant(() => sql<{ id: string; title: string }[]>`
      SELECT c.id, v.title FROM contracts c JOIN contract_versions v ON v.contract_id = c.id AND v.version = c.current_version
      WHERE c.organization_id = ANY(${textArray(orgs)}::text[]) AND c.status = 'offered' AND v.client_accepted_at IS NULL LIMIT 50
    `);
    for (const o of clientOffers ?? []) add({ side: "client", priority: 1, category: "pipeline", title: `Answer proposed terms: ${o.title}`, reason: "The freelancer proposed different terms.", evidence: { type: "contract", id: o.id }, suggested_action: "Accept the terms or propose changes.", due_date: null, href: `/contracts#${o.id}` });
  }

  /* Both sides */
  const disputes = await tolerant(() => sql<{ id: string; contract_id: string; side: "freelancer" | "client" }[]>`
    SELECT d.id, d.contract_id, CASE WHEN c.freelancer_user_id = ${userId} THEN 'freelancer' ELSE 'client' END AS side FROM disputes d JOIN contracts c ON c.id = d.contract_id
    WHERE d.status = 'open' AND (c.freelancer_user_id = ${userId} OR c.organization_id = ANY(${textArray(orgs)}::text[])) LIMIT 20
  `);
  for (const d of disputes ?? []) add({ side: d.side === "client" ? "client" : "freelancer", priority: 2, category: "communication", title: "A dispute is open on your contract", reason: "Staff are reviewing the contract record.", evidence: { type: "dispute", id: d.id }, suggested_action: "Add your statement and any evidence.", due_date: null, href: `/contracts#${d.contract_id}` });

  /* Legacy records (Python-era tables; skipped when absent) */
  const approvals = await tolerant(() => sql<{ id: string }[]>`SELECT id FROM approvals WHERE user_id = ${userId} AND decision = 'pending' ORDER BY created_at ASC LIMIT 50`);
  for (const a of approvals ?? []) add({ side: "freelancer", priority: 2, category: "approval", title: "Review a proposal draft", reason: "A drafted proposal is waiting for your approval.", evidence: { type: "approval", id: a.id }, suggested_action: "Approve, edit or reject; sending stays a separate step.", due_date: null, href: "/" });

  const invoices = await tolerant(() => sql<{ id: string; invoice_number: string; due_date: string }[]>`
    SELECT id, invoice_number, due_date FROM invoices WHERE user_id = ${userId} AND status NOT IN ('paid', 'void', 'cancelled') AND due_date <> '' AND due_date <= ${today} LIMIT 50
  `);
  for (const i of invoices ?? []) add({ side: "freelancer", priority: duePriority(i.due_date, today), category: "finance", title: `Follow up invoice ${i.invoice_number || ""}`.trim(), reason: i.due_date < today ? "The invoice is overdue." : "The invoice is due today.", evidence: { type: "invoice", id: i.id }, suggested_action: "Check whether it was paid and record the payment, or follow up with the client.", due_date: i.due_date });

  const tasks = await tolerant(() => sql<{ id: string; title: string; due_date: string }[]>`
    SELECT id, title, due_date FROM project_tasks WHERE user_id = ${userId} AND status NOT IN ('done', 'completed') AND due_date <> '' AND due_date <= ${today} LIMIT 50
  `);
  for (const t of tasks ?? []) add({ side: "freelancer", priority: duePriority(t.due_date, today), category: "delivery", title: `Handle task: ${t.title}`, reason: t.due_date < today ? "The task is overdue." : "The task is due today.", evidence: { type: "task", id: t.id }, suggested_action: "Finish it or move the date and tell the client.", due_date: t.due_date });

  const reminders = await tolerant(() => sql<{ id: string; due_at: Date | null }[]>`
    SELECT id, due_at FROM follow_up_reminders WHERE user_id = ${userId} AND status = 'open' AND due_at <= now() LIMIT 50
  `);
  for (const r of reminders ?? []) {
    const due = r.due_at ? new Date(r.due_at) : null;
    add({ side: "freelancer", priority: 2, category: "communication", title: "Client follow-up is due", reason: "A follow-up reminder reached its time.", evidence: { type: "follow_up_reminder", id: r.id }, suggested_action: "Read the conversation and decide whether to follow up.", due_date: due && !Number.isNaN(due.getTime()) ? due.toISOString().slice(0, 10) : null });
  }

  return sortActions(actions);
}

/* ------------------------------------------------------------------ */
/* Coach                                                               */
/* ------------------------------------------------------------------ */

interface Evidence { id: string; type: string; text: string }

async function coachEvidence(sql: Queryable, userId: string): Promise<Evidence[]> {
  const out: Evidence[] = [];
  const profile = (await tolerant(() => sql<Record<string, unknown>[]>`SELECT * FROM profiles WHERE user_id = ${userId} LIMIT 1`))?.[0];
  if (profile) out.push({ id: `profile:${String(profile.id ?? userId)}`, type: "profile", text: `headline=${String(profile.headline ?? "")}; skills=${String(profile.skills ?? "")}; services=${String(profile.services ?? "")}; hourly_rate=${String(profile.hourly_rate ?? "")}; weekly_hours=${String(profile.weekly_hours ?? "")}` });
  // U24 (F11 retrieval): the person's own portfolio projects, services for sale and reviews received.
  if (profile && typeof profile.portfolio_items_json === "string") {
    try {
      const items = JSON.parse(profile.portfolio_items_json);
      if (Array.isArray(items)) {
        items.slice(0, 20).forEach((p: Record<string, unknown>, i: number) => out.push({
          id: `portfolio:${i + 1}`, type: "portfolio_project",
          text: `${String(p.title ?? "")}; ${String(p.description ?? "").slice(0, 300)}; skills=${Array.isArray(p.skills) ? p.skills.join(", ") : ""}; year=${String(p.year ?? "")}${p.link ? `; link=${String(p.link)}` : ""}`
        }));
      }
    } catch {
      // Malformed portfolio data is skipped, never guessed.
    }
  }
  const services = await tolerant(() => sql<{ id: string; title: string; status: string; category_slug: string }[]>`
    SELECT id, title, status, category_slug FROM services WHERE freelancer_user_id = ${userId} ORDER BY updated_at DESC LIMIT 10
  `);
  for (const sv of services ?? []) out.push({ id: `service:${sv.id}`, type: "service", text: `${sv.title}; status=${sv.status}; category=${sv.category_slug}` });
  const reviews = await tolerant(() => sql<{ id: string; rating: number; comment: string; title: string }[]>`
    SELECT rv.id, rv.rating, rv.comment, v.title FROM contract_reviews rv
    JOIN contracts c ON c.id = rv.contract_id JOIN contract_versions v ON v.contract_id = c.id AND v.version = COALESCE(c.agreed_version, c.current_version)
    WHERE c.freelancer_user_id = ${userId} AND rv.reviewer_party = 'client'
      AND EXISTS (SELECT 1 FROM contract_reviews rf WHERE rf.contract_id = c.id AND rf.reviewer_party = 'freelancer')
    ORDER BY rv.created_at DESC LIMIT 10
  `);
  for (const r of reviews ?? []) out.push({ id: `review:${r.id}`, type: "review_received", text: `${r.title}; rating=${r.rating}/5; ${String(r.comment ?? "").slice(0, 300)}` });
  const goal = (await tolerant(() => sql<Record<string, unknown>[]>`SELECT * FROM business_goals WHERE user_id = ${userId} LIMIT 1`))?.[0];
  if (goal) out.push({ id: `business_goal:${String(goal.id)}`, type: "business_goal", text: `monthly_income_target=${String(goal.monthly_income_target)} ${String(goal.currency)}; weekly_hours_target=${String(goal.weekly_hours_target)}; monthly_proposals_target=${String(goal.monthly_proposals_target)}` });
  const contracts = await tolerant(() => sql<{ id: string; status: string; title: string; total_minor: string | number; currency: string; side: string }[]>`
    SELECT c.id, c.status, v.title, v.total_minor, v.currency, CASE WHEN c.freelancer_user_id = ${userId} THEN 'freelancer' ELSE 'client' END AS side
    FROM contracts c JOIN contract_versions v ON v.contract_id = c.id AND v.version = COALESCE(c.agreed_version, c.current_version)
    WHERE c.freelancer_user_id = ${userId}
       OR c.organization_id IN (SELECT organization_id FROM organization_memberships WHERE user_id = ${userId} AND status = 'active')
    ORDER BY c.updated_at DESC LIMIT 10
  `);
  for (const c of contracts ?? []) out.push({ id: `contract:${c.id}`, type: "contract", text: `${c.title}; my_side=${c.side}; status=${c.status}; total=${(Number(c.total_minor) / 100).toFixed(2)} ${c.currency}` });
  const proposals = await tolerant(() => sql<{ id: string; status: string; price_minor: string | number; currency: string; title: string }[]>`
    SELECT p.id, p.status, p.price_minor, p.currency, v.title FROM listing_proposals p
    JOIN project_listings l ON l.id = p.listing_id JOIN project_listing_versions v ON v.listing_id = l.id AND v.version = l.current_version
    WHERE p.freelancer_user_id = ${userId} ORDER BY p.created_at DESC LIMIT 10
  `);
  for (const p of proposals ?? []) out.push({ id: `listing_proposal:${p.id}`, type: "marketplace_proposal", text: `${p.title}; status=${p.status}; price=${(Number(p.price_minor) / 100).toFixed(2)} ${p.currency}` });
  const opportunities = await tolerant(() => sql<{ id: string; title: string; status: string; source: string; match_score: number | null }[]>`
    SELECT id, title, status, source, match_score FROM opportunities WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 10
  `);
  for (const o of opportunities ?? []) out.push({ id: `opportunity:${o.id}`, type: "opportunity", text: `${o.title}; status=${o.status}; source=${o.source}; score=${o.match_score ?? ""}` });
  const released = await tolerant(() => sql<{ n: number; net: string | number | null; mode: string }[]>`
    SELECT count(*)::int AS n, COALESCE(sum(i.amount_minor - i.freelancer_fee_minor), 0) AS net, i.mode FROM payment_intents i JOIN contracts c ON c.id = i.contract_id
    WHERE c.freelancer_user_id = ${userId} AND i.status = 'released' AND i.released_at >= date_trunc('month', now()) GROUP BY i.mode
  `);
  for (const r of released ?? []) out.push({ id: `earnings:${r.mode}:this_month`, type: "earnings", text: `released_this_month=${(Number(r.net) / 100).toFixed(2)} INR across ${r.n} milestone(s); mode=${r.mode}${r.mode === "sandbox" ? " (test money, not real income)" : ""}` });
  return out.slice(0, 60);
}

/**
 * U15 "Ask an agent": evidence about one catalogue agent — what it is for, its
 * autonomy ceiling and human gate, and the caller's own recent runs of it.
 * The question is still answered by F11 under the same governor and citation rules.
 */
export async function agentEvidence(sql: Queryable, userId: string, code: string): Promise<Evidence[] | null> {
  const agent = (await tolerant(() => sql<Array<{ code: string; name: string; purpose: string; autonomy_ceiling: string; human_gate: string; status: string; runtime_names_json: string }>>`
    SELECT code, name, purpose, autonomy_ceiling, human_gate, status, runtime_names_json FROM agent_definitions WHERE code = ${code} LIMIT 1
  `))?.[0];
  if (!agent) return null;
  const out: Evidence[] = [{
    id: `agent:${agent.code}`, type: "agent",
    text: `${agent.code} ${agent.name}; status=${agent.status}; purpose=${agent.purpose}; autonomy_ceiling=${agent.autonomy_ceiling}; human_gate=${agent.human_gate}`
  }];
  let names: string[] = [];
  try { const parsed = JSON.parse(agent.runtime_names_json || "[]"); names = Array.isArray(parsed) ? parsed.map(String) : []; } catch { names = []; }
  if (names.length) {
    const runs = await tolerant(() => sql<Array<{ id: string; status: string; summary: string; created_at: Date }>>`
      SELECT id, status, summary, created_at FROM agent_runs
      WHERE user_id = ${userId} AND agent_name = ANY(${textArray(names)}::text[]) ORDER BY created_at DESC LIMIT 15
    `);
    for (const r of runs ?? []) out.push({ id: `agent_run:${r.id}`, type: "agent_run", text: `${new Date(r.created_at).toISOString().slice(0, 16)} status=${r.status}; ${String(r.summary ?? "").slice(0, 300)}` });
  }
  return out;
}

export function validateCitations(answer: string, known: Set<string>): { valid: string[]; unknown: string[]; has_valid_citation: boolean } {
  const cited = [...answer.matchAll(/\[([A-Za-z0-9_:.-]+)\]/g)].map((m) => m[1]);
  const valid = [...new Set(cited.filter((c) => known.has(c)))].sort();
  const unknown = [...new Set(cited.filter((c) => !known.has(c)))].sort();
  return { valid, unknown, has_valid_citation: valid.length > 0 };
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

export async function handleBusinessRoute(request: Request, env: Env, requestId: string, deps: BusinessRouteDeps = defaultDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const known =
    (path === "/api/v1/business-goals" && (method === "GET" || method === "PUT")) ||
    (method === "GET" && ["/api/v1/workspace/overview", "/api/v1/workspace/events", "/api/v1/agent/action-plan", "/api/v1/coach/history"].includes(path)) ||
    (method === "POST" && path === "/api/v1/coach/ask");
  if (!known) return null;

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const now = (deps.now ?? (() => new Date()))();
  const today = now.toISOString().slice(0, 10);
  const sql = deps.database(env);
  const limitParam = (fallback: number, max: number) => Math.min(max, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "", 10) || fallback));
  const logEvent = (eventType: string, entityType: string, entityId: string, detail: string) =>
    tolerant(() => sql`
      INSERT INTO business_workspace_events (id, user_id, event_type, entity_type, entity_id, detail, created_at)
      VALUES (${crypto.randomUUID()}, ${userId}, ${eventType}, ${entityType}, ${entityId}, ${detail}, now())
    `);

  try {
    if (path === "/api/v1/business-goals" && method === "GET") {
      const goal = (await tolerant(() => sql<(GoalsInput & { updated_at: Date | null })[]>`SELECT * FROM business_goals WHERE user_id = ${userId} LIMIT 1`))?.[0];
      if (!goal) return success({ ...DEFAULT_GOALS, configured: false }, "Business goals", 200, requestId);
      return success({ ...goalOut(goal), configured: true }, "Business goals", 200, requestId);
    }

    if (path === "/api/v1/business-goals") {
      const checked = validateGoals((await body(request)) ?? {});
      if (!checked.ok) return failure("INVALID_GOALS", checked.message, 422, requestId);
      const current = (await sql<(GoalsInput & { updated_at: Date | null })[]>`SELECT * FROM business_goals WHERE user_id = ${userId} LIMIT 1`)[0];
      const next = { ...DEFAULT_GOALS, ...(current ? goalOut(current) : {}), ...checked.value };
      const rows = await sql<(GoalsInput & { updated_at: Date | null })[]>`
        INSERT INTO business_goals (id, user_id, monthly_income_target, weekly_hours_target, monthly_proposals_target, monthly_outreach_target, currency, updated_at)
        VALUES (${crypto.randomUUID()}, ${userId}, ${next.monthly_income_target}, ${next.weekly_hours_target}, ${next.monthly_proposals_target}, ${next.monthly_outreach_target}, ${next.currency}, now())
        ON CONFLICT (user_id) DO UPDATE SET monthly_income_target = EXCLUDED.monthly_income_target, weekly_hours_target = EXCLUDED.weekly_hours_target,
          monthly_proposals_target = EXCLUDED.monthly_proposals_target, monthly_outreach_target = EXCLUDED.monthly_outreach_target,
          currency = EXCLUDED.currency, updated_at = now()
        RETURNING *
      `;
      await logEvent("goal_updated", "business_goal", "", "Business targets updated");
      return success({ ...goalOut(rows[0]), configured: true }, "Business goals saved", 200, requestId);
    }

    if (path === "/api/v1/workspace/events") {
      const rows = await tolerant(() => sql<{ id: string; event_type: string; entity_type: string; entity_id: string; detail: string; created_at: Date }[]>`
        SELECT id, event_type, entity_type, entity_id, detail, created_at FROM business_workspace_events WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT ${limitParam(50, 200)}
      `);
      return success((rows ?? []).map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() })), "Workspace events", 200, requestId);
    }

    if (path === "/api/v1/workspace/overview") {
      return success(await overview(sql, userId, today), "Workspace overview", 200, requestId);
    }

    if (path === "/api/v1/agent/action-plan") {
      const all = await buildActionPlan(sql, userId, today);
      const limit = limitParam(12, 50);
      return success(
        {
          as_of_date: today,
          actions: all.slice(0, limit),
          total_actionable_records: all.length,
          returned_actions: Math.min(limit, all.length),
          policy: "Recommendations only, built from your own records. Nothing is sent, submitted, approved or paid automatically.",
          data_scope: "Authenticated account records only"
        },
        "Action plan",
        200,
        requestId
      );
    }

    if (path === "/api/v1/coach/history") {
      const rows = await tolerant(() => sql<{ id: string; question: string; answer: string; sources_json: string; generation_mode: string; created_at: Date }[]>`
        SELECT id, question, answer, sources_json, generation_mode, created_at FROM coach_interactions WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT ${limitParam(20, 100)}
      `);
      return success(
        (rows ?? []).map((r) => ({ id: r.id, question: r.question, answer: r.answer, sources: safeJson(r.sources_json), generation_mode: r.generation_mode, created_at: new Date(r.created_at).toISOString() })),
        "Coach history",
        200,
        requestId
      );
    }

    // POST /coach/ask
    const payload = (await body(request)) ?? {};
    const question = typeof payload.question === "string" ? payload.question.trim() : "";
    if (!question || question.length > 2000) return failure("INVALID_QUESTION", "Ask a question of up to 2,000 characters.", 422, requestId);
    const agentCode = typeof payload.agent === "string" && /^[CFP]\d{1,2}$/.test(payload.agent) ? payload.agent : null;
    // F11 retrieval (U24): the person's records ranked by how closely they match the question; the profile stays first.
    const ranked = rankEvidence(question, await coachEvidence(sql, userId), 25);
    let evidence: Array<Evidence & { relevance?: number }> = ranked;
    if (agentCode) {
      const extra = await agentEvidence(sql, userId, agentCode);
      if (!extra) return failure("NOT_FOUND", "Agent not found", 404, requestId);
      evidence = [...extra, ...ranked].slice(0, 40);
    }
    const sources = evidence.map((e) => ({ id: e.id, type: e.type, excerpt: e.text.slice(0, 320), relevance: e.relevance ?? null }));
    let answer: string;
    let mode: "llm_grounded_context" | "rules_fallback" = "rules_fallback";
    const inventory = () => {
      const counts: Record<string, number> = {};
      for (const e of evidence) counts[e.type] = (counts[e.type] ?? 0) + 1;
      return Object.entries(counts).sort().map(([k, v]) => `${v} ${k} record(s)`).join(", ");
    };
    if (!evidence.length) {
      answer = "I do not have enough saved records to answer this reliably yet. Add your profile, goals, proposals or contracts, then ask again.";
    } else {
      answer = ruleAnswer(question, ranked);
      if (env.AI) {
        const fenceId = newFenceId();
        const system =
          "You are a cautious freelance-business coach. Answer only from the supplied account evidence. " + fenceInstruction(fenceId) + " " +
          "Do not invent amounts, dates, clients, outcomes or metrics. If evidence is insufficient, say exactly what is missing. " +
          "Cite factual claims with the exact evidence IDs in square brackets, for example [contract:abc]. Give practical next steps. " +
          "Never claim to send messages, submit proposals, deliver work, issue invoices or move money. Test-mode earnings are not real income.";
        const context = evidence.map((e) => `[${e.id}] ${e.text}`).join("\n").slice(0, 12_000);
        const prompt = `${agentCode ? `The question is about agent ${agentCode}; its own evidence lines come first.\n` : ""}QUESTION:\n${fenceUntrusted("question", question, fenceId, 2000)}\n\nACCOUNT EVIDENCE (each line starts with its citation ID):\n${fenceUntrusted("evidence", context, fenceId, 12_000)}\n\nAnswer concisely with cited evidence IDs and next steps.`;
        const decision = await reserveAiCall(env, sql, { userId, operation: "business_coach", inputChars: system.length + prompt.length, maxOutputTokens: 700 });
        if (!decision.allowed) {
          answer = `${decision.message} I found ${inventory()}; review them below.`;
        } else {
          try {
            const result = (await env.AI.run(env.WORKERS_AI_MODEL || "@cf/meta/llama-3.1-8b-instruct", {
              messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
              max_tokens: 700
            })) as { response?: string } | null;
            const raw = (result?.response ?? "").trim();
            await settleAiCall(env, sql, decision.eventId, system.length + prompt.length, raw.length);
            const review = reviewGeneratedText(raw, { price: null, allowedLinks: [] });
            if (raw && !review.blocked) {
              answer = raw.slice(0, 6000);
              mode = "llm_grounded_context";
            } else if (review.blocked) {
              console.warn(JSON.stringify({ event: "ai.output_blocked", operation: "business_coach", codes: review.issues.map((i) => i.code) }));
            }
          } catch (error) {
            console.error(JSON.stringify({ event: "coach.ai_failed", error_message: error instanceof Error ? error.message : "unknown" }));
          }
        }
      }
    }
    const citations = validateCitations(answer, new Set(evidence.map((e) => e.id)));
    const id = crypto.randomUUID();
    const saved = await tolerant(() => sql`
      INSERT INTO coach_interactions (id, user_id, question, answer, sources_json, generation_mode, created_at)
      VALUES (${id}, ${userId}, ${question}, ${answer}, ${JSON.stringify(sources)}, ${mode}, now())
    `);
    if (saved) await logEvent("coach_question", "coach_interaction", id, "Business coach question answered");
    return success(
      {
        id, question, answer, sources, generation_mode: mode, created_at: now.toISOString(),
        citation_validation: { ...citations, note: "Citation IDs are checked against the records given to the model; this does not prove every sentence." },
        policy: "Account-scoped evidence only. Advice only; any action needs your own decision."
      },
      "Coach answer",
      200,
      requestId
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export interface Deadline { contract_id: string; title: string; milestone: number; milestone_title: string; due_date: string; overdue: boolean; side: "freelancer" | "client" }

/**
 * Milestones due within `days` (or overdue) that are not approved yet. Pure;
 * exported for tests. `approved` holds "contractId:index" of approved milestones.
 */
export function upcomingDeadlines(
  contracts: Array<{ id: string; title: string; milestones_json: string; side: "freelancer" | "client" }>,
  approved: Set<string>,
  today: string,
  days = 14
): Deadline[] {
  const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const out: Deadline[] = [];
  for (const c of contracts) {
    let milestones: Array<{ title?: unknown; due_date?: unknown }> = [];
    try {
      const parsed = JSON.parse(c.milestones_json || "[]");
      milestones = Array.isArray(parsed) ? parsed : [];
    } catch {
      milestones = [];
    }
    milestones.forEach((m, i) => {
      const due = typeof m.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(m.due_date) ? m.due_date : null;
      if (!due || due > horizon || approved.has(`${c.id}:${i}`)) return;
      out.push({ contract_id: c.id, title: c.title, milestone: i, milestone_title: String(m.title ?? `Milestone ${i + 1}`), due_date: due, overdue: due < today, side: c.side });
    });
  }
  return out.sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 20);
}

function goalOut(goal: GoalsInput & { updated_at?: Date | null }) {
  return {
    monthly_income_target: Number(goal.monthly_income_target),
    weekly_hours_target: Number(goal.weekly_hours_target),
    monthly_proposals_target: Number(goal.monthly_proposals_target),
    monthly_outreach_target: Number(goal.monthly_outreach_target),
    currency: goal.currency,
    updated_at: goal.updated_at ? new Date(goal.updated_at).toISOString() : null
  };
}

function safeJson(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function overview(sql: Queryable, userId: string, today: string) {
  const goalRow = (await tolerant(() => sql<(GoalsInput & { updated_at: Date | null })[]>`SELECT * FROM business_goals WHERE user_id = ${userId} LIMIT 1`))?.[0];
  const goals = goalRow ? goalOut(goalRow) : DEFAULT_GOALS;
  const monthStart = `${today.slice(0, 7)}-01`;
  const orgs = await managedOrganizations(sql, userId);
  const [opportunities, openOpportunities, proposals, monthProposals, pendingApprovals, activeProjects, overdueInvoices, overdueTasks, pendingEmails, marketplaceProposals, activeContractsFreelancer, activeContractsClient, awaitingClientReview, deliveriesToReview] = await Promise.all([
    countOf(sql, (q) => q`SELECT count(*)::int AS n FROM opportunities WHERE user_id = ${userId}`),
    countOf(sql, (q) => q`SELECT count(*)::int AS n FROM opportunities WHERE user_id = ${userId} AND status IN ('new', 'reviewed', 'shortlisted')`),
    countOf(sql, (q) => q`SELECT count(*)::int AS n FROM proposals WHERE user_id = ${userId}`),
    countOf(sql, (q) => q`SELECT count(*)::int AS n FROM proposals WHERE user_id = ${userId} AND created_at >= ${monthStart}`),
    countOf(sql, (q) => q`SELECT count(*)::int AS n FROM approvals WHERE user_id = ${userId} AND decision = 'pending'`),
    countOf(sql, (q) => q`SELECT count(*)::int AS n FROM projects WHERE user_id = ${userId} AND status IN ('active', 'in_progress')`),
    countOf(sql, (q) => q`SELECT count(*)::int AS n FROM invoices WHERE user_id = ${userId} AND status IN ('unpaid', 'overdue') AND due_date <> '' AND due_date < ${today}`),
    countOf(sql, (q) => q`SELECT count(*)::int AS n FROM project_tasks WHERE user_id = ${userId} AND status NOT IN ('done', 'completed') AND due_date <> '' AND due_date < ${today}`),
    countOf(sql, (q) => q`SELECT count(*)::int AS n FROM email_drafts WHERE user_id = ${userId} AND status = 'pending_approval'`),
    countOf(sql, (q) => q`SELECT count(*)::int AS n FROM listing_proposals WHERE freelancer_user_id = ${userId} AND created_at >= ${monthStart}`),
    countOf(sql, (q) => q`SELECT count(*)::int AS n FROM contracts WHERE freelancer_user_id = ${userId} AND status = 'active'`),
    orgs.length ? countOf(sql, (q) => q`SELECT count(*)::int AS n FROM contracts WHERE organization_id = ANY(${textArray(orgs)}::text[]) AND status = 'active'`) : Promise.resolve(0),
    countOf(sql, (q) => q`SELECT count(*)::int AS n FROM milestone_submissions s JOIN contracts c ON c.id = s.contract_id WHERE c.freelancer_user_id = ${userId} AND s.status = 'submitted'`),
    orgs.length ? countOf(sql, (q) => q`SELECT count(*)::int AS n FROM milestone_submissions s JOIN contracts c ON c.id = s.contract_id WHERE c.organization_id = ANY(${textArray(orgs)}::text[]) AND s.status = 'submitted'`) : Promise.resolve(0)
  ]);
  const paidRows = await tolerant(() => sql<{ currency: string; total: string | number }[]>`
    SELECT currency, COALESCE(sum(amount), 0) AS total FROM invoices WHERE user_id = ${userId} AND status = 'paid' AND created_at >= ${monthStart} GROUP BY currency
  `);
  const released = await tolerant(() => sql<{ mode: string; net: string | number }[]>`
    SELECT i.mode, COALESCE(sum(i.amount_minor - i.freelancer_fee_minor), 0) AS net FROM payment_intents i JOIN contracts c ON c.id = i.contract_id
    WHERE c.freelancer_user_id = ${userId} AND i.status = 'released' AND i.released_at >= ${monthStart} GROUP BY i.mode
  `);
  const actions = await buildActionPlan(sql, userId, today);
  // What to apply for: best open external matches and the newest native projects that fit the profile's skills.
  const topExternal = await tolerant(() => sql<{ id: string; title: string; source: string; match_score: number; source_url: string }[]>`
    SELECT id, title, source, match_score, source_url FROM opportunities WHERE user_id = ${userId} AND status = 'new' ORDER BY match_score DESC, created_at DESC LIMIT 3
  `);
  const invitedNative = await tolerant(() => sql<{ id: string; title: string }[]>`
    SELECT l.id, v.title FROM listing_invitations i JOIN project_listings l ON l.id = i.listing_id
    JOIN project_listing_versions v ON v.listing_id = l.id AND v.version = l.current_version
    WHERE i.freelancer_user_id = ${userId} AND i.status = 'pending' AND l.status IN ('published', 'hiring') ORDER BY i.created_at DESC LIMIT 3
  `);
  const contractRows = await tolerant(() => sql<{ id: string; title: string; milestones_json: string; side: "freelancer" | "client" }[]>`
    SELECT c.id, v.title, v.milestones_json, CASE WHEN c.freelancer_user_id = ${userId} THEN 'freelancer' ELSE 'client' END AS side
    FROM contracts c JOIN contract_versions v ON v.contract_id = c.id AND v.version = COALESCE(c.agreed_version, c.current_version)
    WHERE c.status = 'active' AND (c.freelancer_user_id = ${userId} OR c.organization_id = ANY(${textArray(orgs)}::text[]))
    LIMIT 50
  `);
  const approvedRows = contractRows?.length ? await tolerant(() => sql<{ contract_id: string; milestone_index: number }[]>`
    SELECT DISTINCT contract_id, milestone_index FROM milestone_submissions WHERE contract_id = ANY(${textArray(contractRows.map((c) => c.id))}::text[]) AND status = 'approved'
  `) : [];
  const deadlines = upcomingDeadlines(contractRows ?? [], new Set((approvedRows ?? []).map((r) => `${r.contract_id}:${Number(r.milestone_index)}`)), today);
  const pending = await tolerant(() => sql<{ mode: string; net: string | number; n: number }[]>`
    SELECT i.mode, COALESCE(sum(i.amount_minor - i.freelancer_fee_minor), 0) AS net, count(*)::int AS n FROM payment_intents i JOIN contracts c ON c.id = i.contract_id
    WHERE c.freelancer_user_id = ${userId} AND i.status = 'funded' GROUP BY i.mode
  `);
  const top = topPerSide(actions.filter((a) => a.priority <= 2), 8);
  const alerts = top.map((a, i) => ({ id: `${a.evidence.type}-${i}`, severity: a.priority === 1 ? "high" : "medium", title: a.title, action: a.suggested_action, href: a.href ?? "/agent", side: a.side }));
  const recommendations: Array<{ priority: string; title: string; reason: string; evidence: Array<{ type: string; value: number }>; action: string; side: "freelancer" | "client" | null }> = [];
  if ((deliveriesToReview ?? 0) > 0) recommendations.push({ side: "client", priority: "high", title: "Unblock your freelancers", reason: "Deliveries are waiting for your review.", evidence: [{ type: "deliveries_to_review", value: deliveriesToReview ?? 0 }], action: "Review each delivery against its acceptance criteria." });
  if ((overdueInvoices ?? 0) > 0) recommendations.push({ side: "freelancer", priority: "high", title: "Protect cash flow", reason: "Overdue invoices are present in your records.", evidence: [{ type: "overdue_invoices", value: overdueInvoices ?? 0 }], action: "Review overdue invoices and record verified payments." });
  if ((pendingApprovals ?? 0) > 0) recommendations.push({ side: "freelancer", priority: "medium", title: "Clear proposal review queue", reason: "Proposal drafts are awaiting your decision.", evidence: [{ type: "pending_approvals", value: pendingApprovals ?? 0 }], action: "Approve, edit or reject each draft." });
  if ((marketplaceProposals ?? 0) + (monthProposals ?? 0) < goals.monthly_proposals_target) recommendations.push({ side: "freelancer", priority: "medium", title: "Behind your proposal target", reason: "Proposals this month are below your monthly target.", evidence: [{ type: "proposals_this_month", value: (marketplaceProposals ?? 0) + (monthProposals ?? 0) }, { type: "monthly_target", value: goals.monthly_proposals_target }], action: "Open Find work and reply to projects that match your skills." });
  if (!recommendations.length) recommendations.push({ side: null, priority: "low", title: "Keep records current", reason: "No urgent action was detected from your saved records.", evidence: [{ type: "open_actions", value: actions.length }], action: "Keep contracts, deliveries and goals up to date for better recommendations." });
  return {
    as_of: today,
    metrics: {
      opportunities, open_opportunities: openOpportunities, proposals, month_proposals: (monthProposals ?? 0) + (marketplaceProposals ?? 0),
      pending_proposal_approvals: pendingApprovals, active_projects: activeProjects, overdue_invoices: overdueInvoices, overdue_tasks: overdueTasks,
      pending_email_approvals: pendingEmails,
      active_contracts_as_freelancer: activeContractsFreelancer, active_contracts_as_client: activeContractsClient,
      deliveries_awaiting_client: awaitingClientReview, deliveries_to_review: deliveriesToReview,
      paid_this_month_by_currency: Object.fromEntries((paidRows ?? []).map((r) => [r.currency, Number(r.total)])),
      released_this_month_minor: Object.fromEntries((released ?? []).map((r) => [r.mode, Number(r.net)]))
    },
    goals,
    apply_next: {
      external: (topExternal ?? []).map((o) => ({ id: o.id, title: o.title, source: o.source, match_score: Number(o.match_score), source_url: safeHttpUrl(o.source_url) })),
      invitations: (invitedNative ?? []).map((l) => ({ listing_id: l.id, title: l.title }))
    },
    deadlines,
    pending_release: (pending ?? []).map((p) => ({ mode: p.mode, amount_minor: Number(p.net), milestones: Number(p.n) })),
    alerts,
    recommendations,
    data_policy: "Metrics use only records saved in this account (and client accounts you manage). Missing records count as zero; a dash means that kind of record is not available. Test-mode earnings are not real income. Currency totals are not converted."
  };
}
