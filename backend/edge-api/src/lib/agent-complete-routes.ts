import type { Env } from "../types";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database, jsonList, safeHttpUrl, textArray } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { loadRoles, organizationForMember } from "./identity";
import { tableExists } from "./external-pipeline";
import { milestoneEvents } from "./planner-routes";
import { notifyUsers } from "./notify";
import { SOURCE_CATALOGUE } from "./discovery-agent";
import {
  NOTIFICATION_GROUPS, STALE_AFTER_DAYS, NOT_SEEN_DAYS, balanceAlerts, capacityPlan, profileReview, riskFindings, signalKind, spendForecast
} from "./agent-complete";
import type { CapacityInput, CategoryBalance, ForecastHourly, ForecastMilestone, PortfolioProject } from "./agent-complete";

/**
 * Completed agents (U24). Every route reads the caller's own data (or, for
 * staff, platform data) and returns advice; none of them changes a contract,
 * a payment or another person's account.
 *
 *   GET  /api/v1/me/profile-review                       F3  claims without evidence, portfolio feedback
 *   GET  /api/v1/me/capacity                             F7  booked hours, free hours, deadlines per week
 *   GET  /api/v1/analytics/client/forecast?organization_id=   C7  spend still to come (members)
 *   GET  /api/v1/admin/risk-signals                      P1  patterns for staff review (admin, moderator)
 *   GET  /api/v1/admin/balance-alerts                    P7  supply and demand per category (admin, moderator, finance)
 *   POST /api/v1/admin/sources/{code}/terms              P5  terms link, allowed fields, reviewed (admin)
 *   GET  /api/v1/admin/source-takedowns                  P5  takedown log (admin, moderator)
 *   POST /api/v1/admin/source-takedowns                  P5  remove a listing at its owner's request (admin, moderator)
 *   GET  /api/v1/me/notification-settings                P9  groups with on/off
 *   PUT  /api/v1/me/notification-settings {groups: {key: boolean}}   P9
 *
 * Cron jobs (from the 6-hourly schedule): expireStaleOpportunities (F1),
 * runBalanceDigest (P7, once per ISO week).
 */

export interface AgentCompleteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
  now: () => Date;
}

const defaultDeps: AgentCompleteDeps = { database, authenticate: authenticateRequest, now: () => new Date() };
const PENDING = "This needs database migration 0079.";
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

async function recordRun(sql: Queryable, userId: string, name: string, summary: string): Promise<void> {
  await sql`
    INSERT INTO agent_runs (id, user_id, agent_name, status, summary, created_at)
    VALUES (${crypto.randomUUID()}, ${userId}, ${name}, 'completed', ${summary.slice(0, 500)}, now())
  `.catch(() => undefined);
}

/** Records a refused message as a trust signal for P1 (never throws; never blocks the caller). */
export async function recordTrustSignal(
  sql: Queryable,
  userId: string,
  codes: string[],
  context: { type: "proposal" | "contract"; id: string; counterpart_user_id?: string | null; organization_id?: string | null }
): Promise<void> {
  const kind = signalKind(codes);
  if (!kind) return;
  try {
    const candidate = sql as { savepoint?: (cb: (tx: Queryable) => Promise<unknown>) => Promise<unknown> };
    const write = (q: Queryable) => q`
      INSERT INTO trust_signals (id, user_id, kind, context_type, context_id, counterpart_user_id, organization_id, created_at)
      VALUES (${crypto.randomUUID()}, ${userId}, ${kind}, ${context.type}, ${context.id}, ${context.counterpart_user_id ?? null}, ${context.organization_id ?? null}, now())
    `;
    if (typeof candidate.savepoint === "function") await candidate.savepoint(write);
    else await write(sql);
  } catch {
    // Before migration 0079, or any write problem: the refusal itself already happened.
  }
}

/* ---------------- F1: hide stale external jobs ---------------- */

