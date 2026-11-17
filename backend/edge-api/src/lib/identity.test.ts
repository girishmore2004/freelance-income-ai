import { describe, expect, it, vi } from "vitest";
import type { Env, RateLimiterBinding } from "../types";
import { activateRole, deactivateRole, loadRoles, organizationOut, validateOrganization } from "./identity";
import type { OrganizationRow } from "./identity";
import { handleIdentityRoute } from "./identity-routes";
import type { IdentityRouteDeps } from "./identity-routes";
import { enforceRateLimit, rateKey } from "./rate-limit";
import { createFakeSql, jsonRequest, readJson } from "./test-support";
import type { AuthenticatedSession } from "./session-service";

function session(userId = "u1"): AuthenticatedSession {
  return { user: { id: userId, email: `${userId}@x.test`, email_verified: true, mfa_enabled: false }, claims: { sub: userId, jti: "j", iat: 0, exp: 0 } };
}

const ORG: OrganizationRow = {
  id: "o1", name: "Acme", kind: "company", industry: "Software", website: "https://acme.example", country: "IN",
  preferred_language: "en", billing_name: "Acme Pvt Ltd", billing_email: "billing@acme.example", billing_address: "Pune",
  tax_id: "27ABCDE1234F1Z5", status: "active", created_at: new Date("2026-11-17T00:00:00Z"), updated_at: new Date("2026-11-17T00:00:00Z"),
  membership_role: "owner"
};

/** Scripted database: role rows, the client-side flag, and organisation memberships. */
function world(opts: { roles?: { role: string; status: string }[]; flag?: boolean; membership?: string | null; ownedCount?: number } = {}) {
  const roles = opts.roles ?? [{ role: "freelancer", status: "active" }];
  return createFakeSql((text, values) => {
    if (text.startsWith("SELECT enabled FROM feature_flags")) return [{ enabled: opts.flag ?? false }];
    if (text.startsWith("SELECT role, status FROM user_roles WHERE user_id = $ AND role")) return roles.filter((r) => r.role === values[1]);
    if (text.startsWith("SELECT role, status FROM user_roles")) return roles;
    if (text.startsWith("SELECT 1 FROM user_roles")) return roles.length ? [{ "?column?": 1 }] : [];
    if (text.startsWith("INSERT INTO user_roles")) {
      const role = String(values[2]);
      const existing = roles.find((r) => r.role === role);
      if (existing) {
        if (existing.status === "inactive") existing.status = "active";
      } else roles.push({ role, status: "active" });
      return [];
    }
    if (text.startsWith("UPDATE user_roles SET status = 'inactive'")) {
      const r = roles.find((x) => x.role === values[1] && x.status === "active");
      if (r) r.status = "inactive";
      return [];
    }
    if (text.startsWith("SELECT count(*) AS c FROM organization_memberships")) return [{ c: String(opts.ownedCount ?? 0) }];
    if (text.includes("FROM organization_memberships m JOIN organizations o") && text.includes("m.organization_id = $")) {
      return opts.membership ? [{ ...ORG, membership_role: opts.membership }] : [];
    }
    if (text.includes("FROM organization_memberships m JOIN organizations o")) return opts.membership ? [{ ...ORG, membership_role: opts.membership }] : [];
    if (text.includes("FROM organization_memberships m JOIN users u")) return [{ user_id: "u1", email: "u1@x.test", role: "owner", created_at: new Date("2026-11-17T00:00:00Z") }];
    return [];
  });
}

function deps(fake: ReturnType<typeof world>, userId = "u1"): IdentityRouteDeps {
  return { database: () => fake.sql, authenticate: async () => session(userId) };
}

const env = {} as Env;

