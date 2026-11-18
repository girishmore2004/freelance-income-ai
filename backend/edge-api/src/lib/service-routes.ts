import type { Env } from "../types";
import { NOT_AVAILABLE, isBlocked } from "./fair-proposals";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database, jsonList, textArray } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { FLAGS, isEnabled } from "./flags";
import { canManageOrganization, loadRoles, organizationForMember } from "./identity";
import { screenText } from "./listings";
import { MAX_AMOUNT_MINOR, termsHash, validateTerms } from "./contracts";
import { insertContractVersion } from "./hiring-routes";
import { recordContractEvent } from "./contract-events";
import { freelancerCard } from "./matching";
import type { CandidateRow } from "./matching";
import { notifyUsers } from "./notify";
import { tableExists } from "./external-pipeline";

/**
 * Service catalogue (U18, decision D-20): freelancers sell ready-made
 * packages; clients order one. An order is an ordinary two-party contract
 * (client side accepted at order time, the freelancer accepts to start), so
 * delivery, test-mode payments, reviews and disputes work unchanged.
 *
 * Public (visitors too, while the client marketplace is open):
 *   GET  /api/v1/services?category=&q=&before=
 *   GET  /api/v1/services/{id}
 * Freelancer:
 *   GET|POST /api/v1/me/services          own services (≤ 20 not removed)
 *   PUT  /api/v1/services/{id}            edit
 *   POST /api/v1/services/{id}/transition {action: publish|pause|resume|remove}
 * Client (owner/admin of a client account):
 *   POST /api/v1/services/{id}/order      {organization_id, package, requirements} → contract (offered)
 * Staff:
 *   GET  /api/v1/admin/moderation/services            (moderator, admin)
 *   POST /api/v1/admin/moderation/services/{id}       {decision: approve|return, note}
 *   GET  /api/v1/admin/categories                     (admin, moderator)
 *   POST /api/v1/admin/categories/{slug}              {enabled, note} (admin)
 *
 * Prices are set by the freelancer (never by a model); text is screened like
 * project briefs, and flagged services wait for a moderator.
 */

export interface ServiceRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
  now: () => Date;
}

const defaultDeps: ServiceRouteDeps = { database, authenticate: authenticateRequest, now: () => new Date() };

export const PACKAGE_KEYS = ["basic", "standard", "premium"] as const;
export type PackageKey = (typeof PACKAGE_KEYS)[number];
export const MAX_SERVICES = 20;
export const MIN_PACKAGE_PRICE_MINOR = 10_000; // ₹100
export const MAX_OPEN_ORDERS_PER_ACCOUNT = 3;
const PAGE_SIZE = 24;
const DISABLED = "The client marketplace is not open yet.";
const STAFF = new Set(["admin", "moderator"]);

export type ServicePackage = { key: PackageKey; name: string; description: string; price_minor: number; delivery_days: number; revisions: number; deliverables: string[] };
export type ServiceInput = { category_slug: string; title: string; description: string; skills: string[]; packages: ServicePackage[]; requirements: string };

const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+$/g, "").trim() : "");