/** Marks open external jobs older than 21 days, not seen at the source for 7 days, as skipped (reversible), with a note. */
export async function expireStaleOpportunities(sql: Queryable, now: Date): Promise<number> {
  const posted = new Date(now.getTime() - STALE_AFTER_DAYS * 86_400_000).toISOString();
  const seen = new Date(now.getTime() - NOT_SEEN_DAYS * 86_400_000).toISOString();
  const rows = await sql<{ id: string; user_id: string }[]>`
    UPDATE opportunities SET status = 'skipped'
    WHERE status = 'new'
      AND COALESCE(published_at, first_seen_at, created_at) < ${posted}::timestamptz
      AND COALESCE(last_seen_at, first_seen_at, created_at) < ${seen}::timestamptz
    RETURNING id, user_id
  `.catch(() => [] as { id: string; user_id: string }[]);
  if (rows.length && (await tableExists(sql, "opportunity_events"))) {
    for (const r of rows) {
      await sql`
        INSERT INTO opportunity_events (id, opportunity_id, user_id, kind, note, created_at)
        VALUES (${crypto.randomUUID()}, ${r.id}, ${r.user_id}, 'note', ${`Hidden automatically: posted over ${STALE_AFTER_DAYS} days ago and not seen at the source for ${NOT_SEEN_DAYS} days. Reopen it if it is still open.`}, now())
      `.catch(() => undefined);
    }
  }
  return rows.length;
}

/* ---------------- P7: data and weekly digest ---------------- */

