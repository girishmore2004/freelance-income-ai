import type { Env } from "../types";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database, jsonList, safeHttpUrl } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { canManageOrganization, loadRoles } from "./identity";
import { notifyUsers, organizationManagers } from "./notify";
import { tableExists } from "./external-pipeline";

/**
 * Staff verification queues (U10; spec §14 "Freelancer Verification",
 * "Client Verification").
 *
 * What "verified" means here: a staff member looked at public evidence the
 * person gave (work links, business website, registration number) next to the
 * account's own history and found it consistent. It is NOT an identity or KYC
 * check — no identity documents are collected (that needs D-1/D-2) — and the
 * badge says so.
 *
 *   GET  /api/v1/me/verification                       my freelancer status and my client accounts' status
 *   POST /api/v1/me/verification {subject, organization_id?, links[], note?, registration_number?}
 *   GET  /api/v1/admin/verifications?status=pending    staff (admin, moderator) queue with evidence and account facts
 *   POST /api/v1/admin/verifications/{id} {decision: approve|reject, note}
 *   POST /api/v1/admin/verifications/{id}/revoke {note}
 *
 * Staff cannot decide their own request. Every decision is written to the
 * append-only moderation log and notified to the requester.
 */

export interface VerificationRouteDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
}

const defaultDeps: VerificationRouteDeps = { database, authenticate: authenticateRequest };

export const VERIFIED_MEANING = "Staff reviewed this account's public work evidence and history. This is not an identity check.";

export type Evidence = { links: string[]; note: string; registration_number: string };

export function validateEvidence(input: Record<string, unknown>): { ok: true; value: Evidence } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const raw = Array.isArray(input.links) ? input.links : [];
  const valid = raw.map((l) => safeHttpUrl(l, 500)).filter(Boolean);
  const links = [...new Set(valid)];
  if (raw.length > 5) errors.links = "Add up to 5 links.";
  else if (!links.length) errors.links = "Add at least one http(s) link to your work, profile or business website.";
  else if (valid.length !== raw.length) errors.links = "Every link must be a full http(s) address.";
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > 1000) errors.note = "Keep the note under 1,000 characters.";
  const reg = typeof input.registration_number === "string" ? input.registration_number.trim() : "";
  if (reg.length > 60 || (reg && !/^[A-Za-z0-9 ./-]+$/.test(reg))) errors.registration_number = "Use letters, numbers, spaces, dots, slashes or dashes (60 at most).";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { links, note, registration_number: reg } };
}

type RequestRow = {
  id: string; subject_type: "freelancer" | "client"; subject_id: string; requested_by: string | null; evidence_json: string;
  status: string; decided_by: string | null; decided_at: Date | null; decision_note: string; created_at: Date;
};

function requestOut(r: RequestRow | undefined) {
  if (!r) return null;
  let evidence: unknown = {};
  try { evidence = JSON.parse(r.evidence_json || "{}"); } catch { evidence = {}; }
  return {
    id: r.id, subject_type: r.subject_type, subject_id: r.subject_id, status: r.status, evidence,
    decision_note: r.status === "pending" ? "" : r.decision_note,
    decided_at: r.decided_at ? new Date(r.decided_at).toISOString() : null, created_at: new Date(r.created_at).toISOString()
  };
}

async function latest(sql: Queryable, type: string, subjectId: string): Promise<RequestRow | undefined> {
  return (await sql<RequestRow[]>`
    SELECT * FROM verification_requests WHERE subject_type = ${type} AND subject_id = ${subjectId} ORDER BY created_at DESC LIMIT 1
  `)[0];
}

/** Facts staff weigh next to the evidence; all from the platform's own records. */
async function subjectFacts(sql: Queryable, r: RequestRow): Promise<Record<string, unknown>> {
  if (r.subject_type === "freelancer") {
    const p = (await sql<Array<Record<string, unknown>>>`
      SELECT p.full_name, p.headline, p.skills, p.portfolio_links, p.marketplace_visible, u.email_verified, u.created_at,
             (SELECT count(*)::int FROM contracts c WHERE c.freelancer_user_id = p.user_id AND c.status = 'completed') AS completed_contracts,
             (SELECT count(*)::int FROM reports rp WHERE rp.target_type = 'user' AND rp.target_id = p.user_id) AS reports
      FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ${r.subject_id} LIMIT 1
    `)[0];
    if (!p) return { missing: true };
    return {
      name: p.full_name, headline: p.headline, skills: jsonList(p.skills).slice(0, 12), profile_links: jsonList(p.portfolio_links).map((l) => safeHttpUrl(l)).filter(Boolean),
      visible_to_clients: Boolean(p.marketplace_visible), email_verified: Boolean(p.email_verified),
      account_created_at: new Date(p.created_at as string).toISOString(), completed_contracts: Number(p.completed_contracts), reports: Number(p.reports)
    };
  }
  const o = (await sql<Array<Record<string, unknown>>>`
    SELECT o.name, o.kind, o.industry, o.website, o.country, o.status, o.created_at,
           (SELECT count(*)::int FROM organization_memberships m WHERE m.organization_id = o.id AND m.status = 'active') AS members,
           (SELECT count(*)::int FROM project_listings l WHERE l.organization_id = o.id AND l.status NOT IN ('draft')) AS projects,
           (SELECT count(*)::int FROM contracts c WHERE c.organization_id = o.id AND c.status = 'completed') AS completed_contracts,
           (SELECT count(*)::int FROM reports rp JOIN project_listings l ON rp.target_type = 'listing' AND rp.target_id = l.id WHERE l.organization_id = o.id) AS reports
    FROM organizations o WHERE o.id = ${r.subject_id} LIMIT 1
  `)[0];
  if (!o) return { missing: true };
  return {
    name: o.name, kind: o.kind, industry: o.industry, website: safeHttpUrl(o.website) || null, country: o.country, status: o.status,
    account_created_at: new Date(o.created_at as string).toISOString(), members: Number(o.members), projects: Number(o.projects),
    completed_contracts: Number(o.completed_contracts), reports: Number(o.reports)
  };
}