describe("roles", () => {
  it("treats legacy accounts without role rows as freelancers", async () => {
    expect(await loadRoles(world({ roles: [] }).sql, "u1")).toEqual(["freelancer"]);
  });

  it("activates the client role idempotently and keeps both roles", async () => {
    const fake = world();
    expect(await activateRole(fake.sql, "u1", "client")).toEqual({ ok: true, roles: ["client", "freelancer"] });
    expect(await activateRole(fake.sql, "u1", "client")).toEqual({ ok: true, roles: ["client", "freelancer"] });
  });

  it("never grants internal roles and never self-reactivates a suspended role", async () => {
    expect(await activateRole(world().sql, "u1", "admin")).toMatchObject({ ok: false, code: "ROLE_NOT_ALLOWED" });
    const suspended = world({ roles: [{ role: "freelancer", status: "active" }, { role: "client", status: "suspended" }] });
    expect(await activateRole(suspended.sql, "u1", "client")).toMatchObject({ ok: false, code: "ROLE_SUSPENDED" });
  });

  it("keeps at least one public role", async () => {
    expect(await deactivateRole(world().sql, "u1", "freelancer")).toMatchObject({ ok: false, code: "LAST_PUBLIC_ROLE" });
    const both = world({ roles: [{ role: "freelancer", status: "active" }, { role: "client", status: "active" }] });
    expect(await deactivateRole(both.sql, "u1", "freelancer")).toEqual({ ok: true, roles: ["client"] });
  });
});

describe("organisation validation", () => {
  it("accepts a complete company and normalises fields", () => {
    const result = validateOrganization({ name: " Acme ", kind: "company", country: "in", tax_id: "27abcde1234f1z5", billing_email: "Billing@Acme.example", website: "https://acme.example" }, false);
    expect(result).toEqual({ ok: true, value: { name: "Acme", kind: "company", country: "IN", tax_id: "27ABCDE1234F1Z5", billing_email: "billing@acme.example", website: "https://acme.example" } });
  });

  it("reports every invalid field", () => {
    const result = validateOrganization({ name: "A", kind: "government", country: "India", website: "http://x", billing_email: "nope", tax_id: "<script>" }, false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["billing_email", "country", "kind", "name", "tax_id", "website"]);
  });

  it("validates only provided fields on update", () => {
    expect(validateOrganization({ industry: "Retail" }, true)).toEqual({ ok: true, value: { industry: "Retail" } });
  });

  it("shows billing details to owners and admins only", () => {
    expect(organizationOut(ORG)).toHaveProperty("billing");
    expect(organizationOut({ ...ORG, membership_role: "member" })).not.toHaveProperty("billing");
  });
});

describe("identity routes", () => {
  it("returns roles, organisations and the client-side flag", async () => {
    const fake = world({ membership: "owner" });
    const response = await handleIdentityRoute(jsonRequest("GET", "/api/v1/me/identity"), env, "r", deps(fake));
    const body = await readJson(response!);
    expect(body.data.roles).toEqual(["freelancer"]);
    expect(body.data.organizations).toHaveLength(1);
    expect(body.data.client_side_enabled).toBe(false);
  });

  it("keeps the client side closed while the flag is off", async () => {
    const fake = world({ flag: false });
    const activate = await handleIdentityRoute(jsonRequest("POST", "/api/v1/me/roles", { role: "client" }), env, "r", deps(fake));
    expect(activate!.status).toBe(403);
    expect((await readJson(activate!)).error?.code).toBe("FEATURE_DISABLED");
    const create = await handleIdentityRoute(jsonRequest("POST", "/api/v1/organizations", { name: "Acme" }), env, "r", deps(fake));
    expect(create!.status).toBe(403);
    expect(fake.queries.some((q) => q.text.startsWith("INSERT"))).toBe(false);
  });

  it("requires the client role before creating an organisation", async () => {
    const response = await handleIdentityRoute(jsonRequest("POST", "/api/v1/organizations", { name: "Acme" }), env, "r", deps(world({ flag: true })));
    expect(response!.status).toBe(403);
    expect((await readJson(response!)).error?.code).toBe("CLIENT_ROLE_REQUIRED");
  });

  it("creates the organisation and owner membership in one transaction", async () => {
    const fake = world({ flag: true, roles: [{ role: "freelancer", status: "active" }, { role: "client", status: "active" }], membership: "owner" });
    const response = await handleIdentityRoute(jsonRequest("POST", "/api/v1/organizations", { name: "Acme", kind: "company" }), env, "r", deps(fake));
    expect(response!.status).toBe(201);
    const inserts = fake.queries.filter((q) => q.text.startsWith("INSERT INTO organization"));
    expect(inserts).toHaveLength(2);
    expect(inserts.every((q) => q.inTransaction)).toBe(true);
    expect(inserts[1].values).toContain("u1");
    expect(fake.commits).toBe(1);
  });

  it("caps organisations per owner", async () => {
    const fake = world({ flag: true, roles: [{ role: "client", status: "active" }], ownedCount: 5 });
    const response = await handleIdentityRoute(jsonRequest("POST", "/api/v1/organizations", { name: "Sixth" }), env, "r", deps(fake));
    expect(response!.status).toBe(409);
  });

  it("returns 404 to non-members (no existence leak) for read, members and edit", async () => {
    const fake = world({ membership: null });
    for (const [method, path] of [["GET", "/api/v1/organizations/o1"], ["GET", "/api/v1/organizations/o1/members"], ["PATCH", "/api/v1/organizations/o1"]] as const) {
      const response = await handleIdentityRoute(jsonRequest(method, path, method === "PATCH" ? { name: "Hijack" } : undefined), env, "r", deps(fake, "intruder"));
      expect(response!.status).toBe(404);
    }
    expect(fake.queries.some((q) => q.text.startsWith("UPDATE organizations"))).toBe(false);
    const lookup = fake.queries.find((q) => q.text.includes("m.organization_id = $"));
    expect(lookup?.values).toEqual(["intruder", "o1"]);
  });

  it("lets members read but only owners/admins edit", async () => {
    const member = world({ membership: "member" });
    const read = await handleIdentityRoute(jsonRequest("GET", "/api/v1/organizations/o1"), env, "r", deps(member));
    expect(read!.status).toBe(200);
    expect((await readJson(read!)).data).not.toHaveProperty("billing");
    const edit = await handleIdentityRoute(jsonRequest("PATCH", "/api/v1/organizations/o1", { name: "New" }), env, "r", deps(member));
    expect(edit!.status).toBe(403);

    const owner = world({ membership: "owner" });
    const ok = await handleIdentityRoute(jsonRequest("PATCH", "/api/v1/organizations/o1", { industry: "Retail" }), env, "r", deps(owner));
    expect(ok!.status).toBe(200);
    expect(owner.queries.some((q) => q.text.startsWith("UPDATE organizations"))).toBe(true);
  });

  it("ignores unrelated paths", async () => {
    expect(await handleIdentityRoute(jsonRequest("GET", "/api/v1/profile"), env, "r", deps(world()))).toBeNull();
  });
});