/** Validates a service and its 1–3 packages. Pure. */
export function validateService(input: Record<string, unknown>): { ok: true; value: ServiceInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const title = str(input.title);
  const description = str(input.description);
  const category = str(input.category_slug);
  const requirements = str(input.requirements);
  if (title.length < 10 || title.length > 120) errors.title = "Title must be 10 to 120 characters, e.g. \"I will design a logo for your bakery\".";
  if (description.length < 30 || description.length > 5000) errors.description = "Describe the service in 30 to 5,000 characters.";
  if (!/^[a-z0-9_]{1,60}$/.test(category)) errors.category_slug = "Choose a category.";
  if (requirements.length > 1000) errors.requirements = "Keep the questions for the client under 1,000 characters.";
  const rawSkills = Array.isArray(input.skills) ? input.skills : [];
  const skills = [...new Set(rawSkills.map((s) => str(s).slice(0, 40)).filter(Boolean))];
  if (skills.length > 10) errors.skills = "Up to 10 skills.";

  const packages: ServicePackage[] = [];
  const raw = Array.isArray(input.packages) ? input.packages : [];
  if (raw.length < 1 || raw.length > 3) errors.packages = "Offer 1 to 3 packages.";
  const seen = new Set<string>();
  raw.slice(0, 3).forEach((r, i) => {
    const p = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const key = str(p.key) as PackageKey;
    const at = `packages.${i}`;
    if (!PACKAGE_KEYS.includes(key) || seen.has(key)) errors[`${at}.key`] = "Each package is Basic, Standard or Premium, once each.";
    seen.add(key);
    const name = str(p.name);
    const pdesc = str(p.description);
    const price = Number(p.price_minor);
    const days = Number(p.delivery_days);
    const revisions = p.revisions === undefined ? 1 : Number(p.revisions);
    const deliverables = (Array.isArray(p.deliverables) ? p.deliverables : []).map((d) => str(d).slice(0, 200)).filter(Boolean);
    if (name.length < 2 || name.length > 40) errors[`${at}.name`] = "Give the package a short name (2–40 characters).";
    if (pdesc.length > 600) errors[`${at}.description`] = "Keep the package description under 600 characters.";
    if (!Number.isInteger(price) || price < MIN_PACKAGE_PRICE_MINOR || price > MAX_AMOUNT_MINOR) errors[`${at}.price_minor`] = "Price must be at least ₹100.";
    if (!Number.isInteger(days) || days < 1 || days > 90) errors[`${at}.delivery_days`] = "Delivery takes 1 to 90 days.";
    if (!Number.isInteger(revisions) || revisions < 0 || revisions > 10) errors[`${at}.revisions`] = "Revisions must be 0 to 10.";
    if (deliverables.length < 1 || deliverables.length > 10) errors[`${at}.deliverables`] = "List 1 to 10 things the client receives.";
    packages.push({ key, name, description: pdesc, price_minor: price, delivery_days: days, revisions, deliverables });
  });
  const order = (k: PackageKey) => PACKAGE_KEYS.indexOf(k);
  packages.sort((a, b) => order(a.key) - order(b.key));
  for (let i = 1; i < packages.length; i += 1) {
    if (packages[i].price_minor < packages[i - 1].price_minor) errors.packages = "Higher packages should not cost less than lower ones.";
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { category_slug: category, title, description, skills, packages, requirements } };
}

/** Screen findings over everything a client will read. Pure. */
export function screenService(s: ServiceInput): string[] {
  const text = [s.title, s.description, s.requirements, ...s.packages.flatMap((p) => [p.name, p.description, ...p.deliverables])].join("\n");
  return [...new Set(screenText(text).map((f) => f.code))];
}

/** The contract terms for an order of one package. Pure apart from the date. */
export function orderTerms(service: { title: string }, pkg: ServicePackage, requirements: string, today: Date): Record<string, unknown> {
  const due = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + pkg.delivery_days)).toISOString().slice(0, 10);
  const scope = [pkg.description, requirements ? `Client's requirements:\n${requirements}` : ""].filter(Boolean).join("\n\n");
  return {
    title: `${service.title} (${pkg.name})`.slice(0, 160),
    scope,
    deliverables: pkg.deliverables,
    milestones: [{ title: `Delivery: ${pkg.name}`.slice(0, 160), amount_minor: pkg.price_minor, due_date: due }],
    revision_rounds: pkg.revisions,
    acceptance_criteria: pkg.deliverables.map((d) => `Delivered: ${d}`.slice(0, 300)),
    ownership_terms: ""
  };
}

type ServiceRow = {
  id: string; freelancer_user_id: string; category_slug: string; title: string; description: string; skills_json: string; packages_json: string;
  requirements: string; currency: string; min_price_minor: string | number; status: string; moderation_note: string; published_at: Date | null; created_at: Date; updated_at: Date;
};

function packagesOf(row: ServiceRow): ServicePackage[] {
  try {
    const raw = JSON.parse(row.packages_json || "[]");
    return Array.isArray(raw) ? (raw as ServicePackage[]) : [];
  } catch {
    return [];
  }
}

