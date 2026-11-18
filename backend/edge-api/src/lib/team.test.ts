import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import { handleTeamRoute, newInvitationToken, normalizeEmail } from "./team-routes";
import type { TeamRouteDeps } from "./team-routes";
import { sha256Hex } from "./core-routes";
import { createFakeSql, jsonRequest, readJson } from "./test-support";
import type { AuthenticatedSession } from "./session-service";

const NOW = new Date("2026-11-18T00:00:00Z");
const LATER = new Date("2026-11-25T00:00:00Z");

function session(userId: string, email: string, verified = false): AuthenticatedSession {
  return { user: { id: userId, email, email_verified: verified, mfa_enabled: false }, claims: { sub: userId, jti: "j", iat: 0, exp: 0 } };
}

interface World {
  user?: string;
  email?: string;
  verified?: boolean;
  myRole?: string | null;
  targetRole?: string | null;
  inviteEmail?: string;
  inviteStatus?: string;
  inviteExpires?: Date;
  memberAlready?: boolean;
  memberCount?: number;
  claimed?: boolean;
  existingMembership?: string | null;
}

function world(o: World = {}) {
  const invite = () => ({ id: "I1", organization_id: "o1", email: o.inviteEmail ?? "new@x.test", role: "member", status: o.inviteStatus ?? "pending", invited_by: "c1", expires_at: o.inviteExpires ?? LATER, created_at: NOW, organization_name: "Acme" });
  const fake = createFakeSql((text) => {
    if (text.startsWith("SELECT enabled FROM feature_flags")) return [{ enabled: true }];
    if (text.includes("FROM organization_memberships m") && text.includes("JOIN organizations o")) {
      return o.myRole === null ? [] : [{ id: "o1", name: "Acme", membership_role: o.myRole ?? "owner" }];
    }
    if (text.startsWith("SELECT i.*, o.name AS organization_name FROM organization_invitations i") || text.startsWith("SELECT * FROM organization_invitations WHERE id")) {
      return [invite()];
    }
    if (text.startsWith("SELECT * FROM organization_invitations WHERE organization_id")) return [invite()];
    if (text.startsWith("SELECT m.id FROM organization_memberships m JOIN users u")) return o.memberAlready ? [{ id: "m" }] : [];
    if (text.startsWith("SELECT count(*)::int AS n FROM organization_invitations")) return [{ n: 0 }];
    if (text.startsWith("INSERT INTO organization_invitations")) return [invite()];
    if (text.startsWith("UPDATE organization_invitations SET status = 'accepted'")) return o.claimed === false ? [] : [{ id: "I1" }];
    if (text.startsWith("UPDATE organization_invitations SET status = 'revoked'") && text.includes("RETURNING")) return [{ id: "I1" }];
    if (text.startsWith("UPDATE organization_invitations SET status = 'declined'")) return [{ id: "I1" }];
    if (text.startsWith("SELECT status FROM organization_memberships")) return o.existingMembership ? [{ status: o.existingMembership }] : [];
    if (text.startsWith("SELECT count(*)::int AS n FROM organization_memberships")) return [{ n: o.memberCount ?? 1 }];
    if (text.startsWith("SELECT role FROM organization_memberships")) return o.targetRole === null ? [] : [{ role: o.targetRole ?? "member" }];
    if (text.startsWith("UPDATE organization_memberships SET role = 'admin'")) return [{ id: "m" }];
    if (text.startsWith("SELECT role, status FROM user_roles")) return [{ role: "freelancer", status: "active" }];
    if (text.startsWith("SELECT id FROM users")) return [];
    return [];
  });
  const deps: TeamRouteDeps = { database: () => fake.sql, authenticate: async () => session(o.user ?? "c1", o.email ?? "owner@x.test", o.verified), now: () => NOW };
  return { fake, deps };
}

const env = {} as Env;
const call = (deps: TeamRouteDeps, method: string, path: string, payload?: unknown) => handleTeamRoute(jsonRequest(method, path, payload), env, "r", deps);
const TOKEN = "a".repeat(43);

describe("helpers", () => {
  it("normalises emails and makes long random tokens", () => {
    expect(normalizeEmail("  New@X.Test ")).toBe("new@x.test");
    expect(normalizeEmail("nope")).toBeNull();
    const t = newInvitationToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newInvitationToken()).not.toBe(t);
  });
});

describe("inviting", () => {
  it("lets owners invite admins and members, admins only members, members nobody", async () => {
    const w = world();
    const res = await call(w.deps, "POST", "/api/v1/organizations/o1/invitations", { email: "New@x.test", role: "admin" });
    expect(res!.status).toBe(201);
    const data = (await readJson(res!)).data;
    expect(data.join_path).toMatch(/^\/join\?token=[A-Za-z0-9_-]{43}$/);
    const insert = w.fake.queries.find((q) => q.text.startsWith("INSERT INTO organization_invitations"))!;
    const token = String(data.join_path).split("=")[1];
    expect(insert.values).toContain(await sha256Hex(token));
    expect(insert.values).not.toContain(token);
    expect(insert.values).toContain("new@x.test");
    expect((await call(world({ myRole: "admin" }).deps, "POST", "/api/v1/organizations/o1/invitations", { email: "a@x.test", role: "admin" }))!.status).toBe(403);
    expect((await call(world({ myRole: "admin" }).deps, "POST", "/api/v1/organizations/o1/invitations", { email: "a@x.test" }))!.status).toBe(201);
    expect((await call(world({ myRole: "member" }).deps, "POST", "/api/v1/organizations/o1/invitations", { email: "a@x.test" }))!.status).toBe(403);
    expect((await call(world({ myRole: null }).deps, "POST", "/api/v1/organizations/o1/invitations", { email: "a@x.test" }))!.status).toBe(404);
    expect((await call(world({ memberAlready: true }).deps, "POST", "/api/v1/organizations/o1/invitations", { email: "a@x.test" }))!.status).toBe(409);
    expect((await call(world().deps, "POST", "/api/v1/organizations/o1/invitations", { email: "bad" }))!.status).toBe(422);
  });
});

