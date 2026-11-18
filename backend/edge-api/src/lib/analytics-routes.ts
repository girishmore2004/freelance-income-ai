import { tableExists } from "./external-pipeline";
import type { Env } from "../types";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { database } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { loadRoles, organizationForMember } from "./identity";
import {
  CLIENT_DEFINITIONS,
  DECIDED,
  FREELANCER_DEFINITIONS,
  PLATFORM_DEFINITIONS,
  WON,
  byMode,
  median,
  monthKeys,
  monthStart,
  pricingPerformance,
  rate,
  series,
  weekKeys
} from "./analytics";

/**
 * Analytics and staff operations (U6; Master Plan 4.4 and Part A metrics,
 * PRODUCT_EXPERIENCE_SPEC §13–14). Read-only.
 *
 *   GET /api/v1/analytics/freelancer                       the caller's own business numbers
 *   GET /api/v1/analytics/client?organization_id=          an organisation the caller belongs to
 *   GET /api/v1/admin/analytics                            marketplace operations (admin, finance)
 *   GET /api/v1/admin/users?q=&role=&before=               user management list (admin, moderator)
 *   GET /api/v1/admin/users/{id}                           one user's evidence and history (admin, moderator)
 *   GET /api/v1/admin/audit-log?target_type=&actor=&before= staff action log (admin)
 *   GET /api/v1/admin/health                               system health (admin)
 *
 * Numbers come from aggregate SQL over the caller's authorised scope; no raw
 * personal records go to a language model. Money is reported per payment mode
 * (sandbox is test money). Tables a deployment does not have yet (legacy
 * external pipeline) are reported as unavailable instead of failing.
 */

export interface AnalyticsRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
  now: () => Date;
}

const defaultDeps: AnalyticsRouteDeps = { database, authenticate: authenticateRequest, now: () => new Date() };

/** The migration this Worker release expects (shown on the health page). */
export const EXPECTED_MIGRATION = "0078_fair_proposals_blocks";
const MONTHS = 6;
const PAGE = 50;

async function tolerant<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch {
    return null;
  }
}

const n = (v: unknown) => Number(v ?? 0);

/* ------------------------------------------------------------------ */
/* Freelancer                                                          */
/* ------------------------------------------------------------------ */