async function balanceRows(sql: Queryable): Promise<{ rows: CategoryBalance[]; visible: number }> {
  const hasServices = await tableExists(sql, "services");
  const rows = await sql<Array<{ slug: string; name: string; enabled: boolean; open_projects: number; waiting_projects: number; proposals_30d: number; freelancers_90d: number; services_live: number }>>`
    SELECT c.slug, c.name, c.enabled,
      (SELECT count(*)::int FROM project_listings l JOIN project_listing_versions v ON v.listing_id = l.id AND v.version = l.current_version
        WHERE l.category_slug = c.slug AND l.status = 'published' AND l.visibility = 'public') AS open_projects,
      (SELECT count(*)::int FROM project_listings l
        WHERE l.category_slug = c.slug AND l.status = 'published' AND l.published_at < now() - interval '3 days'
          AND NOT EXISTS (SELECT 1 FROM listing_proposals p WHERE p.listing_id = l.id)) AS waiting_projects,
      (SELECT count(*)::int FROM listing_proposals p JOIN project_listings l ON l.id = p.listing_id
        WHERE l.category_slug = c.slug AND p.created_at > now() - interval '30 days') AS proposals_30d,
      (SELECT count(DISTINCT p.freelancer_user_id)::int FROM listing_proposals p JOIN project_listings l ON l.id = p.listing_id
        WHERE l.category_slug = c.slug AND p.created_at > now() - interval '90 days') AS freelancers_90d,
      0 AS services_live
    FROM project_categories c ORDER BY c.sort_order, c.slug
  `;
  if (hasServices) {
    const live = await sql<Array<{ category_slug: string; n: number }>>`SELECT category_slug, count(*)::int AS n FROM services WHERE status = 'published' GROUP BY category_slug`.catch(() => []);
    for (const r of rows) r.services_live = live.find((x) => x.category_slug === r.slug)?.n ?? 0;
  }
  const visible = (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM profiles WHERE marketplace_visible = true`)[0]?.n ?? 0;
  return { rows: rows.map((r) => ({ ...r, open_projects: Number(r.open_projects), waiting_projects: Number(r.waiting_projects), proposals_30d: Number(r.proposals_30d), freelancers_90d: Number(r.freelancers_90d), services_live: Number(r.services_live) })), visible: Number(visible) };
}

/** ISO week label, e.g. 2026-W47. Pure. */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Once per ISO week: admins get one in-app summary of supply and demand alerts (deduplicated by week). */
export async function runBalanceDigest(sql: Queryable, now: Date): Promise<number> {
  try {
    const { rows, visible } = await balanceRows(sql);
    const alerts = balanceAlerts(rows, visible);
    if (!alerts.length) return 0;
    const admins = (await sql<{ user_id: string }[]>`SELECT user_id FROM user_roles WHERE role = 'admin' AND status = 'active'`).map((r) => r.user_id);
    if (!admins.length) return 0;
    const high = alerts.filter((a) => a.severity === "high").length;
    await notifyUsers(sql, admins, {
      kind: "platform.balance",
      title: `Marketplace balance: ${alerts.length} alert${alerts.length === 1 ? "" : "s"}${high ? ` (${high} urgent)` : ""}`,
      message: alerts.slice(0, 3).map((a) => a.message).join(" "),
      link: "/analytics?view=platform",
      dedupe: `balance:${isoWeek(now)}`
    });
    return admins.length;
  } catch {
    return 0;
  }
}

/* ---------------- Routes ---------------- */

export async function handleAgentCompleteRoute(request: Request, env: Env, requestId: string, deps: AgentCompleteDeps = defaultDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const terms = path.match(/^\/api\/v1\/admin\/sources\/([a-z0-9_]{1,40})\/terms$/);
  const known =
    (method === "GET" && ["/api/v1/me/profile-review", "/api/v1/me/capacity", "/api/v1/analytics/client/forecast", "/api/v1/admin/risk-signals", "/api/v1/admin/balance-alerts", "/api/v1/admin/source-takedowns", "/api/v1/me/notification-settings"].includes(path)) ||
    (method === "POST" && (terms !== null || path === "/api/v1/admin/source-takedowns")) ||
    (method === "PUT" && path === "/api/v1/me/notification-settings");
  if (!known) return null;

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);
  try {
    const now = deps.now();
    const today = now.toISOString().slice(0, 10);

    /* ---------- F3 ---------- */
    if (path === "/api/v1/me/profile-review") {
      const p = (await sql<Record<string, unknown>[]>`SELECT * FROM profiles WHERE user_id = ${userId} LIMIT 1`)[0] ?? {};
      let projects: PortfolioProject[] = [];
      try {
        const parsed = JSON.parse(String(p.portfolio_items_json ?? "[]"));
        projects = Array.isArray(parsed) ? parsed.map((x: Record<string, unknown>) => ({ title: String(x.title ?? ""), description: String(x.description ?? ""), skills: Array.isArray(x.skills) ? x.skills.map(String) : [], link: String(x.link ?? ""), year: String(x.year ?? "") })) : [];
      } catch { projects = []; }
      const counts = (await sql<{ completed: number; reviews: number }[]>`
        SELECT (SELECT count(*)::int FROM contracts WHERE freelancer_user_id = ${userId} AND status = 'completed') AS completed,
               (SELECT count(*)::int FROM contract_reviews rv JOIN contracts c ON c.id = rv.contract_id WHERE c.freelancer_user_id = ${userId} AND rv.reviewer_party = 'client') AS reviews
      `.catch(() => [{ completed: 0, reviews: 0 }]))[0];
      const review = profileReview({
        headline: String(p.headline ?? ""), bio: String(p.bio ?? ""),
        skills: jsonList(String(p.skills ?? "[]")), portfolio_links: jsonList(String(p.portfolio_links ?? "[]")),
        projects, completed_contracts: Number(counts?.completed ?? 0), reviews: Number(counts?.reviews ?? 0), hourly_rate: Number(p.hourly_rate ?? 0)
      });
      await recordRun(sql, userId, "profile_review", `Profile review: score ${review.score}, ${review.items.length} notes`);
      return success({ ...review, note: "Advice from rules only. Nothing on your profile was changed." }, "Profile review", 200, requestId);
    }

    /* ---------- F7 ---------- */
    if (path === "/api/v1/me/capacity") {
      const p = (await sql<Array<{ weekly_hours: number | null }>>`SELECT weekly_hours FROM profiles WHERE user_id = ${userId} LIMIT 1`)[0];
      const contracts = await sql<Array<{ id: string; title: string; milestones_json: string; billing: string | null }>>`
        SELECT c.id, v.title, v.milestones_json, (to_jsonb(v)->>'billing_json') AS billing
        FROM contracts c JOIN contract_versions v ON v.contract_id = c.id AND v.version = COALESCE(c.agreed_version, c.current_version)
        WHERE c.status = 'active' AND c.freelancer_user_id = ${userId}
        LIMIT 200
      `;
      const hourly: Array<{ contract_id: string; title: string; weekly_limit_hours: number }> = [];
      const fixed: Array<{ id: string; title: string; milestones_json: string }> = [];
      for (const c of contracts) {
        let b: { type?: string; weekly_limit_hours?: number } = {};
        try { b = c.billing && c.billing.startsWith("{") ? JSON.parse(c.billing) : {}; } catch { b = {}; }
        if (b.type === "hourly") hourly.push({ contract_id: c.id, title: c.title, weekly_limit_hours: Number(b.weekly_limit_hours ?? 0) });
        else fixed.push(c);
      }
      const approved = fixed.length
        ? new Set((await sql<Array<{ contract_id: string; milestone_index: number }>>`
            SELECT DISTINCT contract_id, milestone_index FROM milestone_submissions WHERE contract_id = ANY(${textArray(fixed.map((c) => c.id))}::text[]) AND status = 'approved'
          `).map((r) => `${r.contract_id}:${Number(r.milestone_index)}`))
        : new Set<string>();
      const end = new Date(now.getTime() + 27 * 86_400_000).toISOString().slice(0, 10);
      const events = milestoneEvents(fixed.map((c) => ({ ...c, side: "freelancer" as const })), approved, { from: today, to: end }, today);
      const due: CapacityInput["due"] = events.map((e) => ({ date: e.date, title: e.title, kind: "milestone", contract_id: "" }));
      if (await tableExists(sql, "contract_tasks")) {
        const tasks = await sql<Array<{ contract_id: string; title: string; due_date: string | Date }>>`
          SELECT t.contract_id, t.title, t.due_date FROM contract_tasks t JOIN contracts c ON c.id = t.contract_id
          WHERE c.freelancer_user_id = ${userId} AND c.status = 'active' AND t.owner_party = 'freelancer' AND t.status <> 'done'
            AND t.due_date IS NOT NULL AND t.due_date <= ${end}::date
          LIMIT 200
        `.catch(() => []);
        for (const t of tasks) due.push({ date: String(t.due_date instanceof Date ? t.due_date.toISOString() : t.due_date).slice(0, 10), title: t.title, kind: "task", contract_id: t.contract_id });
      }
      const plan = capacityPlan({ weekly_hours: Number(p?.weekly_hours ?? 0), hourly, due }, today);
      return success(plan, "Capacity", 200, requestId);
    }

    /* ---------- C7 ---------- */
    if (path === "/api/v1/analytics/client/forecast") {
      const orgId = url.searchParams.get("organization_id") ?? "";
      const org = /^[\w-]{1,64}$/.test(orgId) ? await organizationForMember(sql, userId, orgId) : null;
      if (!org) return failure("NOT_FOUND", "Client account not found", 404, requestId);
      const contracts = await sql<Array<{ id: string; title: string; milestones_json: string; billing: string | null; currency: string }>>`
        SELECT c.id, v.title, v.milestones_json, v.currency, (to_jsonb(v)->>'billing_json') AS billing
        FROM contracts c JOIN contract_versions v ON v.contract_id = c.id AND v.version = COALESCE(c.agreed_version, c.current_version)
        WHERE c.organization_id = ${org.id} AND c.status = 'active' LIMIT 200
      `;
      const ids = contracts.map((c) => c.id);
      const [approved, intents] = ids.length
        ? await Promise.all([
            sql<Array<{ contract_id: string; milestone_index: number }>>`SELECT DISTINCT contract_id, milestone_index FROM milestone_submissions WHERE contract_id = ANY(${textArray(ids)}::text[]) AND status = 'approved'`,
            sql<Array<{ contract_id: string; milestone_index: number | null; status: string }>>`SELECT contract_id, milestone_index, status FROM payment_intents WHERE contract_id = ANY(${textArray(ids)}::text[]) AND status IN ('funded', 'released') AND milestone_index IS NOT NULL`.catch(() => [])
          ])
        : [[], []];
      const done = new Set(approved.map((a) => `${a.contract_id}:${Number(a.milestone_index)}`));
      const funded = new Set(intents.filter((i) => i.status === "funded").map((i) => `${i.contract_id}:${Number(i.milestone_index)}`));
      const released = new Set(intents.filter((i) => i.status === "released").map((i) => `${i.contract_id}:${Number(i.milestone_index)}`));
      const milestones: ForecastMilestone[] = [];
      const hourly: ForecastHourly[] = [];
      for (const c of contracts) {
        let b: { type?: string; weekly_limit_hours?: number; hourly_rate_minor?: number } = {};
        try { b = c.billing && c.billing.startsWith("{") ? JSON.parse(c.billing) : {}; } catch { b = {}; }
        if (b.type === "hourly") { hourly.push({ contract_id: c.id, title: c.title, hourly_rate_minor: Number(b.hourly_rate_minor ?? 0), weekly_limit_hours: Number(b.weekly_limit_hours ?? 0) }); continue; }
        let ms: Array<{ title?: unknown; amount_minor?: unknown; due_date?: unknown }> = [];
        try { const parsed = JSON.parse(c.milestones_json || "[]"); ms = Array.isArray(parsed) ? parsed : []; } catch { ms = []; }
        ms.forEach((m, i) => {
          const key = `${c.id}:${i}`;
          if (done.has(key) || released.has(key)) return;
          milestones.push({ contract_id: c.id, title: c.title, milestone: String(m.title ?? `Milestone ${i + 1}`), amount_minor: Number(m.amount_minor ?? 0), due_date: typeof m.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(m.due_date) ? m.due_date : null, state: funded.has(key) ? "held" : "unfunded" });
        });
      }
      const fee = (await sql<{ client_fee_bps: number }[]>`
        SELECT client_fee_bps FROM fee_schedules WHERE status = 'approved' AND currency = 'INR' AND effective_from <= now() ORDER BY effective_from DESC LIMIT 1
      `.catch(() => []))[0];
      const forecast = spendForecast(milestones, hourly, fee ? Number(fee.client_fee_bps) : null, today);
      await recordRun(sql, userId, "spend_forecast", `Spend forecast for ${org.id}: ${milestones.length} milestones, ${hourly.length} hourly`);
      return success({ organization_id: org.id, ...forecast, milestones }, "Spend forecast", 200, requestId);
    }

    /* ---------- P9 ---------- */
    if (path === "/api/v1/me/notification-settings") {
      const ready = await tableExists(sql, "notification_preferences");
      if (method === "PUT") {
        if (!ready) return failure("MIGRATION_PENDING", PENDING, 503, requestId);
        const payload = (await body(request)) ?? {};
        const groups = payload.groups && typeof payload.groups === "object" ? (payload.groups as Record<string, unknown>) : null;
        const mutable = new Set(NOTIFICATION_GROUPS.filter((g) => g.mutable).map((g) => g.key as string));
        if (!groups || !Object.entries(groups).every(([k, v]) => mutable.has(k) && typeof v === "boolean")) {
          return failure("INVALID_SETTINGS", "Send on (true) or off (false) for groups you can change.", 422, requestId);
        }
        for (const [k, v] of Object.entries(groups)) {
          await sql`
            INSERT INTO notification_preferences (user_id, group_key, in_app, updated_at) VALUES (${userId}, ${k}, ${v as boolean}, now())
            ON CONFLICT (user_id, group_key) DO UPDATE SET in_app = EXCLUDED.in_app, updated_at = now()
          `;
        }
      }
      const rows = ready ? await sql<{ group_key: string; in_app: boolean }[]>`SELECT group_key, in_app FROM notification_preferences WHERE user_id = ${userId}` : [];
      return success(
        {
          available: ready,
          groups: NOTIFICATION_GROUPS.map((g) => ({ key: g.key, label: g.label, mutable: g.mutable, in_app: g.mutable ? (rows.find((r) => r.group_key === g.key)?.in_app ?? true) : true })),
          email: { available: false, note: "Email notifications start once the email sender is set up (decision D-15)." }
        },
        method === "PUT" ? "Notification settings saved" : "Notification settings", 200, requestId
      );
    }

    /* ---------- staff ---------- */
    const roles = await loadRoles(sql, userId);
    const isAdmin = roles.includes("admin");
    const isMod = roles.includes("moderator");
    const isFinance = roles.includes("finance");

    if (path === "/api/v1/admin/balance-alerts") {
      if (!isAdmin && !isMod && !isFinance) return failure("NOT_FOUND", "Not found", 404, requestId);
      const { rows, visible } = await balanceRows(sql);
      return success({ alerts: balanceAlerts(rows, visible), categories: rows, visible_freelancers: visible, note: "Alerts are refreshed on every visit; admins also get a weekly summary in their notifications." }, "Marketplace balance", 200, requestId);
    }

    if (path === "/api/v1/admin/risk-signals") {
      if (!isAdmin && !isMod) return failure("NOT_FOUND", "Not found", 404, requestId);
      const signalsReady = await tableExists(sql, "trust_signals");
      const attempts = signalsReady
        ? await sql<Array<{ user_id: string; contact: number; payment: number; last_at: Date }>>`
            SELECT user_id, count(*) FILTER (WHERE kind = 'contact_attempt')::int AS contact, count(*) FILTER (WHERE kind = 'payment_attempt')::int AS payment, max(created_at) AS last_at
            FROM trust_signals WHERE created_at > now() - interval '30 days' GROUP BY user_id HAVING count(*) >= 3 ORDER BY count(*) DESC LIMIT 100
          `
        : [];
      const circular = await sql<Array<{ user_a: string; user_b: string; contract_a: string; contract_b: string }>>`
        SELECT DISTINCT ON (LEAST(c1.freelancer_user_id, c2.freelancer_user_id), GREATEST(c1.freelancer_user_id, c2.freelancer_user_id))
               c1.freelancer_user_id AS user_a, c2.freelancer_user_id AS user_b, c1.id AS contract_a, c2.id AS contract_b
        FROM contracts c1
        JOIN organization_memberships m2 ON m2.organization_id = c1.organization_id
        JOIN contracts c2 ON c2.freelancer_user_id = m2.user_id
        JOIN organization_memberships m1 ON m1.organization_id = c2.organization_id AND m1.user_id = c1.freelancer_user_id
        WHERE c1.freelancer_user_id <> c2.freelancer_user_id AND c1.status IN ('active', 'completed') AND c2.status IN ('active', 'completed')
        LIMIT 50
      `.catch(() => []);
      const ownTeam = await sql<Array<{ contract_id: string; freelancer_user_id: string; organization_id: string }>>`
        SELECT c.id AS contract_id, c.freelancer_user_id, c.organization_id FROM contracts c
        WHERE EXISTS (SELECT 1 FROM organization_memberships m WHERE m.organization_id = c.organization_id AND m.user_id = c.freelancer_user_id)
        ORDER BY c.created_at DESC LIMIT 50
      `.catch(() => []);
      const oneAndDone = signalsReady
        ? await sql<Array<{ freelancer_user_id: string; organization_id: string; contract_id: string; attempts: number }>>`
            SELECT c.freelancer_user_id, c.organization_id, max(c.id) AS contract_id, count(DISTINCT s.id)::int AS attempts
            FROM contracts c
            JOIN trust_signals s ON s.organization_id = c.organization_id
              AND (s.user_id = c.freelancer_user_id OR s.counterpart_user_id = c.freelancer_user_id)
            WHERE c.status = 'completed' AND c.completed_at < now() - interval '30 days'
            GROUP BY c.freelancer_user_id, c.organization_id
            HAVING count(DISTINCT c.id) = 1
               AND NOT EXISTS (SELECT 1 FROM contracts c3 WHERE c3.freelancer_user_id = c.freelancer_user_id AND c3.organization_id = c.organization_id AND c3.status IN ('offered', 'active'))
            LIMIT 50
          `.catch(() => [])
        : [];
      const troubled = await sql<Array<{ user_id: string; cancelled: number; disputed: number }>>`
        SELECT c.freelancer_user_id AS user_id,
               count(*) FILTER (WHERE c.status = 'cancelled')::int AS cancelled,
               count(*) FILTER (WHERE EXISTS (SELECT 1 FROM disputes d WHERE d.contract_id = c.id))::int AS disputed
        FROM contracts c WHERE c.updated_at > now() - interval '90 days'
        GROUP BY c.freelancer_user_id HAVING count(*) FILTER (WHERE c.status = 'cancelled') + count(*) FILTER (WHERE EXISTS (SELECT 1 FROM disputes d WHERE d.contract_id = c.id)) >= 2
        LIMIT 50
      `.catch(() => []);
      const findings = riskFindings({
        attempts: attempts.map((a) => ({ user_id: a.user_id, contact: Number(a.contact), payment: Number(a.payment), last_at: iso(a.last_at) ?? "" })),
        circular, ownTeam, oneAndDone: oneAndDone.map((o) => ({ ...o, attempts: Number(o.attempts) })),
        troubled: troubled.map((t) => ({ user_id: t.user_id, cancelled: Number(t.cancelled), disputed: Number(t.disputed) }))
      });
      const ids = [...new Set(findings.flatMap((f) => f.user_ids))];
      const people = ids.length
        ? await sql<Array<{ id: string; name: string | null }>>`SELECT u.id, p.full_name AS name FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ANY(${textArray(ids)}::text[])`
        : [];
      return success(
        {
          available: signalsReady,
          findings: findings.map((f) => ({ ...f, people: f.user_ids.map((id) => ({ id, name: people.find((p) => p.id === id)?.name || "Unnamed account" })) })),
          note: "Patterns to review, not verdicts. Nothing happens to anyone automatically; use the user history and the usual staff actions."
        },
        "Risk signals", 200, requestId
      );
    }

    if (terms) {
      if (!isAdmin) return failure("FORBIDDEN", "Only admins record source terms.", 403, requestId);
      if (!SOURCE_CATALOGUE.some((s) => s.code === terms[1])) return failure("NOT_FOUND", "Unknown source", 404, requestId);
      const cols = await sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'discovery_sources' AND column_name = 'terms_url'`;
      if (!cols.length) return failure("MIGRATION_PENDING", PENDING, 503, requestId);
      const payload = (await body(request)) ?? {};
      const rawUrl = typeof payload.terms_url === "string" ? payload.terms_url.trim() : "";
      const termsUrl = rawUrl ? safeHttpUrl(rawUrl) : "";
      const fields = typeof payload.permitted_fields === "string" ? payload.permitted_fields.trim().slice(0, 500) : "";
      const errors: Record<string, string> = {};
      if (rawUrl && !termsUrl) errors.terms_url = "Use the source's own terms page (https link).";
      if (payload.reviewed !== undefined && typeof payload.reviewed !== "boolean") errors.reviewed = "reviewed must be true or false.";
      if (Object.keys(errors).length) return failure("INVALID_TERMS", "Check the highlighted fields.", 422, requestId, [errors]);
      await sql.begin(async (tx) => {
        await tx`
          INSERT INTO discovery_sources (code, enabled, note, updated_by, updated_at, terms_url, permitted_fields, reviewed_at, reviewed_by_user_id)
          VALUES (${terms[1]}, true, '', ${userId}, now(), ${termsUrl}, ${fields}, ${payload.reviewed ? now.toISOString() : null}, ${payload.reviewed ? userId : null})
          ON CONFLICT (code) DO UPDATE SET terms_url = EXCLUDED.terms_url, permitted_fields = EXCLUDED.permitted_fields,
            reviewed_at = CASE WHEN ${Boolean(payload.reviewed)} THEN now() ELSE discovery_sources.reviewed_at END,
            reviewed_by_user_id = CASE WHEN ${Boolean(payload.reviewed)} THEN ${userId} ELSE discovery_sources.reviewed_by_user_id END,
            updated_by = ${userId}, updated_at = now()
        `;
        await tx`
          INSERT INTO moderation_actions (id, actor_user_id, target_type, target_id, action, note, created_at)
          VALUES (${crypto.randomUUID()}, ${userId}, 'source', ${terms[1]}, 'source.terms_recorded', ${`${termsUrl} ${fields}`.trim().slice(0, 500)}, now())
        `;
      });
      return success({ code: terms[1], terms_url: termsUrl, permitted_fields: fields, reviewed: Boolean(payload.reviewed) }, "Source terms saved", 200, requestId);
    }

    if (path === "/api/v1/admin/source-takedowns") {
      if (!isAdmin && !isMod) return failure("NOT_FOUND", "Not found", 404, requestId);
      if (!(await tableExists(sql, "source_takedowns"))) return failure("MIGRATION_PENDING", PENDING, 503, requestId);
      if (method === "POST") {
        const payload = (await body(request)) ?? {};
        const source = typeof payload.source_code === "string" ? payload.source_code : "";
        const link = typeof payload.source_url === "string" ? safeHttpUrl(payload.source_url.trim()) : null;
        const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
        const errors: Record<string, string> = {};
        if (!/^[a-z0-9_]{1,40}$/.test(source)) errors.source_code = "Choose the source.";
        if (!link) errors.source_url = "Paste the listing's link (https).";
        if (reason.length < 10 || reason.length > 1000) errors.reason = "Say who asked and why (10 to 1,000 characters).";
        if (Object.keys(errors).length) return failure("INVALID_TAKEDOWN", "Check the highlighted fields.", 422, requestId, [errors]);
        const result = await sql.begin(async (tx) => {
          const inserted = await tx<{ id: string }[]>`
            INSERT INTO source_takedowns (id, source_code, source_url, reason, created_by_user_id, created_at, removed_count)
            VALUES (${crypto.randomUUID()}, ${source}, ${link}, ${reason}, ${userId}, now(), 0)
            ON CONFLICT (source_code, source_url) DO NOTHING RETURNING id
          `;
          if (!inserted[0]) return null;
          const removed = await tx`
            UPDATE opportunities SET status = 'skipped' WHERE source = ${source} AND source_url = ${link} AND status IN ('new', 'drafted', 'ready') RETURNING id
          `;
          await tx`UPDATE source_takedowns SET removed_count = ${removed.length} WHERE id = ${inserted[0].id}`;
          await tx`
            INSERT INTO moderation_actions (id, actor_user_id, target_type, target_id, action, note, created_at)
            VALUES (${crypto.randomUUID()}, ${userId}, 'source', ${source}, 'source.takedown', ${`${link} — ${reason}`.slice(0, 1000)}, now())
          `;
          return { id: inserted[0].id, removed: removed.length };
        });
        if (!result) return failure("ALREADY_TAKEN_DOWN", "This listing was already taken down.", 409, requestId);
        return success(result, `Taken down. ${result.removed} saved cop${result.removed === 1 ? "y was" : "ies were"} hidden; it will not be collected again.`, 201, requestId);
      }
      const rows = await sql<Array<{ id: string; source_code: string; source_url: string; reason: string; removed_count: number; created_at: Date }>>`
        SELECT id, source_code, source_url, reason, removed_count, created_at FROM source_takedowns ORDER BY created_at DESC LIMIT 100
      `;
      return success(rows.map((r) => ({ ...r, created_at: iso(r.created_at) })), "Takedowns", 200, requestId);
    }

    return failure("NOT_FOUND", "Not found", 404, requestId);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
