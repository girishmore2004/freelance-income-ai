import type { Env } from "../types";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database } from "./core-routes";
import type { Sql } from "./core-routes";
import { failure, success } from "./response";
import { FLAGS, isEnabled } from "./flags";
import {
  MAX_ORGANIZATIONS_PER_USER,
  ensureClientAccount,
  activateRole,
  canManageOrganization,
  deactivateRole,
  isPublicRole,
  listOrganizations,
  loadRoles,
  organizationForMember,
  organizationOut,
  validateOrganization
} from "./identity";
import type { OrganizationInput } from "./identity";

/**
 * Identity routes (Phase 1):
 *
 *   GET    /api/v1/me/identity                 roles + organisations of the caller
 *   POST   /api/v1/me/roles          {role}    activate "freelancer" or "client"
 *   DELETE /api/v1/me/roles/{role}             deactivate (one public role must stay)
 *   GET    /api/v1/organizations               organisations the caller belongs to
 *   POST   /api/v1/organizations     {...}     create (client role required); caller becomes owner
 *   GET    /api/v1/organizations/{id}          member only (404 otherwise)
 *   PATCH  /api/v1/organizations/{id} {...}    owner/admin only
 *   GET    /api/v1/organizations/{id}/members  member only
 *   (team invitations, roles, removal and ownership transfer: team-routes.ts)
 *
 * The client side is behind the `marketplace.client_side` flag (default OFF):
 * activating "client" and creating organisations return 403 FEATURE_DISABLED
 * until the flag is switched on.
 */

export interface IdentityRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
}

const defaultDeps: IdentityRouteDeps = { database, authenticate: authenticateRequest };

const CLIENT_SIDE_DISABLED = "Hiring features are not open yet. They will be switched on when the client marketplace launches.";