async function requesterRecipients(sql: Queryable, r: RequestRow): Promise<string[]> {
  return r.subject_type === "freelancer" ? [r.subject_id] : organizationManagers(sql, r.subject_id);
}

export async function handleVerificationRoute(request: Request, env: Env, requestId: string, deps: VerificationRouteDeps = defaultDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const decide = path.match(/^\/api\/v1\/admin\/verifications\/([\w-]{1,64})(\/revoke)?$/);
  const known =
    (path === "/api/v1/me/verification" && (method === "GET" || method === "POST")) ||
    (path === "/api/v1/admin/verifications" && method === "GET") ||
    (decide !== null && method === "POST");
  if (!known) return null;

  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);

  try {
    const ready = await tableExists(sql, "verification_requests");

    if (path === "/api/v1/me/verification") {
      if (!ready) {
        if (method === "GET") return success({ available: false, meaning: VERIFIED_MEANING, freelancer: null, organizations: [] }, "Verification", 200, requestId);
        return failure("MIGRATION_PENDING", "Verification needs database migration 0071.", 503, requestId);
      }
      const roles = await loadRoles(sql, userId);
      const orgs = await sql<Array<{ id: string; name: string; role: string; verified_at: Date | null }>>`
        SELECT o.id, o.name, m.role, o.verified_at FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = ${userId} AND m.status = 'active' ORDER BY o.created_at ASC LIMIT 20
      `;
      if (method === "GET") {
        const profile = (await sql<Array<{ verified_at: Date | null }>>`SELECT verified_at FROM profiles WHERE user_id = ${userId} LIMIT 1`)[0];
        return success(
          {
            available: true,
            meaning: VERIFIED_MEANING,
            freelancer: roles.includes("freelancer")
              ? { verified_at: profile?.verified_at ? new Date(profile.verified_at).toISOString() : null, latest: requestOut(await latest(sql, "freelancer", userId)) }
              : null,
            organizations: await Promise.all(orgs.map(async (o) => ({
              id: o.id, name: o.name, can_request: canManageOrganization(o.role),
              verified_at: o.verified_at ? new Date(o.verified_at).toISOString() : null,
              latest: requestOut(await latest(sql, "client", o.id))
            })))
          },
          "Verification",
          200,
          requestId
        );
      }

      const payload = (await body(request)) ?? {};
      const subject = payload.subject === "client" ? "client" : payload.subject === "freelancer" ? "freelancer" : null;
      if (!subject) return failure("INVALID_SUBJECT", "Choose freelancer or client.", 422, requestId);
      let subjectId = userId;
      if (subject === "freelancer") {
        if (!roles.includes("freelancer")) return failure("FREELANCER_ROLE_REQUIRED", "Turn on the freelancer role first.", 403, requestId);
        const profile = (await sql<Array<{ full_name: string; verified_at: Date | null }>>`SELECT full_name, verified_at FROM profiles WHERE user_id = ${userId} LIMIT 1`)[0];
        if (!profile || !profile.full_name.trim()) return failure("PROFILE_INCOMPLETE", "Add your name to your profile first.", 422, requestId);
        if (profile.verified_at) return failure("ALREADY_VERIFIED", "Your profile is already reviewed.", 409, requestId);
      } else {
        const org = orgs.find((o) => o.id === payload.organization_id);
        if (!org) return failure("NOT_FOUND", "Client account not found", 404, requestId);
        if (!canManageOrganization(org.role)) return failure("FORBIDDEN", "Owners and admins ask for a client account review.", 403, requestId);
        if (org.verified_at) return failure("ALREADY_VERIFIED", "This client account is already reviewed.", 409, requestId);
        subjectId = org.id;
      }
      const v = validateEvidence(payload);
      if (!v.ok) return failure("INVALID_EVIDENCE", "Check the highlighted fields.", 422, requestId, [v.errors]);
      const rows = await sql<RequestRow[]>`
        INSERT INTO verification_requests (id, subject_type, subject_id, requested_by, evidence_json, status, created_at)
        VALUES (${crypto.randomUUID()}, ${subject}, ${subjectId}, ${userId}, ${JSON.stringify(v.value)}, 'pending', now())
        ON CONFLICT DO NOTHING
        RETURNING *
      `;
      if (!rows[0]) return failure("ALREADY_PENDING", "A review is already waiting for staff.", 409, requestId);
      return success(requestOut(rows[0]), "Sent for review", 201, requestId);
    }

    // staff
    const roles = await loadRoles(sql, userId);
    if (!roles.includes("admin") && !roles.includes("moderator")) return failure("NOT_FOUND", "Not found", 404, requestId);
    if (!ready) return failure("MIGRATION_PENDING", "Verification needs database migration 0071.", 503, requestId);

    if (path === "/api/v1/admin/verifications") {
      const status = ["pending", "approved", "rejected", "revoked"].includes(url.searchParams.get("status") ?? "") ? url.searchParams.get("status")! : "pending";
      const rows = await sql<RequestRow[]>`
        SELECT * FROM verification_requests WHERE status = ${status}
        ORDER BY CASE WHEN ${status} = 'pending' THEN created_at END ASC, created_at DESC LIMIT 50
      `;
      const items = await Promise.all(rows.map(async (r) => ({
        ...requestOut(r), requested_by: r.requested_by, own_request: r.requested_by === userId, facts: await subjectFacts(sql, r)
      })));
      return success({ items, meaning: VERIFIED_MEANING }, "Verification queue", 200, requestId);
    }

    const payload = (await body(request)) ?? {};
    const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 2000) : "";
    const revoke = Boolean(decide![2]);
    const decision = revoke ? "revoke" : payload.decision === "approve" ? "approve" : payload.decision === "reject" ? "reject" : null;
    if (!decision) return failure("INVALID_DECISION", "Decision must be approve or reject.", 422, requestId);
    if (decision !== "approve" && note.length < 5) return failure("NOTE_REQUIRED", "Explain the decision (5 characters or more); the person sees it.", 422, requestId);

    const result = await sql.begin(async (tx) => {
      const r = (await tx<RequestRow[]>`SELECT * FROM verification_requests WHERE id = ${decide![1]} FOR UPDATE`)[0];
      if (!r) return { error: failure("NOT_FOUND", "Request not found", 404, requestId) };
      if (r.requested_by === userId) return { error: failure("SECOND_REVIEWER_REQUIRED", "Another staff member must decide your own request.", 403, requestId) };
      const expected = revoke ? "approved" : "pending";
      if (r.status !== expected) return { error: failure("REQUEST_CLOSED", revoke ? "Only an approved review can be revoked." : "This request has already been decided.", 409, requestId) };
      const next = { approve: "approved", reject: "rejected", revoke: "revoked" }[decision];
      await tx`UPDATE verification_requests SET status = ${next}, decided_by = ${userId}, decided_at = now(), decision_note = ${note} WHERE id = ${r.id}`;
      const stamp = decision === "approve";
      if (r.subject_type === "freelancer") {
        if (stamp) await tx`UPDATE profiles SET verified_at = now() WHERE user_id = ${r.subject_id}`;
        else if (revoke) await tx`UPDATE profiles SET verified_at = NULL WHERE user_id = ${r.subject_id}`;
      } else {
        if (stamp) await tx`UPDATE organizations SET verified_at = now(), updated_at = now() WHERE id = ${r.subject_id}`;
        else if (revoke) await tx`UPDATE organizations SET verified_at = NULL, updated_at = now() WHERE id = ${r.subject_id}`;
      }
      await tx`
        INSERT INTO moderation_actions (id, actor_user_id, target_type, target_id, action, note, created_at)
        VALUES (${crypto.randomUUID()}, ${userId}, ${r.subject_type === "freelancer" ? "user" : "organization"}, ${r.subject_id}, ${`verification.${next}`}, ${note}, now())
      `;
      return { request: { ...r, status: next, decision_note: note, decided_at: new Date() } as RequestRow };
    });
    if ("error" in result && result.error) return result.error;
    const r = result.request;
    await notifyUsers(sql, await requesterRecipients(sql, r), {
      kind: `verification.${r.status}`,
      title: r.status === "approved" ? "Your account review was approved" : r.status === "rejected" ? "Your account review was not approved" : "Your reviewed badge was removed",
      message: r.status === "approved" ? VERIFIED_MEANING : note,
      link: "/account",
      dedupe: `verification:${r.id}:${r.status}`
    });
    return success(requestOut(r), `Request ${r.status}`, 200, requestId);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
