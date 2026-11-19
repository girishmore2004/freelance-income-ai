import type { Queryable, Sql } from "./core-routes";

/**
 * Identity rules (Master Plan Part A "User account model", migration 0050).
 *
 * - One login; public roles "freelancer" and "client" are self-activated.
 * - Internal roles (admin, support, moderator, finance) are never granted
 *   through public endpoints.
 * - A client acts through an organisation (individual or company) that holds
 *   the billing identity. Access to an organisation requires an active
 *   membership; non-members get 404 so existence is not disclosed.
 */

export const PUBLIC_ROLES = ["freelancer", "client"] as const;
export const INTERNAL_ROLES = ["admin", "support", "moderator", "finance"] as const;
export type PublicRole = (typeof PUBLIC_ROLES)[number];
export type Role = PublicRole | (typeof INTERNAL_ROLES)[number];

export const ORG_KINDS = ["individual", "company"] as const;
export const MEMBERSHIP_ROLES = ["owner", "admin", "member"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const MAX_ORGANIZATIONS_PER_USER = 5;

export function isPublicRole(value: unknown): value is PublicRole {
  return typeof value === "string" && (PUBLIC_ROLES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ */
/* Roles                                                               */
/* ------------------------------------------------------------------ */

export interface RoleState {
  role: string;
  status: string;
}

/**
 * Active roles. Accounts with no role rows at all (created before 0050 or by
 * the Python service) are freelancer accounts, matching the 0050 backfill.
 */
export async function loadRoles(sql: Queryable, userId: string): Promise<string[]> {
  const rows = await sql<RoleState[]>`SELECT role, status FROM user_roles WHERE user_id = ${userId}`;
  return activeRoles(rows);
}

/**
 * Active roles from the role rows. An account with no freelancer or client row
 * at all is a freelancer account, even when a staff role (admin, moderator…)
 * was granted to it: a staff grant must not take away the built-in side. Pure.
 */
export function activeRoles(rows: RoleState[]): string[] {
  const active = rows.filter((row) => row.status === "active").map((row) => row.role);
  const hasPublicRow = rows.some((row) => isPublicRole(row.role));
  if (!hasPublicRow && !active.includes("freelancer")) active.push("freelancer");
  return [...new Set(active)].sort();
}

export type RoleChange =
  | { ok: true; roles: string[] }
  | { ok: false; code: "ROLE_NOT_ALLOWED" | "ROLE_SUSPENDED" | "LAST_PUBLIC_ROLE"; message: string };

/** Idempotently activates a public role. Suspended roles cannot be self-reactivated. */
export async function activateRole(sql: Queryable, userId: string, role: string): Promise<RoleChange> {
  if (!isPublicRole(role)) return { ok: false, code: "ROLE_NOT_ALLOWED", message: "Only the freelancer and client roles can be activated." };
  await materializeLegacyRole(sql, userId);
  const existing = await sql<RoleState[]>`SELECT role, status FROM user_roles WHERE user_id = ${userId} AND role = ${role}`;
  if (existing[0]?.status === "suspended") {
    return { ok: false, code: "ROLE_SUSPENDED", message: "This role is suspended. Contact support." };
  }
  await sql`
    INSERT INTO user_roles (id, user_id, role, status, granted_by, created_at, updated_at)
    VALUES (${crypto.randomUUID()}, ${userId}, ${role}, 'active', 'self', now(), now())
    ON CONFLICT (user_id, role) DO UPDATE SET status = 'active', updated_at = now()
    WHERE user_roles.status = 'inactive'
  `;
  return { ok: true, roles: await loadRoles(sql, userId) };
}

/** Deactivates a public role, keeping at least one active public role. */
export async function deactivateRole(sql: Queryable, userId: string, role: string): Promise<RoleChange> {
  if (!isPublicRole(role)) return { ok: false, code: "ROLE_NOT_ALLOWED", message: "Only the freelancer and client roles can be changed here." };
  await materializeLegacyRole(sql, userId);
  const active = (await loadRoles(sql, userId)).filter(isPublicRole);
  if (active.length === 1 && active[0] === role) {
    return { ok: false, code: "LAST_PUBLIC_ROLE", message: "Keep at least one of the freelancer and client roles active." };
  }
  await sql`
    UPDATE user_roles SET status = 'inactive', updated_at = now()
    WHERE user_id = ${userId} AND role = ${role} AND status = 'active'
  `;
  return { ok: true, roles: await loadRoles(sql, userId) };
}

/** Writes the implicit freelancer role (accounts with no freelancer or client row) before changing roles. */
export async function materializeLegacyRole(sql: Queryable, userId: string): Promise<void> {
  const any = await sql`SELECT 1 FROM user_roles WHERE user_id = ${userId} AND role IN ('freelancer', 'client') LIMIT 1`;
  if (any.length) return;
  await sql`
    INSERT INTO user_roles (id, user_id, role, status, granted_by, created_at, updated_at)
    VALUES (${crypto.randomUUID()}, ${userId}, 'freelancer', 'active', 'legacy-account', now(), now())
    ON CONFLICT (user_id, role) DO NOTHING
  `;
}

/* ------------------------------------------------------------------ */
/* Organisations                                                       */
/* ------------------------------------------------------------------ */

export interface OrganizationInput {
  name: string;
  kind: "individual" | "company";
  industry: string;
  website: string;
  country: string;
  preferred_language: string;
  billing_name: string;
  billing_email: string;
  billing_address: string;
  tax_id: string;
}

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max + 1) : "";
}

/**
 * Validates create (partial = false) or update (partial = true) input.
 * Unknown fields are ignored; fields that are present must be valid.
 */
export function validateOrganization(input: Record<string, unknown>, partial: boolean): Validation<Partial<OrganizationInput>> {
  const errors: Record<string, string> = {};
  const out: Partial<OrganizationInput> = {};
  const has = (key: string) => input[key] !== undefined;

  if (!partial || has("name")) {
    const name = clean(input.name, 160);
    if (name.length < 2 || name.length > 160) errors.name = "Enter a name of 2 to 160 characters.";
    else out.name = name;
  }
  if (!partial || has("kind")) {
    const kind = input.kind ?? "individual";
    if (kind !== "individual" && kind !== "company") errors.kind = "Choose individual or company.";
    else out.kind = kind;
  }
  if (has("industry")) {
    const industry = clean(input.industry, 120);
    if (industry.length > 120) errors.industry = "Industry is too long.";
    else out.industry = industry;
  }
  if (has("website")) {
    const website = clean(input.website, 300);
    if (website && (!/^https:\/\/[^\s/]+\.[^\s]+$/i.test(website) || website.length > 300)) errors.website = "Use a full https:// address.";
    else out.website = website;
  }
  if (!partial || has("country")) {
    const country = clean(input.country ?? "IN", 2).toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) errors.country = "Use a two-letter country code, for example IN.";
    else out.country = country;
  }
  if (has("preferred_language")) {
    const language = clean(input.preferred_language, 20).toLowerCase();
    if (language && !/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(language)) errors.preferred_language = "Use a language code such as en or hi.";
    else out.preferred_language = language || "en";
  }
  if (has("billing_name")) {
    const billingName = clean(input.billing_name, 200);
    if (billingName.length > 200) errors.billing_name = "Billing name is too long.";
    else out.billing_name = billingName;
  }
  if (has("billing_email")) {
    const billingEmail = clean(input.billing_email, 320).toLowerCase();
    if (billingEmail && (!EMAIL_RE.test(billingEmail) || billingEmail.length > 320)) errors.billing_email = "Enter a valid billing email.";
    else out.billing_email = billingEmail;
  }
  if (has("billing_address")) {
    const address = clean(input.billing_address, 1000);
    if (address.length > 1000) errors.billing_address = "Billing address is too long.";
    else out.billing_address = address;
  }
  if (has("tax_id")) {
    const taxId = clean(input.tax_id, 40).toUpperCase().replace(/\s+/g, "");
    if (taxId && !/^[A-Z0-9-]{5,40}$/.test(taxId)) errors.tax_id = "Tax ID may contain only letters, digits and hyphens.";
    else out.tax_id = taxId;
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: out };
}