export async function handleIdentityRoute(
  request: Request,
  env: Env,
  requestId: string,
  deps: IdentityRouteDeps = defaultDeps
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const method = request.method.toUpperCase();

  const roleMatch = path.match(/^\/api\/v1\/me\/roles\/([a-z]{1,20})$/);
  const orgMatch = path.match(/^\/api\/v1\/organizations\/([\w-]{1,64})(\/members)?$/);
  const known =
    (method === "GET" && path === "/api/v1/me/identity") ||
    (method === "POST" && path === "/api/v1/me/roles") ||
    (method === "DELETE" && roleMatch !== null) ||
    ((method === "GET" || method === "POST") && path === "/api/v1/organizations") ||
    (orgMatch !== null && ((method === "GET") || (method === "PATCH" && !orgMatch[2])));
  if (!known) return null;

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);

  try {
    // ---------------- roles ----------------
    if (path === "/api/v1/me/identity") {
      const [roles, first, clientSideEnabled] = await Promise.all([
        loadRoles(sql, userId),
        listOrganizations(sql, userId),
        isEnabled(env, sql, FLAGS.clientMarketplace, false)
      ]);
      // The client side never starts with "create a client account first": one is made for them.
      // A parallel request may have created it while this one waited, so list again after either outcome.
      const needs = roles.includes("client") && clientSideEnabled && first.length === 0;
      if (needs) await ensureClientAccount(sql, userId);
      const organizations = needs ? await listOrganizations(sql, userId) : first;
      return success(
        { user_id: userId, roles, organizations: organizations.map(organizationOut), client_side_enabled: clientSideEnabled },
        "Identity",
        200,
        requestId
      );
    }

    if (method === "POST" && path === "/api/v1/me/roles") {
      const payload = (await body(request)) ?? {};
      const role = payload.role;
      if (!isPublicRole(role)) {
        return failure("ROLE_NOT_ALLOWED", "Only the freelancer and client roles can be activated.", 422, requestId);
      }
      if (role === "client" && !(await isEnabled(env, sql, FLAGS.clientMarketplace, false))) {
        return failure("FEATURE_DISABLED", CLIENT_SIDE_DISABLED, 403, requestId);
      }
      const result = await activateRole(sql, userId, role);
      if (!result.ok) return failure(result.code, result.message, result.code === "ROLE_SUSPENDED" ? 403 : 422, requestId);
      if (role === "client") await ensureClientAccount(sql, userId);
      return success({ roles: result.roles }, `The ${role} role is active.`, 200, requestId);
    }

    if (roleMatch) {
      const result = await deactivateRole(sql, userId, roleMatch[1]);
      if (!result.ok) return failure(result.code, result.message, 422, requestId);
      return success({ roles: result.roles }, `The ${roleMatch[1]} role is switched off.`, 200, requestId);
    }

    // ---------------- organisations ----------------
    if (method === "GET" && path === "/api/v1/organizations") {
      return success((await listOrganizations(sql, userId)).map(organizationOut), "Organisations", 200, requestId);
    }

    if (method === "POST" && path === "/api/v1/organizations") {
      if (!(await isEnabled(env, sql, FLAGS.clientMarketplace, false))) {
        return failure("FEATURE_DISABLED", CLIENT_SIDE_DISABLED, 403, requestId);
      }
      const roles = await loadRoles(sql, userId);
      if (!roles.includes("client")) {
        return failure("CLIENT_ROLE_REQUIRED", "Turn on the client (hiring) role before creating a client account.", 403, requestId);
      }
      const validation = validateOrganization((await body(request)) ?? {}, false);
      if (!validation.ok) return failure("INVALID_ORGANIZATION", "Check the highlighted fields.", 422, requestId, [validation.errors]);
      const input = validation.value as OrganizationInput;

      const created = await sql.begin(async (tx) => {
        const count = await tx<{ c: string }[]>`
          SELECT count(*) AS c FROM organization_memberships WHERE user_id = ${userId} AND role = 'owner' AND status = 'active'
        `;
        if (Number(count[0]?.c ?? 0) >= MAX_ORGANIZATIONS_PER_USER) return null;
        const id = crypto.randomUUID();
        await tx`
          INSERT INTO organizations
            (id, name, kind, industry, website, country, preferred_language, billing_name, billing_email,
             billing_address, tax_id, status, created_by, created_at, updated_at)
          VALUES
            (${id}, ${input.name}, ${input.kind}, ${input.industry ?? ""}, ${input.website ?? ""}, ${input.country},
             ${input.preferred_language ?? "en"}, ${input.billing_name ?? ""}, ${input.billing_email ?? ""},
             ${input.billing_address ?? ""}, ${input.tax_id ?? ""}, 'active', ${userId}, now(), now())
        `;
        await tx`
          INSERT INTO organization_memberships (id, organization_id, user_id, role, status, created_at)
          VALUES (${crypto.randomUUID()}, ${id}, ${userId}, 'owner', 'active', now())
        `;
        return id;
      });
      if (!created) {
        return failure("ORGANIZATION_LIMIT", `You can own up to ${MAX_ORGANIZATIONS_PER_USER} client accounts.`, 409, requestId);
      }
      const row = await organizationForMember(sql, userId, created);
      return success(row ? organizationOut(row) : { id: created }, "Client account created", 201, requestId);
    }

    if (orgMatch) {
      const organizationId = orgMatch[1];
      const org = await organizationForMember(sql, userId, organizationId);
      if (!org) return failure("NOT_FOUND", "Organisation not found", 404, requestId);

      if (orgMatch[2]) {
        const members = await sql<{ user_id: string; email: string; role: string; created_at: Date }[]>`
          SELECT m.user_id, u.email, m.role, m.created_at
          FROM organization_memberships m JOIN users u ON u.id = m.user_id
          WHERE m.organization_id = ${organizationId} AND m.status = 'active'
          ORDER BY m.created_at ASC LIMIT 100
        `;
        return success(
          members.map((m) => ({ user_id: m.user_id, email: m.email, role: m.role, joined_at: new Date(m.created_at).toISOString() })),
          "Members",
          200,
          requestId
        );
      }

      if (method === "GET") return success(organizationOut(org), "Organisation", 200, requestId);

      if (!canManageOrganization(org.membership_role)) {
        return failure("FORBIDDEN", "Only owners and admins can edit this organisation.", 403, requestId);
      }
      const validation = validateOrganization((await body(request)) ?? {}, true);
      if (!validation.ok) return failure("INVALID_ORGANIZATION", "Check the highlighted fields.", 422, requestId, [validation.errors]);
      const patch = validation.value;
      if (!Object.keys(patch).length) return success(organizationOut(org), "Nothing to change", 200, requestId);

      const next = { ...org, ...patch };
      await sql`
        UPDATE organizations SET
          name = ${next.name}, kind = ${next.kind}, industry = ${next.industry}, website = ${next.website},
          country = ${next.country}, preferred_language = ${next.preferred_language}, billing_name = ${next.billing_name},
          billing_email = ${next.billing_email}, billing_address = ${next.billing_address}, tax_id = ${next.tax_id},
          updated_at = now()
        WHERE id = ${organizationId}
      `;
      const updated = await organizationForMember(sql, userId, organizationId);
      return success(updated ? organizationOut(updated) : organizationOut(next), "Organisation updated", 200, requestId);
    }

    return null;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