async function freelancerAnalytics(sql: Queryable, userId: string, today: Date) {
  const start = monthStart(today, MONTHS - 1);
  const keys = monthKeys(today, MONTHS);
  const [monthly, proposals, earnings, contracts, revisions, external] = await Promise.all([
    sql<Array<{ period: string; sent: number; won: number }>>`
      SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS period, count(*)::int AS sent,
             count(*) FILTER (WHERE status IN ('offered', 'hired'))::int AS won
      FROM listing_proposals WHERE freelancer_user_id = ${userId} AND created_at >= ${start} GROUP BY 1
    `,
    sql<Array<{ status: string; price_minor: string | number; invited: boolean; budget_min_minor: string | number | null; budget_max_minor: string | number | null }>>`
      SELECT p.status, p.price_minor, (p.invitation_id IS NOT NULL) AS invited, v.budget_min_minor, v.budget_max_minor
      FROM listing_proposals p
      JOIN project_listings l ON l.id = p.listing_id
      JOIN project_listing_versions v ON v.listing_id = l.id AND v.version = l.current_version
      WHERE p.freelancer_user_id = ${userId}
      ORDER BY p.created_at DESC LIMIT 1000
    `,
    sql<Array<{ period: string; mode: string; total: string | number }>>`
      SELECT to_char(date_trunc('month', i.released_at), 'YYYY-MM') AS period, i.mode, sum(i.amount_minor - i.freelancer_fee_minor) AS total
      FROM payment_intents i JOIN contracts c ON c.id = i.contract_id
      WHERE c.freelancer_user_id = ${userId} AND i.status = 'released' AND i.released_at >= ${start}
      GROUP BY 1, 2
    `,
    sql<Array<{ organization_id: string; status: string; total_minor: string | number; currency: string; released_minor: string | number }>>`
      SELECT c.organization_id, c.status, v.total_minor, v.currency,
             (SELECT COALESCE(sum(i.amount_minor), 0) FROM payment_intents i WHERE i.contract_id = c.id AND i.status = 'released') AS released_minor
      FROM contracts c JOIN contract_versions v ON v.contract_id = c.id AND v.version = COALESCE(c.agreed_version, c.current_version)
      WHERE c.freelancer_user_id = ${userId} AND c.status IN ('active', 'completed')
      LIMIT 1000
    `,
    sql<Array<{ revised: number; reviewed: number }>>`
      SELECT count(*) FILTER (WHERE s.status = 'revision_requested')::int AS revised,
             count(*) FILTER (WHERE s.status IN ('approved', 'revision_requested'))::int AS reviewed
      FROM milestone_submissions s JOIN contracts c ON c.id = s.contract_id WHERE c.freelancer_user_id = ${userId}
    `,
    tolerant(() => sql<Array<{ source: string; status: string; total: number }>>`
      SELECT source, status, count(*)::int AS total FROM opportunities WHERE user_id = ${userId} GROUP BY 1, 2
    `)
  ]);

  const rows = proposals.map((p) => ({
    status: p.status,
    price_minor: n(p.price_minor),
    invited: Boolean(p.invited),
    budget_min_minor: p.budget_min_minor === null ? null : n(p.budget_min_minor),
    budget_max_minor: p.budget_max_minor === null ? null : n(p.budget_max_minor)
  }));
  const decided = rows.filter((r) => DECIDED.includes(r.status));
  const won = decided.filter((r) => WON.includes(r.status));
  const bySource = (invited: boolean) => {
    const d = decided.filter((r) => r.invited === invited);
    return { proposals: rows.filter((r) => r.invited === invited).length, success: rate(d.filter((r) => WON.includes(r.status)).length, d.length) };
  };

  const orgCounts = new Map<string, number>();
  for (const c of contracts) orgCounts.set(c.organization_id, (orgCounts.get(c.organization_id) ?? 0) + 1);
  const values = contracts.map((c) => n(c.total_minor));
  const active = contracts.filter((c) => c.status === "active");

  const earningSeries: Record<string, Array<{ period: string; total: number }>> = {};
  for (const mode of new Set(earnings.map((e) => e.mode))) {
    earningSeries[mode] = series(keys, earnings.filter((e) => e.mode === mode).map((e) => ({ period: e.period, total: n(e.total) })), ["total"]);
  }

  const externalBySource = new Map<string, { found: number; applied: number; won: number }>();
  for (const r of external ?? []) {
    const s = externalBySource.get(r.source) ?? { found: 0, applied: 0, won: 0 };
    s.found += n(r.total);
    if (["applied", "replied", "won", "lost"].includes(r.status)) s.applied += n(r.total);
    if (r.status === "won") s.won += n(r.total);
    externalBySource.set(r.source, s);
  }

  return {
    as_of: today.toISOString(),
    period_months: MONTHS,
    proposals: {
      by_month: series(keys, monthly.map((m) => ({ period: m.period, sent: n(m.sent), won: n(m.won) })), ["sent", "won"]),
      total: rows.length,
      success_rate: rate(won.length, decided.length),
      shortlist_rate: rate(rows.filter((r) => ["shortlisted", "offered", "hired"].includes(r.status)).length, rows.length),
      pricing_performance: pricingPerformance(rows),
      by_source: { open_marketplace: bySource(false), invitations: bySource(true) }
    },
    earnings: { released_by_month: earningSeries, currency: "INR" },
    contracts: {
      count: contracts.length,
      average_value_minor: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null,
      average_value_small_sample: values.length < 5,
      repeat_client_rate: rate([...orgCounts.values()].filter((v) => v >= 2).length, orgCounts.size),
      pipeline_minor: active.reduce((sum, c) => sum + Math.max(0, n(c.total_minor) - n(c.released_minor)), 0),
      active: active.length
    },
    delivery: { revision_rate: rate(n(revisions[0]?.revised), n(revisions[0]?.reviewed)) },
    external: external === null
      ? { available: false, by_source: [] }
      : { available: true, by_source: [...externalBySource.entries()].map(([source, v]) => ({ source, ...v })).sort((a, b) => b.found - a.found) },
    definitions: { ...FREELANCER_DEFINITIONS, shortlist_rate: "Proposals now shortlisted, offered or hired ÷ proposals sent." }
  };
}

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