export interface OrganizationRow {
  id: string;
  name: string;
  kind: string;
  industry: string;
  website: string;
  country: string;
  preferred_language: string;
  billing_name: string;
  billing_email: string;
  billing_address: string;
  tax_id: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  membership_role: string;
}

/** Shape returned to clients. Billing fields are visible to owners and admins only. */
export function organizationOut(row: OrganizationRow) {
  const canSeeBilling = row.membership_role === "owner" || row.membership_role === "admin";
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    industry: row.industry,
    website: row.website,
    country: row.country,
    preferred_language: row.preferred_language,
    status: row.status,
    membership_role: row.membership_role,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    ...(canSeeBilling
      ? { billing: { name: row.billing_name, email: row.billing_email, address: row.billing_address, tax_id: row.tax_id } }
      : {})
  };
}

export async function listOrganizations(sql: Queryable, userId: string): Promise<OrganizationRow[]> {
  return sql<OrganizationRow[]>`
    SELECT o.*, m.role AS membership_role
    FROM organization_memberships m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = ${userId} AND m.status = 'active' AND o.status <> 'closed'
    ORDER BY o.created_at ASC
    LIMIT 50
  `;
}

/** The organisation as seen by this user, or null if they are not an active member. */
export async function organizationForMember(sql: Queryable, userId: string, organizationId: string): Promise<OrganizationRow | null> {
  const rows = await sql<OrganizationRow[]>`
    SELECT o.*, m.role AS membership_role
    FROM organization_memberships m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = ${userId} AND m.organization_id = ${organizationId} AND m.status = 'active'
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export function canManageOrganization(membershipRole: string): boolean {
  return membershipRole === "owner" || membershipRole === "admin";
}

/* ------------------------------------------------------------------ */
/* Automatic client account                                            */
/* ------------------------------------------------------------------ */

/** Name for an automatic individual client account: the person's name, else their email name. Pure; exported for tests. */
export function defaultClientName(fullName: string | null | undefined, email: string | null | undefined): string {
  const name = (fullName ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (name.length >= 2) return name;
  const local = (email ?? "").split("@")[0].replace(/[._+-]+/g, " ").replace(/\s+/g, " ").trim();
  const pretty = local.split(" ").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ").slice(0, 160);
  return pretty.length >= 2 ? pretty : "My client account";
}

/**
 * Someone with the client side always has somewhere for their projects: when they belong to no
 * client account, an individual one is created with them as owner (country IN, D-7; every detail
 * editable on the Client profile page). Serialised per person with an advisory lock so parallel
 * requests create one account. Returns true when an account was created.
 */
export async function ensureClientAccount(sql: Sql, userId: string): Promise<boolean> {
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`client-account:${userId}`}))`;
    const member = await tx`SELECT 1 FROM organization_memberships WHERE user_id = ${userId} AND status = 'active' LIMIT 1`;
    if (member.length) return false;
    const who = await tx<{ full_name: string | null; email: string | null }[]>`
      SELECT p.full_name, u.email FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ${userId} LIMIT 1
    `;
    if (!who.length) return false;
    const id = crypto.randomUUID();
    await tx`
      INSERT INTO organizations
        (id, name, kind, industry, website, country, preferred_language, billing_name, billing_email,
         billing_address, tax_id, status, created_by, created_at, updated_at)
      VALUES
        (${id}, ${defaultClientName(who[0].full_name, who[0].email)}, 'individual', '', '', 'IN', 'en', '', '', '', '', 'active', ${userId}, now(), now())
    `;
    await tx`
      INSERT INTO organization_memberships (id, organization_id, user_id, role, status, created_at)
      VALUES (${crypto.randomUUID()}, ${id}, ${userId}, 'owner', 'active', now())
    `;
    return true;
  });
}