function serviceOut(row: ServiceRow, extra: Record<string, unknown> = {}) {
  const packages = packagesOf(row);
  return {
    id: row.id,
    category_slug: row.category_slug,
    title: row.title,
    description: row.description,
    skills: jsonList(row.skills_json),
    packages,
    requirements: row.requirements,
    currency: row.currency,
    from_price_minor: Number(row.min_price_minor),
    fastest_delivery_days: packages.length ? Math.min(...packages.map((p) => p.delivery_days)) : null,
    status: row.status,
    published_at: row.published_at ? new Date(row.published_at).toISOString() : null,
    ...extra
  };
}

type CardRow = CandidateRow & { suspended_at: string | null; is_freelancer: boolean };

async function sellerCards(sql: Queryable, userIds: string[]): Promise<Map<string, CardRow>> {
  if (!userIds.length) return new Map();
  const list = textArray([...new Set(userIds)]);
  const rows = await sql<CardRow[]>`
    SELECT p.user_id, p.full_name, p.headline, p.skills, p.services, p.minimum_budget, p.hourly_rate, p.currency, p.weekly_hours,
           p.timezone, p.dealbreakers, u.created_at AS user_created_at, (to_jsonb(p)->>'verified_at') AS verified_at,
           (to_jsonb(u)->>'suspended_at') AS suspended_at,
           EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = p.user_id AND r.role = 'freelancer' AND r.status = 'active') AS is_freelancer,
           rt.rating_avg, rt.rating_count
    FROM profiles p JOIN users u ON u.id = p.user_id
    LEFT JOIN LATERAL (
      SELECT avg(rv.rating)::float AS rating_avg, count(*)::int AS rating_count
      FROM contract_reviews rv JOIN contracts ct ON ct.id = rv.contract_id
      WHERE ct.freelancer_user_id = p.user_id AND rv.reviewer_party = 'client'
        AND (ct.completed_at < now() - interval '14 days'
             OR EXISTS (SELECT 1 FROM contract_reviews rf WHERE rf.contract_id = ct.id AND rf.reviewer_party = 'freelancer'))
    ) rt ON true
    WHERE p.user_id = ANY(${list}::text[])
  `;
  return new Map(rows.map((r) => [r.user_id, r]));
}

const sellable = (c: CardRow | undefined) => Boolean(c && c.is_freelancer && !c.suspended_at);

async function logAction(sql: Queryable, actor: string, targetType: string, targetId: string, action: string, note: string): Promise<void> {
  await sql`
    INSERT INTO moderation_actions (id, actor_user_id, target_type, target_id, action, note, created_at)
    VALUES (${crypto.randomUUID()}, ${actor}, ${targetType}, ${targetId}, ${action}, ${note.slice(0, 2000)}, now())
  `;
}

async function categoryEnabled(sql: Queryable, slug: string): Promise<boolean> {
  return Boolean((await sql<{ slug: string }[]>`SELECT slug FROM project_categories WHERE slug = ${slug} AND enabled = true LIMIT 1`)[0]);
}

const minPrice = (packages: ServicePackage[]) => Math.min(...packages.map((p) => p.price_minor));