async function clientAnalytics(sql: Queryable, organizationId: string, today: Date) {
  const start = monthStart(today, MONTHS - 1);
  const keys = monthKeys(today, MONTHS);
  const [statuses, listings, spend, byCategory, contracts, revisions] = await Promise.all([
    sql<Array<{ status: string; total: number }>>`SELECT status, count(*)::int AS total FROM project_listings WHERE organization_id = ${organizationId} GROUP BY 1`,
    sql<Array<{ published_at: Date; proposals: number; first_proposal_at: Date | null; first_hire_at: Date | null; hired: boolean }>>`
      SELECT l.published_at,
             (SELECT count(*) FROM listing_proposals p WHERE p.listing_id = l.id)::int AS proposals,
             (SELECT min(p.created_at) FROM listing_proposals p WHERE p.listing_id = l.id) AS first_proposal_at,
             (SELECT min(c.activated_at) FROM contracts c WHERE c.listing_id = l.id) AS first_hire_at,
             EXISTS (SELECT 1 FROM contracts c WHERE c.listing_id = l.id AND c.status IN ('active', 'completed')) AS hired
      FROM project_listings l WHERE l.organization_id = ${organizationId} AND l.published_at IS NOT NULL
      ORDER BY l.published_at DESC LIMIT 1000
    `,
    sql<Array<{ period: string; mode: string; total: string | number }>>`
      SELECT to_char(date_trunc('month', i.funded_at), 'YYYY-MM') AS period, i.mode, sum(i.total_minor) AS total
      FROM payment_intents i JOIN contracts c ON c.id = i.contract_id
      WHERE c.organization_id = ${organizationId} AND i.funded_at >= ${start}
      GROUP BY 1, 2
    `,
    // Service orders (0075) have no project: their category comes from the service.
    tableExists(sql, "service_orders").then((withServices) => withServices
      ? sql<Array<{ category_slug: string; mode: string; total: string | number }>>`
          SELECT COALESCE(l.category_slug, s.category_slug, 'other') AS category_slug, i.mode, sum(i.total_minor) AS total
          FROM payment_intents i JOIN contracts c ON c.id = i.contract_id LEFT JOIN project_listings l ON l.id = c.listing_id
          LEFT JOIN LATERAL (SELECT sv.category_slug FROM service_orders so JOIN services sv ON sv.id = so.service_id WHERE so.contract_id = c.id LIMIT 1) s ON c.listing_id IS NULL
          WHERE c.organization_id = ${organizationId} AND i.funded_at IS NOT NULL
          GROUP BY 1, 2
        `
      : sql<Array<{ category_slug: string; mode: string; total: string | number }>>`
          SELECT l.category_slug, i.mode, sum(i.total_minor) AS total
          FROM payment_intents i JOIN contracts c ON c.id = i.contract_id JOIN project_listings l ON l.id = c.listing_id
          WHERE c.organization_id = ${organizationId} AND i.funded_at IS NOT NULL
          GROUP BY 1, 2
        `),
    sql<Array<{ freelancer_user_id: string; status: string; activated_at: Date | null; completed_at: Date | null; total_minor: string | number; released_minor: string | number }>>`
      SELECT c.freelancer_user_id, c.status, c.activated_at, c.completed_at, v.total_minor,
             (SELECT COALESCE(sum(i.amount_minor), 0) FROM payment_intents i WHERE i.contract_id = c.id AND i.status = 'released') AS released_minor
      FROM contracts c JOIN contract_versions v ON v.contract_id = c.id AND v.version = COALESCE(c.agreed_version, c.current_version)
      WHERE c.organization_id = ${organizationId} AND c.status IN ('active', 'completed')
      LIMIT 1000
    `,
    sql<Array<{ revised: number; reviewed: number }>>`
      SELECT count(*) FILTER (WHERE s.status = 'revision_requested')::int AS revised,
             count(*) FILTER (WHERE s.status IN ('approved', 'revision_requested'))::int AS reviewed
      FROM milestone_submissions s JOIN contracts c ON c.id = s.contract_id WHERE c.organization_id = ${organizationId}
    `
  ]);

  const hours = (a: Date, b: Date) => (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000;
  const firstProposal = listings.filter((l) => l.first_proposal_at).map((l) => hours(l.published_at, l.first_proposal_at as Date));
  const toHire = listings.filter((l) => l.first_hire_at).map((l) => hours(l.published_at, l.first_hire_at as Date) / 24);
  const completed = contracts.filter((c) => c.completed_at && c.activated_at);
  const freelancerCounts = new Map<string, number>();
  for (const c of contracts) freelancerCounts.set(c.freelancer_user_id, (freelancerCounts.get(c.freelancer_user_id) ?? 0) + 1);
  const spendSeries: Record<string, Array<{ period: string; total: number }>> = {};
  for (const mode of new Set(spend.map((s) => s.mode))) {
    spendSeries[mode] = series(keys, spend.filter((s) => s.mode === mode).map((s) => ({ period: s.period, total: n(s.total) })), ["total"]);
  }
  const categories = new Map<string, Record<string, number>>();
  for (const r of byCategory) {
    const c = categories.get(r.category_slug) ?? {};
    c[r.mode] = (c[r.mode] ?? 0) + n(r.total);
    categories.set(r.category_slug, c);
  }
  const round = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

  return {
    as_of: today.toISOString(),
    organization_id: organizationId,
    period_months: MONTHS,
    projects: { by_status: Object.fromEntries(statuses.map((s) => [s.status, n(s.total)])), published: listings.length },
    hiring: {
      proposals_per_project: listings.length ? Math.round((listings.reduce((a, l) => a + n(l.proposals), 0) / listings.length) * 10) / 10 : null,
      time_to_first_proposal_hours: round(median(firstProposal)),
      time_to_first_proposal_sample: firstProposal.length,
      time_to_hire_days: round(median(toHire)),
      time_to_hire_sample: toHire.length,
      hiring_conversion: rate(listings.filter((l) => l.hired).length, listings.length)
    },
    spend: {
      by_month: spendSeries,
      by_category: [...categories.entries()].map(([category_slug, modes]) => ({ category_slug, by_mode: modes })),
      currency: "INR"
    },
    delivery: {
      active_contracts: contracts.filter((c) => c.status === "active").length,
      completed_contracts: contracts.filter((c) => c.status === "completed").length,
      delivery_days: round(median(completed.map((c) => hours(c.activated_at as Date, c.completed_at as Date) / 24))),
      delivery_sample: completed.length,
      revision_rate: rate(n(revisions[0]?.revised), n(revisions[0]?.reviewed)),
      repeat_hire_rate: rate([...freelancerCounts.values()].filter((v) => v >= 2).length, freelancerCounts.size),
      committed_not_released_minor: contracts.filter((c) => c.status === "active").reduce((sum, c) => sum + Math.max(0, n(c.total_minor) - n(c.released_minor)), 0)
    },
    definitions: CLIENT_DEFINITIONS
  };
}

/* ------------------------------------------------------------------ */
/* Platform                                                            */
/* ------------------------------------------------------------------ */

async function platformAnalytics(sql: Queryable, today: Date) {
  const weeks = weekKeys(today, 12);
  const keys = monthKeys(today, MONTHS);
  const firstWeek = new Date(`${weeks[0]}T00:00:00Z`);
  const start = monthStart(today, MONTHS - 1);
  const [registrations, activity, listings, collected, revenue, refunded, disputes, ai, retention, completedMonthly, categories, external] = await Promise.all([
    sql<Array<{ period: string; total: number }>>`
      SELECT to_char(date_trunc('week', created_at), 'YYYY-MM-DD') AS period, count(*)::int AS total FROM users WHERE created_at >= ${firstWeek} GROUP BY 1
    `,
    sql<Array<{ freelancers: number; clients: number }>>`
      SELECT
        (SELECT count(DISTINCT x.u)::int FROM (
           SELECT freelancer_user_id AS u FROM listing_proposals WHERE created_at >= now() - interval '30 days'
           UNION SELECT submitted_by FROM milestone_submissions WHERE submitted_at >= now() - interval '30 days' AND submitted_by IS NOT NULL) x) AS freelancers,
        (SELECT count(DISTINCT y.o)::int FROM (
           SELECT organization_id AS o FROM project_listings WHERE updated_at >= now() - interval '30 days'
           UNION SELECT organization_id FROM contracts WHERE updated_at >= now() - interval '30 days') y) AS clients
    `,
    sql<Array<{ published: number; hired: number; published_30d: number }>>`
      SELECT count(*) FILTER (WHERE l.published_at IS NOT NULL)::int AS published,
             count(*) FILTER (WHERE l.published_at IS NOT NULL AND EXISTS (
               SELECT 1 FROM contracts c WHERE c.listing_id = l.id AND c.status IN ('active', 'completed')))::int AS hired,
             count(*) FILTER (WHERE l.published_at >= now() - interval '30 days')::int AS published_30d
      FROM project_listings l
    `,
    sql<Array<{ mode: string; total: string | number }>>`SELECT mode, sum(total_minor) AS total FROM payment_intents WHERE funded_at IS NOT NULL GROUP BY mode`,
    sql<Array<{ mode: string; total: string | number }>>`SELECT mode, sum(client_fee_minor + freelancer_fee_minor) AS total FROM payment_intents WHERE status = 'released' GROUP BY mode`,
    sql<Array<{ mode: string; total: string | number }>>`SELECT mode, sum(total_minor) AS total FROM payment_intents WHERE status = 'refunded' GROUP BY mode`,
    sql<Array<{ disputes: number; activated: number }>>`
      SELECT (SELECT count(*) FROM disputes)::int AS disputes, (SELECT count(*) FROM contracts WHERE activated_at IS NOT NULL)::int AS activated
    `,
    sql<Array<{ cost: string | number; completed: number }>>`
      SELECT (SELECT COALESCE(sum(estimated_cost_micros), 0) FROM ai_usage_events WHERE created_at >= now() - interval '30 days') AS cost,
             (SELECT count(*) FROM contracts WHERE completed_at >= now() - interval '30 days')::int AS completed
    `,
    sql<Array<{ cohort: number; retained: number }>>`
      WITH cohort AS (SELECT id FROM users WHERE created_at >= now() - interval '60 days' AND created_at < now() - interval '30 days')
      SELECT (SELECT count(*) FROM cohort)::int AS cohort,
             (SELECT count(*) FROM cohort c WHERE
                EXISTS (SELECT 1 FROM listing_proposals p WHERE p.freelancer_user_id = c.id AND p.created_at >= now() - interval '30 days')
                OR EXISTS (SELECT 1 FROM project_listings l WHERE l.created_by = c.id AND l.updated_at >= now() - interval '30 days')
                OR EXISTS (SELECT 1 FROM contract_messages m WHERE m.sender_user_id = c.id AND m.created_at >= now() - interval '30 days')
                OR EXISTS (SELECT 1 FROM milestone_submissions s WHERE s.submitted_by = c.id AND s.submitted_at >= now() - interval '30 days'))::int AS retained
    `,
    sql<Array<{ period: string; total: number }>>`
      SELECT to_char(date_trunc('month', completed_at), 'YYYY-MM') AS period, count(*)::int AS total FROM contracts WHERE completed_at >= ${start} GROUP BY 1
    `,
    sql<Array<{ category_slug: string; published: number; proposals: number; contracts: number }>>`
      SELECT l.category_slug,
             count(DISTINCT l.id) FILTER (WHERE l.published_at IS NOT NULL)::int AS published,
             count(DISTINCT p.id)::int AS proposals,
             count(DISTINCT c.id) FILTER (WHERE c.status IN ('active', 'completed'))::int AS contracts
      FROM project_listings l
      LEFT JOIN listing_proposals p ON p.listing_id = l.id
      LEFT JOIN contracts c ON c.listing_id = l.id
      GROUP BY 1 ORDER BY 2 DESC
    `,
    tolerant(() => sql<Array<{ total: number }>>`SELECT count(*)::int AS total FROM opportunities WHERE created_at >= now() - interval '30 days'`)
  ]);
  const aiCost = n(ai[0]?.cost);
  const completed30 = n(ai[0]?.completed);
  return {
    as_of: today.toISOString(),
    acquisition: { registrations_by_week: series(weeks, registrations.map((r) => ({ period: r.period, total: n(r.total) })), ["total"]) },
    activation: { active_freelancers_30d: n(activity[0]?.freelancers), active_clients_30d: n(activity[0]?.clients) },
    marketplace: {
      native_listings_published: n(listings[0]?.published),
      native_listings_published_30d: n(listings[0]?.published_30d),
      external_opportunities_30d: external === null ? null : n(external[0]?.total),
      project_to_hire: rate(n(listings[0]?.hired), n(listings[0]?.published)),
      categories: categories.map((c) => ({ category_slug: c.category_slug, published: n(c.published), proposals: n(c.proposals), contracts: n(c.contracts) }))
    },
    delivery: {
      completed_contracts_by_month: series(keys, completedMonthly.map((r) => ({ period: r.period, total: n(r.total) })), ["total"]),
      dispute_rate: rate(n(disputes[0]?.disputes), n(disputes[0]?.activated))
    },
    finance: {
      collected_by_mode: byMode(collected),
      platform_revenue_by_mode: byMode(revenue),
      refunded_by_mode: byMode(refunded),
      ai_cost_30d_usd: Math.round(aiCost) / 1_000_000,
      ai_cost_per_completed_contract_usd: completed30 > 0 ? Math.round(aiCost / completed30) / 1_000_000 : null,
      completed_contracts_30d: completed30
    },
    retention: { retention_30d: rate(n(retention[0]?.retained), n(retention[0]?.cohort)) },
    definitions: PLATFORM_DEFINITIONS
  };
}

/* ------------------------------------------------------------------ */
/* Staff: users, audit log, health                                     */
/* ------------------------------------------------------------------ */

/** Moderators see a masked email; admins see it in full. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

function likePattern(q: string): string {
  return `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function parseBefore(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

type UserRow = { id: string; email: string | null; created_at: Date | null; email_verified: string | null; mfa_enabled: string | null; suspended_at: string | null; roles: string[] | null };

function userOut(u: UserRow, admin: boolean) {
  return {
    id: u.id,
    email: admin ? u.email ?? "" : maskEmail(u.email ?? ""),
    created_at: u.created_at ? new Date(u.created_at).toISOString() : null,
    email_verified: u.email_verified === null ? null : u.email_verified === "true",
    mfa_enabled: u.mfa_enabled === "true",
    suspended: u.suspended_at !== null,
    roles: Array.isArray(u.roles) ? u.roles : []
  };
}

async function usersList(sql: Queryable, url: URL, admin: boolean) {
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const role = (url.searchParams.get("role") ?? "").trim();
  const before = parseBefore(url.searchParams.get("before"));
  const rows = await sql<UserRow[]>`
    SELECT u.id, u.email, u.created_at,
           to_jsonb(u)->>'email_verified' AS email_verified, to_jsonb(u)->>'mfa_enabled' AS mfa_enabled, to_jsonb(u)->>'suspended_at' AS suspended_at,
           (SELECT array_agg(r.role ORDER BY r.role) FROM user_roles r WHERE r.user_id = u.id AND r.status = 'active') AS roles
    FROM users u
    WHERE (${q} = '' OR lower(u.email) LIKE ${likePattern(q)} OR u.id = ${q})
      AND (${role} = '' OR EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = ${role} AND r.status = 'active'))
      AND (${before}::timestamptz IS NULL OR u.created_at < ${before}::timestamptz)
    ORDER BY u.created_at DESC NULLS LAST, u.id
    LIMIT ${PAGE + 1}
  `;
  const page = rows.slice(0, PAGE);
  const last = page[page.length - 1];
  return {
    items: page.map((u) => userOut(u, admin)),
    next_before: rows.length > PAGE && last?.created_at ? new Date(last.created_at).toISOString() : null
  };
}

async function userDetail(sql: Queryable, id: string, admin: boolean) {
  const user = (await sql<UserRow[]>`
    SELECT u.id, u.email, u.created_at,
           to_jsonb(u)->>'email_verified' AS email_verified, to_jsonb(u)->>'mfa_enabled' AS mfa_enabled, to_jsonb(u)->>'suspended_at' AS suspended_at,
           (SELECT array_agg(r.role ORDER BY r.role) FROM user_roles r WHERE r.user_id = u.id AND r.status = 'active') AS roles
    FROM users u WHERE u.id = ${id} LIMIT 1
  `)[0];
  if (!user) return null;
  const [orgs, counts, suspensions, actions, profile] = await Promise.all([
    sql<Array<{ id: string; name: string; role: string; status: string }>>`
      SELECT o.id, o.name, m.role, m.status FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id WHERE m.user_id = ${id} ORDER BY o.name LIMIT 50
    `,
    sql<Array<Record<string, number>>>`
      SELECT
        (SELECT count(*) FROM listing_proposals WHERE freelancer_user_id = ${id})::int AS proposals,
        (SELECT count(*) FROM contracts WHERE freelancer_user_id = ${id})::int AS contracts_as_freelancer,
        (SELECT count(*) FROM project_listings WHERE created_by = ${id})::int AS listings_created,
        (SELECT count(*) FROM reports WHERE target_type = 'user' AND target_id = ${id})::int AS reports_against,
        (SELECT count(*) FROM reports WHERE reporter_user_id = ${id})::int AS reports_made,
        (SELECT count(*) FROM disputes WHERE opened_by = ${id})::int AS disputes_opened
    `,
    sql<Array<{ id: string; reason: string; status: string; created_at: Date; lifted_at: Date | null; appeal_status: string | null }>>`
      SELECT id, reason, status, created_at, lifted_at, appeal_status FROM account_suspensions WHERE user_id = ${id} ORDER BY created_at DESC LIMIT 20
    `,
    sql<Array<{ actor_user_id: string | null; target_type: string; target_id: string; action: string; note: string; created_at: Date }>>`
      SELECT actor_user_id, target_type, target_id, action, note, created_at FROM moderation_actions
      WHERE target_id = ${id} OR actor_user_id = ${id} ORDER BY created_at DESC LIMIT 20
    `,
    tolerant(() => sql<Array<{ full_name: string | null; headline: string | null }>>`SELECT full_name, headline FROM profiles WHERE user_id = ${id} LIMIT 1`)
  ]);
  return {
    user: userOut(user, admin),
    profile: profile?.[0] ? { full_name: profile[0].full_name ?? "", headline: profile[0].headline ?? "" } : null,
    organizations: orgs,
    counts: Object.fromEntries(Object.entries(counts[0] ?? {}).map(([k, v]) => [k, n(v)])),
    suspensions: suspensions.map((s) => ({ ...s, created_at: new Date(s.created_at).toISOString(), lifted_at: s.lifted_at ? new Date(s.lifted_at).toISOString() : null })),
    staff_actions: actions.map((a) => ({ ...a, created_at: new Date(a.created_at).toISOString() }))
  };
}

async function auditLog(sql: Queryable, url: URL) {
  const targetType = (url.searchParams.get("target_type") ?? "").trim().slice(0, 30);
  const actor = (url.searchParams.get("actor") ?? "").trim().slice(0, 64);
  const before = parseBefore(url.searchParams.get("before"));
  const rows = await sql<Array<{ id: string; actor_user_id: string | null; actor_email: string | null; target_type: string; target_id: string; action: string; note: string; created_at: Date }>>`
    SELECT a.id, a.actor_user_id, u.email AS actor_email, a.target_type, a.target_id, a.action, a.note, a.created_at
    FROM moderation_actions a LEFT JOIN users u ON u.id = a.actor_user_id
    WHERE (${targetType} = '' OR a.target_type = ${targetType})
      AND (${actor} = '' OR a.actor_user_id = ${actor})
      AND (${before}::timestamptz IS NULL OR a.created_at < ${before}::timestamptz)
    ORDER BY a.created_at DESC, a.id
    LIMIT ${PAGE + 1}
  `;
  const types = await sql<Array<{ target_type: string }>>`SELECT DISTINCT target_type FROM moderation_actions ORDER BY 1 LIMIT 50`;
  const page = rows.slice(0, PAGE);
  return {
    items: page.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() })),
    next_before: rows.length > PAGE ? new Date(page[page.length - 1].created_at).toISOString() : null,
    target_types: types.map((t) => t.target_type)
  };
}

/** Configuration checks: booleans only, never secret values. */
export function configChecks(env: Env): Array<{ key: string; ok: boolean; detail: string }> {
  const set = (v: string | undefined) => typeof v === "string" && v.trim().length > 0;
  return [
    { key: "jwt_secret", ok: set(env.JWT_SECRET), detail: set(env.JWT_SECRET) ? "Session signing secret is set." : "JWT_SECRET is missing: sign-in cannot work." },
    { key: "ai_binding", ok: Boolean(env.AI), detail: env.AI ? "Workers AI is bound." : "Workers AI is not bound: AI drafts fall back to templates." },
    { key: "files_bucket", ok: Boolean(env.FILES), detail: env.FILES ? "R2 bucket for contract files is bound." : "R2 bucket FILES is not bound: file uploads are off (K-26)." },
    { key: "email", ok: set(env.EMAIL_PROVIDER) && (set(env.RESEND_API_KEY) || set(env.SMTP_HOST)), detail: set(env.EMAIL_PROVIDER) ? `Email provider: ${env.EMAIL_PROVIDER}.` : "No email provider: verification and reset emails are not sent (D-15)." },
    { key: "oauth_key", ok: set(env.OAUTH_ENCRYPTION_KEY), detail: set(env.OAUTH_ENCRYPTION_KEY) ? "OAuth token encryption key is set." : "OAUTH_ENCRYPTION_KEY is missing: mail connections stay off." },
    { key: "rate_limits", ok: Boolean(env.API_RATE_LIMITER && env.AUTH_RATE_LIMITER), detail: env.API_RATE_LIMITER && env.AUTH_RATE_LIMITER ? "Rate limiting bindings are present." : "Rate limiting bindings are missing." },
    { key: "payments_live", ok: true, detail: "Real payments stay off until D-1/D-2 are approved (locked flag)." }
  ];
}

async function health(sql: Queryable, env: Env) {
  const started = Date.now();
  await sql`SELECT 1`;
  const latency = Date.now() - started;
  const migration = await tolerant(() => sql<Array<{ version_num: string }>>`SELECT version_num FROM alembic_version LIMIT 1`);
  const [ai, queues] = await Promise.all([
    sql<Array<{ calls: number; cost: string | number }>>`
      SELECT count(*)::int AS calls, COALESCE(sum(estimated_cost_micros), 0) AS cost FROM ai_usage_events WHERE created_at >= date_trunc('day', now())
    `,
    sql<Array<Record<string, number | null>>>`
      SELECT (SELECT count(*) FROM project_listings WHERE status = 'in_review')::int AS listings_in_review,
             (SELECT count(*) FROM reports WHERE status = 'open')::int AS reports_open,
             (SELECT count(*) FROM disputes WHERE status = 'open')::int AS disputes_open,
             (SELECT count(*) FROM account_suspensions WHERE appeal_status = 'pending')::int AS appeals_pending
    `
  ]);
  const head = migration?.[0]?.version_num ?? null;
  return {
    version: env.APP_VERSION ?? "unknown",
    environment: env.APP_ENV ?? "unknown",
    database: { ok: true, latency_ms: latency },
    migration: { current: head, expected: EXPECTED_MIGRATION, ok: head === EXPECTED_MIGRATION, readable: migration !== null },
    configuration: configChecks(env),
    ai_today: { calls: n(ai[0]?.calls), cost_usd: n(ai[0]?.cost) / 1_000_000 },
    queues: Object.fromEntries(Object.entries(queues[0] ?? {}).map(([k, v]) => [k, n(v)]))
  };
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

export async function handleAnalyticsRoute(request: Request, env: Env, requestId: string, deps: AnalyticsRouteDeps = defaultDeps): Promise<Response | null> {
  if (request.method.toUpperCase() !== "GET") return null;
  const url = new URL(request.url);
  const path = url.pathname;
  const userMatch = path.match(/^\/api\/v1\/admin\/users\/([\w-]{1,64})$/);
  const known = [
    "/api/v1/analytics/freelancer",
    "/api/v1/analytics/client",
    "/api/v1/admin/analytics",
    "/api/v1/admin/users",
    "/api/v1/admin/audit-log",
    "/api/v1/admin/health"
  ].includes(path) || userMatch !== null;
  if (!known) return null;

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);
  const today = deps.now();

  try {
    if (path === "/api/v1/analytics/freelancer") {
      return success(await freelancerAnalytics(sql, userId, today), "Freelancer analytics", 200, requestId);
    }
    if (path === "/api/v1/analytics/client") {
      const orgId = (url.searchParams.get("organization_id") ?? "").trim();
      const org = /^[\w-]{1,64}$/.test(orgId) ? await organizationForMember(sql, userId, orgId) : null;
      if (!org) return failure("NOT_FOUND", "Organisation not found", 404, requestId);
      return success(await clientAnalytics(sql, orgId, today), "Client analytics", 200, requestId);
    }

    const roles = await loadRoles(sql, userId);
    const admin = roles.includes("admin");
    if (path === "/api/v1/admin/analytics") {
      if (!admin && !roles.includes("finance")) return failure("NOT_FOUND", "Not found", 404, requestId);
      return success(await platformAnalytics(sql, today), "Marketplace analytics", 200, requestId);
    }
    if (path === "/api/v1/admin/users" || userMatch) {
      if (!admin && !roles.includes("moderator")) return failure("NOT_FOUND", "Not found", 404, requestId);
      if (path === "/api/v1/admin/users") return success(await usersList(sql, url, admin), "Users", 200, requestId);
      const detail = await userDetail(sql, userMatch![1], admin);
      if (!detail) return failure("NOT_FOUND", "User not found", 404, requestId);
      return success(detail, "User", 200, requestId);
    }
    if (!admin) return failure("NOT_FOUND", "Not found", 404, requestId);
    if (path === "/api/v1/admin/audit-log") return success(await auditLog(sql, url), "Audit log", 200, requestId);
    return success(await health(sql, env), "System health", 200, requestId);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
