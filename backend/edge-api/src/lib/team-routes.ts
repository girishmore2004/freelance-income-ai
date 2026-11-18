import type { Env } from "../types";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database, sha256Hex } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { FLAGS, isEnabled } from "./flags";
import { activateRole, organizationForMember } from "./identity";
import { notifyUsers, organizationManagers } from "./notify";

/**
 * Organisation teams (K-17): invitations, roles, removal, ownership transfer.
 *
 * Owners and admins
 *   GET  /api/v1/organizations/{id}/invitations                 pending invitations (no tokens)
 *   POST /api/v1/organizations/{id}/invitations {email, role}   returns a one-time join link (shown once)
 *   POST /api/v1/organizations/{id}/invitations/{inv}/revoke
 *   POST /api/v1/organizations/{id}/members/{userId}/remove     owner: anyone but the owner; admin: members; anyone: themselves (leave)
 * Owner only
 *   POST /api/v1/organizations/{id}/members/{userId}/role {role: admin|member}
 *   POST /api/v1/organizations/{id}/transfer-ownership {user_id}  the previous owner becomes an admin
 * Invited person
 *   GET  /api/v1/organization-invitations/preview?token=       organisation name and role for the join page
 *   POST /api/v1/organization-invitations/accept {token}       signed-in email must match the invitation
 *   GET  /api/v1/me/organization-invitations                    pending invitations for a verified email
 *   POST /api/v1/organization-invitations/{id}/accept|decline   verified email only
 *
 * Only a SHA-256 hash of the token is stored. Email delivery is not available
 * yet (D-15), so the owner shares the link; the email match stops a forwarded
 * link from being used by someone else. Admins can invite members only; only
 * the owner can make admins.
 */

export interface TeamRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
  now?: () => Date;
}

const defaultDeps: TeamRouteDeps = { database, authenticate: authenticateRequest };

export const INVITATION_DAYS = 7;
export const MAX_PENDING_INVITATIONS = 50;
export const MAX_MEMBERS = 50;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

interface InvitationRow {
  id: string;
  organization_id: string;
  email: string;
  role: "admin" | "member";
  status: string;
  invited_by: string | null;
  expires_at: Date;
  created_at: Date;
}

function invitationOut(i: InvitationRow, now: Date) {
  return {
    id: i.id,
    email: i.email,
    role: i.role,
    status: i.status === "pending" && new Date(i.expires_at).getTime() <= now.getTime() ? "expired" : i.status,
    expires_at: new Date(i.expires_at).toISOString(),
    created_at: new Date(i.created_at).toISOString()
  };
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 320 && EMAIL.test(email) ? email : null;
}

export function newInvitationToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

const tokenOk = (t: unknown): t is string => typeof t === "string" && /^[A-Za-z0-9_-]{40,64}$/.test(t);