describe("accepting", () => {
  it("requires a valid, pending, unexpired link and the matching email", async () => {
    expect((await call(world({ user: "u2", email: "other@x.test" }).deps, "POST", "/api/v1/organization-invitations/accept", { token: TOKEN }))!.status).toBe(403);
    expect((await call(world({ user: "u2", email: "new@x.test", inviteStatus: "revoked" }).deps, "POST", "/api/v1/organization-invitations/accept", { token: TOKEN }))!.status).toBe(404);
    expect((await call(world({ user: "u2", email: "new@x.test", inviteExpires: new Date("2026-11-01T00:00:00Z") }).deps, "POST", "/api/v1/organization-invitations/accept", { token: TOKEN }))!.status).toBe(404);
    expect((await call(world({ user: "u2", email: "new@x.test" }).deps, "POST", "/api/v1/organization-invitations/accept", { token: "short" }))!.status).toBe(404);
    const w = world({ user: "u2", email: "NEW@x.test" });
    expect((await call(w.deps, "POST", "/api/v1/organization-invitations/accept", { token: TOKEN }))!.status).toBe(200);
    const insert = w.fake.queries.find((q) => q.text.startsWith("INSERT INTO organization_memberships"))!;
    expect(insert.inTransaction).toBe(true);
    expect(insert.values).toContain("member");
    expect(w.fake.queries.some((q) => q.text.startsWith("INSERT INTO user_roles") && q.values.includes("client"))).toBe(true);
  });

  it("refuses a full team without consuming the invitation", async () => {
    const res = await call(world({ user: "u2", email: "new@x.test", memberCount: 50 }).deps, "POST", "/api/v1/organization-invitations/accept", { token: TOKEN });
    expect((await readJson(res!)).error!.code).toBe("TEAM_FULL");
  });

  it("shows in-app invitations only for a verified email", async () => {
    const unverified = await readJson((await call(world({ user: "u2", email: "new@x.test" }).deps, "GET", "/api/v1/me/organization-invitations"))!);
    expect(unverified.data.items).toEqual([]);
    expect((await call(world({ user: "u2", email: "new@x.test" }).deps, "POST", "/api/v1/organization-invitations/I1/accept", {}))!.status).toBe(404);
    expect((await call(world({ user: "u2", email: "new@x.test", verified: true }).deps, "POST", "/api/v1/organization-invitations/I1/decline", {}))!.status).toBe(200);
  });
});

describe("team management", () => {
  it("enforces who can change roles, remove and leave", async () => {
    expect((await call(world({ myRole: "admin" }).deps, "POST", "/api/v1/organizations/o1/members/u2/role", { role: "admin" }))!.status).toBe(403);
    expect((await call(world().deps, "POST", "/api/v1/organizations/o1/members/u2/role", { role: "admin" }))!.status).toBe(200);
    expect((await call(world({ targetRole: "owner" }).deps, "POST", "/api/v1/organizations/o1/members/u2/role", { role: "member" }))!.status).toBe(403);
    expect((await call(world({ myRole: "admin", targetRole: "admin" }).deps, "POST", "/api/v1/organizations/o1/members/u3/remove", {}))!.status).toBe(403);
    expect((await call(world({ myRole: "admin", targetRole: "member" }).deps, "POST", "/api/v1/organizations/o1/members/u3/remove", {}))!.status).toBe(200);
    expect((await call(world({ user: "u3", myRole: "member", targetRole: "member" }).deps, "POST", "/api/v1/organizations/o1/members/u3/remove", {}))!.status).toBe(200);
    expect((await call(world({ targetRole: "owner" }).deps, "POST", "/api/v1/organizations/o1/members/c1/remove", {}))!.status).toBe(403);
  });

  it("transfers ownership in one transaction and makes the old owner an admin", async () => {
    const w = world();
    expect((await call(w.deps, "POST", "/api/v1/organizations/o1/transfer-ownership", { user_id: "u2" }))!.status).toBe(200);
    const demote = w.fake.queries.find((q) => q.text.startsWith("UPDATE organization_memberships SET role = 'admin'"))!;
    const promote = w.fake.queries.find((q) => q.text.startsWith("UPDATE organization_memberships SET role = 'owner'"))!;
    expect(demote.inTransaction && promote.inTransaction).toBe(true);
    expect((await call(world({ myRole: "admin" }).deps, "POST", "/api/v1/organizations/o1/transfer-ownership", { user_id: "u2" }))!.status).toBe(403);
    expect((await call(world({ targetRole: null }).deps, "POST", "/api/v1/organizations/o1/transfer-ownership", { user_id: "u9" }))!.status).toBe(404);
  });
});