export async function handleServiceRoute(request: Request, env: Env, requestId: string, deps: ServiceRouteDeps = defaultDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const one = path.match(/^\/api\/v1\/services\/([\w-]{1,64})(?:\/(transition|order))?$/);
  const modOne = path.match(/^\/api\/v1\/admin\/moderation\/services\/([\w-]{1,64})$/);
  const catOne = path.match(/^\/api\/v1\/admin\/categories\/([a-z0-9_]{1,60})$/);
  const known =
    (path === "/api/v1/services" && method === "GET") ||
    (one !== null && ((!one[2] && (method === "GET" || method === "PUT")) || (one[2] !== undefined && method === "POST"))) ||
    (path === "/api/v1/me/services" && (method === "GET" || method === "POST")) ||
    (path === "/api/v1/admin/moderation/services" && method === "GET") ||
    (modOne !== null && method === "POST") ||
    (path === "/api/v1/admin/categories" && method === "GET") ||
    (catOne !== null && method === "POST");
  if (!known) return null;

  const publicRead = method === "GET" && (path === "/api/v1/services" || (one !== null && !one[2]));
  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response && !(publicRead && auth.status === 401)) return auth;
  const userId: string | null = auth instanceof Response ? null : auth.user.id;
  const sql = deps.database(env);

  try {
    /* ---------------- staff: categories (not behind the marketplace flag) ---------------- */
    if (path === "/api/v1/admin/categories" || catOne) {
      const roles = await loadRoles(sql, userId!);
      if (!roles.some((r) => STAFF.has(r))) return failure("NOT_FOUND", "Not found", 404, requestId);
      if (path === "/api/v1/admin/categories") {
        const rows = await sql<Array<{ slug: string; name: string; enabled: boolean; projects: number }>>`
          SELECT c.slug, c.name, c.enabled,
                 (SELECT count(*) FROM project_listings l WHERE l.category_slug = c.slug AND l.status = 'published')::int AS projects
          FROM project_categories c ORDER BY c.sort_order, c.name
        `;
        return success({ items: rows, can_manage: roles.includes("admin") }, "Categories", 200, requestId);
      }
      if (!roles.includes("admin")) return failure("FORBIDDEN", "Only admins switch categories.", 403, requestId);
      const payload = (await body(request)) ?? {};
      if (typeof payload.enabled !== "boolean") return failure("INVALID_REQUEST", "Send enabled: true or false.", 422, requestId);
      const note = str(payload.note).slice(0, 500);
      if (!payload.enabled && note.length < 3) return failure("NOTE_REQUIRED", "Say why the category is closing.", 422, requestId);
      const done = await sql.begin(async (tx) => {
        const rows = await tx<{ slug: string }[]>`UPDATE project_categories SET enabled = ${payload.enabled as boolean}, updated_at = now() WHERE slug = ${catOne![1]} RETURNING slug`;
        if (!rows[0]) return false;
        await logAction(tx, userId!, "category", catOne![1], payload.enabled ? "category.opened" : "category.closed", note);
        return true;
      });
      if (!done) return failure("NOT_FOUND", "Category not found", 404, requestId);
      return success({ slug: catOne![1], enabled: payload.enabled }, payload.enabled ? "Category open" : "Category closed to new projects and services", 200, requestId);
    }

    if (!(await isEnabled(env, sql, FLAGS.clientMarketplace, false))) return failure("FEATURE_DISABLED", DISABLED, 403, requestId);
    if (!(await tableExists(sql, "services"))) return failure("MIGRATION_PENDING", "Services need database migration 0075.", 503, requestId);

    /* ---------------- public browse ---------------- */
    if (path === "/api/v1/services") {
      const category = (url.searchParams.get("category") ?? "").slice(0, 60);
      const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
      const before = url.searchParams.get("before");
      const beforeDate = before && !Number.isNaN(Date.parse(before)) ? new Date(before) : null;
      const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const rows = await sql<ServiceRow[]>`
        SELECT s.* FROM services s JOIN users u ON u.id = s.freelancer_user_id
        JOIN project_categories c ON c.slug = s.category_slug AND c.enabled = true
        WHERE s.status = 'published' AND (to_jsonb(u)->>'suspended_at') IS NULL
          AND EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = s.freelancer_user_id AND r.role = 'freelancer' AND r.status = 'active')
          AND (${category} = '' OR s.category_slug = ${category})
          AND (${q} = '' OR s.title ILIKE ${pattern} OR s.skills_json ILIKE ${pattern})
          AND (${beforeDate}::timestamptz IS NULL OR s.published_at < ${beforeDate})
        ORDER BY s.published_at DESC
        LIMIT ${PAGE_SIZE + 1}
      `;
      const page = rows.slice(0, PAGE_SIZE);
      const cards = await sellerCards(sql, page.map((r) => r.freelancer_user_id));
      const now = deps.now();
      const items = page.map((r) => {
        const c = cards.get(r.freelancer_user_id);
        const { description: _d, requirements: _r, ...rest } = serviceOut(r);
        return { ...rest, freelancer: c ? freelancerCard(c, now) : null, mine: r.freelancer_user_id === userId };
      });
      const next = rows.length > PAGE_SIZE ? items[items.length - 1]?.published_at ?? null : null;
      return success({ items, next_before: next }, "Services", 200, requestId);
    }

    if (one && !one[2] && method === "GET") {
      const row = (await sql<ServiceRow[]>`SELECT * FROM services WHERE id = ${one[1]} LIMIT 1`)[0];
      const own = row && row.freelancer_user_id === userId;
      const cards = row ? await sellerCards(sql, [row.freelancer_user_id]) : new Map<string, CardRow>();
      const card = row ? cards.get(row.freelancer_user_id) : undefined;
      if (!row || (!own && (row.status !== "published" || !sellable(card) || !(await categoryEnabled(sql, row.category_slug))))) {
        return failure("NOT_FOUND", "Service not found", 404, requestId);
      }
      const completed = (await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM service_orders o JOIN contracts c ON c.id = o.contract_id WHERE o.service_id = ${row.id} AND c.status = 'completed'
      `)[0]?.n ?? 0;
      return success(
        serviceOut(row, { freelancer: card ? freelancerCard(card, deps.now()) : null, mine: own, completed_orders: completed, moderation_note: own ? row.moderation_note : undefined }),
        "Service", 200, requestId
      );
    }

    // Everything below needs a session.
    if (!userId) return failure("UNAUTHORIZED", "Sign in first.", 401, requestId);
    const roles = await loadRoles(sql, userId);

    /* ---------------- staff moderation ---------------- */
    if (path === "/api/v1/admin/moderation/services" || modOne) {
      if (!roles.some((r) => STAFF.has(r))) return failure("NOT_FOUND", "Not found", 404, requestId);
      if (!modOne) {
        const rows = await sql<ServiceRow[]>`SELECT * FROM services WHERE status = 'in_review' ORDER BY updated_at ASC LIMIT 100`;
        return success(rows.map((r) => serviceOut(r, { freelancer_user_id: r.freelancer_user_id, moderation_note: r.moderation_note, own: r.freelancer_user_id === userId })), "Services waiting for review", 200, requestId);
      }
      const payload = (await body(request)) ?? {};
      const decision = payload.decision;
      const note = str(payload.note).slice(0, 2000);
      if (decision !== "approve" && decision !== "return") return failure("INVALID_REQUEST", "decision must be approve or return.", 422, requestId);
      if (decision === "return" && note.length < 3) return failure("NOTE_REQUIRED", "Tell the freelancer what to change.", 422, requestId);
      const result = await sql.begin(async (tx) => {
        const row = (await tx<ServiceRow[]>`SELECT * FROM services WHERE id = ${modOne[1]} FOR UPDATE`)[0];
        if (!row) return { code: "NOT_FOUND" as const };
        if (row.status !== "in_review") return { code: "CLOSED" as const };
        if (row.freelancer_user_id === userId) return { code: "OWN" as const };
        if (decision === "approve") {
          await tx`UPDATE services SET status = 'published', published_at = COALESCE(published_at, now()), moderation_note = '', updated_at = now() WHERE id = ${row.id}`;
        } else {
          await tx`UPDATE services SET status = 'draft', moderation_note = ${note}, updated_at = now() WHERE id = ${row.id}`;
        }
        await logAction(tx, userId, "service", row.id, decision === "approve" ? "service.approved" : "service.returned", note);
        return { code: "OK" as const, owner: row.freelancer_user_id, title: row.title };
      });
      if (result.code === "NOT_FOUND") return failure("NOT_FOUND", "Service not found", 404, requestId);
      if (result.code === "CLOSED") return failure("NOT_IN_REVIEW", "This service is not waiting for review.", 409, requestId);
      if (result.code === "OWN") return failure("SECOND_REVIEWER_REQUIRED", "Another staff member must review your own service.", 403, requestId);
      await notifyUsers(sql, [result.owner], {
        kind: decision === "approve" ? "service.approved" : "service.returned",
        title: decision === "approve" ? `Your service is live: ${result.title}` : `Your service needs changes: ${result.title}`,
        message: decision === "approve" ? "Clients can now find and order it." : note,
        link: "/services?view=mine"
      });
      return success({ id: modOne[1], decision }, decision === "approve" ? "Approved and published" : "Returned to the freelancer", 200, requestId);
    }

    /* ---------------- freelancer: own services ---------------- */
    if (path === "/api/v1/me/services") {
      if (method === "GET") {
        const rows = await sql<Array<ServiceRow & { orders: number; open_orders: number }>>`
          SELECT s.*,
                 (SELECT count(*) FROM service_orders o WHERE o.service_id = s.id)::int AS orders,
                 (SELECT count(*) FROM service_orders o JOIN contracts c ON c.id = o.contract_id WHERE o.service_id = s.id AND c.status IN ('offered', 'active'))::int AS open_orders
          FROM services s WHERE s.freelancer_user_id = ${userId} AND s.status <> 'removed' ORDER BY s.created_at DESC LIMIT ${MAX_SERVICES}
        `;
        return success(
          { items: rows.map((r) => serviceOut(r, { orders: Number(r.orders), open_orders: Number(r.open_orders), moderation_note: r.moderation_note })), max: MAX_SERVICES, can_sell: roles.includes("freelancer") },
          "Your services", 200, requestId
        );
      }
      if (!roles.includes("freelancer")) return failure("FREELANCER_ROLE_REQUIRED", "Turn on the freelancer role first.", 403, requestId);
      const v = validateService((await body(request)) ?? {});
      if (!v.ok) return failure("INVALID_SERVICE", "Check the highlighted fields.", 422, requestId, [v.errors]);
      if (!(await categoryEnabled(sql, v.value.category_slug))) return failure("INVALID_SERVICE", "Check the highlighted fields.", 422, requestId, [{ category_slug: "This category is not open." }]);
      const count = (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM services WHERE freelancer_user_id = ${userId} AND status <> 'removed'`)[0]?.n ?? 0;
      if (count >= MAX_SERVICES) return failure("LIMIT_REACHED", `You can have up to ${MAX_SERVICES} services.`, 409, requestId);
      const id = crypto.randomUUID();
      const s = v.value;
      const rows = await sql<ServiceRow[]>`
        INSERT INTO services (id, freelancer_user_id, category_slug, title, description, skills_json, packages_json, requirements, currency, min_price_minor, status, created_at, updated_at)
        VALUES (${id}, ${userId}, ${s.category_slug}, ${s.title}, ${s.description}, ${JSON.stringify(s.skills)}, ${JSON.stringify(s.packages)}, ${s.requirements}, 'INR', ${minPrice(s.packages)}, 'draft', now(), now())
        RETURNING *
      `;
      return success(serviceOut(rows[0]), "Draft saved. Publish it when you are ready.", 201, requestId);
    }

    if (!one) return null;
    const serviceId = one[1];

    /* ---------------- client: order ---------------- */
    if (one[2] === "order") {
      if (!roles.includes("client")) return failure("CLIENT_ROLE_REQUIRED", "Turn on the client role on your Account page to order.", 403, requestId);
      const payload = (await body(request)) ?? {};
      const orgId = str(payload.organization_id);
      const key = str(payload.package) as PackageKey;
      const requirements = str(payload.requirements).slice(0, 3001);
      const org = orgId ? await organizationForMember(sql, userId, orgId) : null;
      if (!org) return failure("NOT_FOUND", "Client account not found", 404, requestId);
      if (!canManageOrganization(org.membership_role)) return failure("FORBIDDEN", "Only owners and admins of the client account can order.", 403, requestId);
      if (String((org as unknown as { status?: string }).status ?? "active") !== "active") return failure("FORBIDDEN", "This client account is not active.", 403, requestId);
      const row = (await sql<ServiceRow[]>`SELECT * FROM services WHERE id = ${serviceId} LIMIT 1`)[0];
      const card = row ? (await sellerCards(sql, [row.freelancer_user_id])).get(row.freelancer_user_id) : undefined;
      if (!row || row.status !== "published" || !sellable(card) || !(await categoryEnabled(sql, row.category_slug))) return failure("NOT_FOUND", "Service not found", 404, requestId);
      if (row.freelancer_user_id === userId) return failure("OWN_SERVICE", "You cannot order your own service.", 409, requestId);
      const member = await organizationForMember(sql, row.freelancer_user_id, orgId);
      if (member) return failure("OWN_SERVICE", "The freelancer is a member of this client account.", 409, requestId);
      if (await isBlocked(sql, row.freelancer_user_id, orgId)) return failure("NOT_AVAILABLE", NOT_AVAILABLE, 403, requestId);
      const pkg = packagesOf(row).find((p) => p.key === key);
      if (!pkg) return failure("INVALID_ORDER", "Choose one of the service's packages.", 422, requestId, [{ package: "Choose a package." }]);
      if (requirements.length > 3000) return failure("INVALID_ORDER", "Check the highlighted fields.", 422, requestId, [{ requirements: "Keep it under 3,000 characters." }]);
      if (row.requirements.trim() && requirements.length < 10) return failure("INVALID_ORDER", "Check the highlighted fields.", 422, requestId, [{ requirements: "Answer the freelancer's questions so they can start." }]);
      const terms = validateTerms(orderTerms(row, pkg, requirements, deps.now()), row.currency, deps.now());
      if (!terms.ok) {
        const errors = terms.errors.terms ? { requirements: terms.errors.terms } : terms.errors;
        return failure("INVALID_ORDER", "Check the highlighted fields.", 422, requestId, [errors]);
      }
      const hash = await termsHash(terms.value);
      const result = await sql.begin(async (tx) => {
        await tx`SELECT id FROM services WHERE id = ${row.id} FOR UPDATE`;
        const open = (await tx<{ n: number }[]>`
          SELECT count(*)::int AS n FROM service_orders o JOIN contracts c ON c.id = o.contract_id
          WHERE o.service_id = ${row.id} AND o.organization_id = ${orgId} AND c.status = 'offered'
        `)[0]?.n ?? 0;
        if (open >= MAX_OPEN_ORDERS_PER_ACCOUNT) return { code: "LIMIT" as const };
        const contractId = crypto.randomUUID();
        const orderId = crypto.randomUUID();
        await tx`
          INSERT INTO contracts (id, listing_id, proposal_id, organization_id, freelancer_user_id, status, current_version, created_by, created_at, updated_at)
          VALUES (${contractId}, NULL, NULL, ${orgId}, ${row.freelancer_user_id}, 'offered', 1, ${userId}, now(), now())
        `;
        await insertContractVersion(tx, contractId, 1, terms.value, hash, "client", userId);
        await tx`
          INSERT INTO service_orders (id, service_id, contract_id, organization_id, client_user_id, freelancer_user_id, package_key, package_json, price_minor, delivery_days, client_requirements, created_at)
          VALUES (${orderId}, ${row.id}, ${contractId}, ${orgId}, ${userId}, ${row.freelancer_user_id}, ${pkg.key}, ${JSON.stringify(pkg)}, ${pkg.price_minor}, ${pkg.delivery_days}, ${requirements}, now())
        `;
        await recordContractEvent(tx, contractId, userId, "client", "order.placed", { title: row.title, package: pkg.name });
        return { code: "OK" as const, contractId, orderId };
      });
      if (result.code === "LIMIT") return failure("LIMIT_REACHED", "This account already has open orders for this service waiting for the freelancer.", 409, requestId);
      return success(
        { order_id: result.orderId, contract_id: result.contractId, status: "offered", total_minor: pkg.price_minor },
        "Order placed. The freelancer accepts it to start; you can fund the milestone from the contract.",
        201, requestId
      );
    }

    /* ---------------- freelancer: edit / transition ---------------- */
    const row = (await sql<ServiceRow[]>`SELECT * FROM services WHERE id = ${serviceId} LIMIT 1`)[0];
    if (!row || row.freelancer_user_id !== userId || row.status === "removed") return failure("NOT_FOUND", "Service not found", 404, requestId);

    if (method === "PUT") {
      if (row.status === "in_review") return failure("IN_REVIEW", "A moderator is reviewing this service. Edit it after their decision.", 409, requestId);
      const v = validateService((await body(request)) ?? {});
      if (!v.ok) return failure("INVALID_SERVICE", "Check the highlighted fields.", 422, requestId, [v.errors]);
      if (v.value.category_slug !== row.category_slug && !(await categoryEnabled(sql, v.value.category_slug))) {
        return failure("INVALID_SERVICE", "Check the highlighted fields.", 422, requestId, [{ category_slug: "This category is not open." }]);
      }
      const s = v.value;
      const findings = row.status === "published" ? screenService(s) : [];
      const status = findings.length ? "in_review" : row.status;
      const updated = await sql<ServiceRow[]>`
        UPDATE services SET category_slug = ${s.category_slug}, title = ${s.title}, description = ${s.description}, skills_json = ${JSON.stringify(s.skills)},
          packages_json = ${JSON.stringify(s.packages)}, requirements = ${s.requirements}, min_price_minor = ${minPrice(s.packages)},
          status = ${status}, moderation_note = ${findings.length ? `screen:${findings.join(",")}` : row.moderation_note}, updated_at = now()
        WHERE id = ${row.id} RETURNING *
      `;
      return success(serviceOut(updated[0], { moderation_note: updated[0].moderation_note }), findings.length ? "Saved. The changes need a moderator's review before the service is shown again." : "Saved", 200, requestId);
    }

    const action = ((await body(request)) ?? {}).action;
    const allowed: Record<string, string[]> = { publish: ["draft"], pause: ["published"], resume: ["paused"], remove: ["draft", "published", "paused", "in_review"] };
    if (typeof action !== "string" || !allowed[action]) return failure("INVALID_REQUEST", "action must be publish, pause, resume or remove.", 422, requestId);
    if (!allowed[action].includes(row.status)) return failure("INVALID_TRANSITION", `A ${row.status.replace("_", " ")} service cannot be ${action === "publish" ? "published" : action + "d"}.`, 409, requestId);
    let next = action === "pause" ? "paused" : action === "remove" ? "removed" : "published";
    let note = row.moderation_note;
    if (action === "publish" || action === "resume") {
      if (!roles.includes("freelancer")) return failure("FREELANCER_ROLE_REQUIRED", "Turn on the freelancer role first.", 403, requestId);
      const name = (await sql<{ full_name: string }[]>`SELECT full_name FROM profiles WHERE user_id = ${userId} LIMIT 1`)[0]?.full_name ?? "";
      if (name.trim().length < 2) return failure("PROFILE_INCOMPLETE", "Add your name on your profile before publishing.", 422, requestId);
      if (!(await categoryEnabled(sql, row.category_slug))) return failure("CATEGORY_CLOSED", "This category is closed. Move the service to an open category.", 409, requestId);
      const v = validateService({ ...row, skills: jsonList(row.skills_json), packages: packagesOf(row) });
      if (!v.ok) return failure("INVALID_SERVICE", "Complete the service before publishing.", 422, requestId, [v.errors]);
      const findings = screenService(v.value);
      if (findings.length) { next = "in_review"; note = `screen:${findings.join(",")}`; } else note = "";
    }
    const updated = await sql<ServiceRow[]>`
      UPDATE services SET status = ${next}, moderation_note = ${note},
        published_at = CASE WHEN ${next} = 'published' THEN COALESCE(published_at, now()) ELSE published_at END, updated_at = now()
      WHERE id = ${row.id} AND status = ${row.status} RETURNING *
    `;
    if (!updated[0]) return failure("INVALID_TRANSITION", "The service changed. Reload and try again.", 409, requestId);
    const message = next === "in_review" ? "A moderator will review this service before it is shown." : next === "published" ? "Published. Clients can find and order it." : next === "paused" ? "Paused. Clients cannot order it." : "Removed.";
    return success(serviceOut(updated[0], { moderation_note: updated[0].moderation_note }), message, 200, requestId);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