/** Adds (or re-activates) a membership and switches on the client role. Inside a transaction. */
async function join(tx: Queryable, organizationId: string, userId: string, role: "admin" | "member"): Promise<"joined" | "already" | "full"> {
  const existing = (await tx<{ status: string }[]>`
    SELECT status FROM organization_memberships WHERE organization_id = ${organizationId} AND user_id = ${userId} LIMIT 1 FOR UPDATE
  `)[0];
  if (existing?.status === "active") return "already";
  const count = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM organization_memberships WHERE organization_id = ${organizationId} AND status = 'active'`;
  if ((count[0]?.n ?? 0) >= MAX_MEMBERS) return "full";
  if (existing) {
    await tx`UPDATE organization_memberships SET status = 'active', role = ${role} WHERE organization_id = ${organizationId} AND user_id = ${userId}`;
  } else {
    await tx`
      INSERT INTO organization_memberships (id, organization_id, user_id, role, status, created_at)
      VALUES (${crypto.randomUUID()}, ${organizationId}, ${userId}, ${role}, 'active', now())
    `;
  }
  await activateRole(tx, userId, "client");
  return "joined";
}

export async function handleTeamRoute(request: Request, env: Env, requestId: string, deps: TeamRouteDeps = defaultDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const orgInvites = path.match(/^\/api\/v1\/organizations\/([\w-]{1,64})\/invitations$/);
  const revoke = path.match(/^\/api\/v1\/organizations\/([\w-]{1,64})\/invitations\/([\w-]{1,64})\/revoke$/);
  const member = path.match(/^\/api\/v1\/organizations\/([\w-]{1,64})\/members\/([\w-]{1,64})\/(role|remove)$/);
  const transfer = path.match(/^\/api\/v1\/organizations\/([\w-]{1,64})\/transfer-ownership$/);
  const respond = path.match(/^\/api\/v1\/organization-invitations\/([\w-]{1,64})\/(accept|decline)$/);
  const known =
    (method === "GET" && (orgInvites !== null || path === "/api/v1/organization-invitations/preview" || path === "/api/v1/me/organization-invitations")) ||
    (method === "POST" && (orgInvites !== null || revoke !== null || member !== null || transfer !== null || respond !== null || path === "/api/v1/organization-invitations/accept"));
  if (!known) return null;

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const myEmail = auth.user.email.trim().toLowerCase();
  const now = (deps.now ?? (() => new Date()))();
  const sql = deps.database(env);

  try {
    if (!(await isEnabled(env, sql, FLAGS.clientMarketplace, false))) return failure("NOT_FOUND", "Not found", 404, requestId);

    /* ---------------- invited person ---------------- */
    if (path === "/api/v1/organization-invitations/preview" || path === "/api/v1/organization-invitations/accept") {
      const payload = method === "POST" ? (await body(request)) ?? {} : {};
      const token = method === "POST" ? payload.token : url.searchParams.get("token");
      if (!tokenOk(token)) return failure("INVALID_INVITATION", "This invitation link is not valid.", 404, requestId);
      const hash = await sha256Hex(token);
      const invite = (await sql<(InvitationRow & { organization_name: string })[]>`
        SELECT i.*, o.name AS organization_name FROM organization_invitations i JOIN organizations o ON o.id = i.organization_id
        WHERE i.token_hash = ${hash} LIMIT 1
      `)[0];
      if (!invite || invite.status !== "pending" || new Date(invite.expires_at).getTime() <= now.getTime()) {
        return failure("INVALID_INVITATION", "This invitation is no longer valid. Ask the account owner for a new link.", 404, requestId);
      }
      const emailMatches = invite.email === myEmail;
      if (method === "GET") {
        return success(
          { organization_name: invite.organization_name, role: invite.role, email_matches: emailMatches, expires_at: new Date(invite.expires_at).toISOString() },
          "Invitation",
          200,
          requestId
        );
      }
      if (!emailMatches) {
        return failure("EMAIL_MISMATCH", "This invitation was sent to a different email address. Sign in with that address to accept it.", 403, requestId);
      }
      return await acceptInvitation(sql, invite, userId, requestId);
    }

    if (path === "/api/v1/me/organization-invitations") {
      if (!auth.user.email_verified) {
        return success({ items: [], verified: false }, "Verify your email to see invitations here, or open the link you were sent.", 200, requestId);
      }
      const rows = await sql<(InvitationRow & { organization_name: string })[]>`
        SELECT i.*, o.name AS organization_name FROM organization_invitations i JOIN organizations o ON o.id = i.organization_id
        WHERE i.email = ${myEmail} AND i.status = 'pending' AND i.expires_at > ${now.toISOString()}
        ORDER BY i.created_at DESC LIMIT 20
      `;
      return success({ items: rows.map((r) => ({ ...invitationOut(r, now), organization_name: r.organization_name })), verified: true }, "Invitations", 200, requestId);
    }

    if (respond) {
      const invite = (await sql<InvitationRow[]>`SELECT * FROM organization_invitations WHERE id = ${respond[1]} LIMIT 1`)[0];
      // A verified email is required to act without the link; otherwise it looks like the invitation does not exist.
      if (!invite || !auth.user.email_verified || invite.email !== myEmail) return failure("NOT_FOUND", "Invitation not found", 404, requestId);
      if (invite.status !== "pending" || new Date(invite.expires_at).getTime() <= now.getTime()) {
        return failure("INVALID_INVITATION", "This invitation is no longer valid.", 409, requestId);
      }
      if (respond[2] === "decline") {
        const rows = await sql<{ id: string }[]>`
          UPDATE organization_invitations SET status = 'declined', responded_at = now() WHERE id = ${invite.id} AND status = 'pending' RETURNING id
        `;
        if (!rows[0]) return failure("INVALID_INVITATION", "This invitation is no longer valid.", 409, requestId);
        return success({ id: invite.id }, "Invitation declined", 200, requestId);
      }
      return await acceptInvitation(sql, invite, userId, requestId);
    }

    /* ---------------- organisation managers ---------------- */
    const organizationId = (orgInvites ?? revoke ?? member ?? transfer)![1];
    const org = await organizationForMember(sql, userId, organizationId);
    if (!org) return failure("NOT_FOUND", "Organisation not found", 404, requestId);
    const myRole = org.membership_role;
    const isOwner = myRole === "owner";
    const canManage = isOwner || myRole === "admin";

    if (orgInvites && method === "GET") {
      if (!canManage) return failure("FORBIDDEN", "Only owners and admins can see invitations.", 403, requestId);
      const rows = await sql<InvitationRow[]>`
        SELECT * FROM organization_invitations WHERE organization_id = ${organizationId} AND status = 'pending' ORDER BY created_at DESC LIMIT 100
      `;
      return success(rows.map((r) => invitationOut(r, now)), "Invitations", 200, requestId);
    }

    if (orgInvites) {
      if (!canManage) return failure("FORBIDDEN", "Only owners and admins can invite.", 403, requestId);
      const payload = (await body(request)) ?? {};
      const email = normalizeEmail(payload.email);
      const role = payload.role === "admin" ? "admin" : payload.role === "member" || payload.role === undefined ? "member" : null;
      if (!email) return failure("INVALID_EMAIL", "Enter a valid email address.", 422, requestId);
      if (!role) return failure("INVALID_ROLE", "Role must be admin or member.", 422, requestId);
      if (role === "admin" && !isOwner) return failure("FORBIDDEN", "Only the owner can invite admins.", 403, requestId);
      if (email === myEmail) return failure("INVALID_EMAIL", "You are already in this organisation.", 422, requestId);
      const already = await sql<{ id: string }[]>`
        SELECT m.id FROM organization_memberships m JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = ${organizationId} AND m.status = 'active' AND lower(u.email) = ${email} LIMIT 1
      `;
      if (already[0]) return failure("ALREADY_MEMBER", "This person is already a member.", 409, requestId);
      const pending = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM organization_invitations WHERE organization_id = ${organizationId} AND status = 'pending'`;
      if ((pending[0]?.n ?? 0) >= MAX_PENDING_INVITATIONS) return failure("LIMIT_REACHED", "Too many pending invitations. Revoke some first.", 429, requestId);

      const token = newInvitationToken();
      const hash = await sha256Hex(token);
      const expires = new Date(now.getTime() + INVITATION_DAYS * 86_400_000);
      const created = await sql.begin(async (tx) => {
        // A new invitation to the same email replaces the previous link.
        await tx`UPDATE organization_invitations SET status = 'revoked', responded_at = now() WHERE organization_id = ${organizationId} AND email = ${email} AND status = 'pending'`;
        const rows = await tx<InvitationRow[]>`
          INSERT INTO organization_invitations (id, organization_id, email, role, token_hash, status, invited_by, expires_at, created_at)
          VALUES (${crypto.randomUUID()}, ${organizationId}, ${email}, ${role}, ${hash}, 'pending', ${userId}, ${expires.toISOString()}, now())
          RETURNING *
        `;
        return rows[0];
      });
      // If the person already has an account, tell them in-app too.
      const existing = (await sql<{ id: string }[]>`SELECT id FROM users WHERE lower(email) = ${email} LIMIT 1`)[0];
      if (existing) {
        await notifyUsers(sql, [existing.id], {
          kind: "organization.invited",
          title: `You were invited to join ${org.name}`,
          message: `Role: ${role}. Open the link the owner shared with you, or accept it from your Account page once your email is verified.`,
          link: "/account",
          dedupe: `org-invite:${created.id}`
        });
      }
      return success(
        { invitation: invitationOut(created, now), join_path: `/join?token=${token}` },
        "Invitation created. Copy the link and send it to the person; it is shown only once and expires in 7 days.",
        201,
        requestId
      );
    }

    if (revoke) {
      if (!canManage) return failure("FORBIDDEN", "Only owners and admins can revoke invitations.", 403, requestId);
      const rows = await sql<{ id: string }[]>`
        UPDATE organization_invitations SET status = 'revoked', responded_at = now()
        WHERE id = ${revoke[2]} AND organization_id = ${organizationId} AND status = 'pending' RETURNING id
      `;
      if (!rows[0]) return failure("NOT_FOUND", "No pending invitation with that id.", 404, requestId);
      return success({ id: rows[0].id }, "Invitation revoked", 200, requestId);
    }

    if (member) {
      const targetId = member[2];
      const target = (await sql<{ role: string }[]>`
        SELECT role FROM organization_memberships WHERE organization_id = ${organizationId} AND user_id = ${targetId} AND status = 'active' LIMIT 1
      `)[0];
      if (!target) return failure("NOT_FOUND", "Member not found", 404, requestId);
      const payload = (await body(request)) ?? {};

      if (member[3] === "role") {
        if (!isOwner) return failure("FORBIDDEN", "Only the owner can change roles.", 403, requestId);
        if (target.role === "owner") return failure("FORBIDDEN", "Transfer ownership instead.", 403, requestId);
        if (payload.role !== "admin" && payload.role !== "member") return failure("INVALID_ROLE", "Role must be admin or member.", 422, requestId);
        await sql`UPDATE organization_memberships SET role = ${payload.role} WHERE organization_id = ${organizationId} AND user_id = ${targetId} AND status = 'active' AND role <> 'owner'`;
        return success({ user_id: targetId, role: payload.role }, "Role changed", 200, requestId);
      }

      // remove / leave
      const self = targetId === userId;
      if (target.role === "owner") return failure("FORBIDDEN", self ? "Transfer ownership before leaving." : "The owner cannot be removed.", 403, requestId);
      if (!self && !(isOwner || (myRole === "admin" && target.role === "member"))) {
        return failure("FORBIDDEN", "Owners remove anyone; admins remove members.", 403, requestId);
      }
      await sql`UPDATE organization_memberships SET status = 'removed' WHERE organization_id = ${organizationId} AND user_id = ${targetId} AND status = 'active' AND role <> 'owner'`;
      if (!self) {
        await notifyUsers(sql, [targetId], {
          kind: "organization.removed",
          title: `You were removed from ${org.name}`,
          message: "You no longer have access to its projects and contracts.",
          link: "/account",
          dedupe: `org-remove:${organizationId}:${targetId}:${now.getTime()}`
        });
      }
      return success({ user_id: targetId }, self ? "You left the organisation" : "Member removed", 200, requestId);
    }

    // transfer ownership
    if (!isOwner) return failure("FORBIDDEN", "Only the owner can transfer ownership.", 403, requestId);
    const payload = (await body(request)) ?? {};
    const newOwner = typeof payload.user_id === "string" ? payload.user_id : "";
    if (!newOwner || newOwner === userId) return failure("INVALID_MEMBER", "Choose another member.", 422, requestId);
    const moved = await sql.begin(async (tx) => {
      const target = (await tx<{ role: string }[]>`
        SELECT role FROM organization_memberships WHERE organization_id = ${organizationId} AND user_id = ${newOwner} AND status = 'active' LIMIT 1 FOR UPDATE
      `)[0];
      if (!target) return false;
      const demoted = await tx<{ id: string }[]>`
        UPDATE organization_memberships SET role = 'admin' WHERE organization_id = ${organizationId} AND user_id = ${userId} AND role = 'owner' AND status = 'active' RETURNING id
      `;
      if (!demoted[0]) return false;
      await tx`UPDATE organization_memberships SET role = 'owner' WHERE organization_id = ${organizationId} AND user_id = ${newOwner}`;
      return true;
    });
    if (!moved) return failure("NOT_FOUND", "Member not found", 404, requestId);
    await notifyUsers(sql, [newOwner], {
      kind: "organization.owner",
      title: `You are now the owner of ${org.name}`,
      message: "You can manage billing, the team and all projects.",
      link: "/account",
      dedupe: `org-owner:${organizationId}:${newOwner}:${now.getTime()}`
    });
    return success({ owner: newOwner }, "Ownership transferred. You are now an admin.", 200, requestId);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function acceptInvitation(sql: Sql, invite: InvitationRow, userId: string, requestId: string): Promise<Response> {
  const result = await sql.begin(async (tx) => {
    const claimed = await tx<{ id: string }[]>`
      UPDATE organization_invitations SET status = 'accepted', accepted_by = ${userId}, responded_at = now()
      WHERE id = ${invite.id} AND status = 'pending' RETURNING id
    `;
    if (!claimed[0]) return "gone" as const;
    const joined = await join(tx, invite.organization_id, userId, invite.role);
    if (joined === "full") throw new TeamFull();
    return joined;
  }).catch((error: unknown) => {
    if (error instanceof TeamFull) return "full" as const;
    throw error;
  });
  if (result === "gone") return failure("INVALID_INVITATION", "This invitation is no longer valid.", 409, requestId);
  if (result === "full") return failure("TEAM_FULL", `This organisation already has ${MAX_MEMBERS} members.`, 409, requestId);
  const managers = await organizationManagers(sql, invite.organization_id);
  await notifyUsers(sql, managers.filter((m) => m !== userId), {
    kind: "organization.joined",
    title: `${invite.email} joined your team`,
    message: `Role: ${invite.role}.`,
    link: "/account",
    dedupe: `org-joined:${invite.id}`
  });
  return success({ organization_id: invite.organization_id, role: invite.role }, result === "already" ? "You are already a member" : "You joined the organisation", 200, requestId);
}

class TeamFull extends Error {}