describe("rate limiting", () => {
  function limiter(success: boolean) {
    const calls: string[] = [];
    const binding: RateLimiterBinding = { limit: vi.fn(async ({ key }: { key: string }) => { calls.push(key); return { success }; }) };
    return { binding, calls };
  }

  it("keys anonymous auth calls by endpoint and IP, and signed-in calls by session hash", async () => {
    const login = jsonRequest("POST", "/api/v1/auth/login", {}, { "CF-Connecting-IP": "203.0.113.9" });
    expect(await rateKey(login, env)).toEqual({ limiter: "auth", key: "auth:login:203.0.113.9" });
    const api = await rateKey(jsonRequest("GET", "/api/v1/profile", undefined, { Authorization: "Bearer secret-token" }), env);
    expect(api.limiter).toBe("api");
    expect(api.key).toMatch(/^user:[0-9a-f]{24}$/);
    expect(api.key).not.toContain("secret-token");
    expect((await rateKey(jsonRequest("GET", "/health"), env)).limiter).toBeNull();
  });

  it("returns 429 with Retry-After when over the limit", async () => {
    const { binding } = limiter(false);
    const response = await enforceRateLimit(jsonRequest("POST", "/api/v1/auth/login", {}), { AUTH_RATE_LIMITER: binding } as Env, "r");
    expect(response!.status).toBe(429);
    expect(response!.headers.get("Retry-After")).toBe("60");
    expect((await readJson(response!)).error?.code).toBe("RATE_LIMITED");
  });

  it("allows requests under the limit, without a binding, or if the limiter fails", async () => {
    expect(await enforceRateLimit(jsonRequest("GET", "/api/v1/profile"), { API_RATE_LIMITER: limiter(true).binding } as Env, "r")).toBeNull();
    expect(await enforceRateLimit(jsonRequest("GET", "/api/v1/profile"), env, "r")).toBeNull();
    const broken: RateLimiterBinding = { limit: async () => { throw new Error("down"); } };
    expect(await enforceRateLimit(jsonRequest("GET", "/api/v1/profile"), { API_RATE_LIMITER: broken } as Env, "r")).toBeNull();
  });
});
