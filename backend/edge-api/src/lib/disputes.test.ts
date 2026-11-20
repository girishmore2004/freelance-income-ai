import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import { handleDisputeRoute, validateDispute } from "./dispute-routes";
import type { DisputeRouteDeps } from "./dispute-routes";
import { suspensionBlocks } from "./auth-context";
import { createFakeSql, jsonRequest, readJson } from "./test-support";
import type { AuthenticatedSession } from "./session-service";

function session(userId: string): AuthenticatedSession {
  return { user: { id: userId, email: `${userId}@x.test`, email_verified: true, mfa_enabled: false }, claims: { sub: userId, jti: "j", iat: 0, exp: 0 } };
}

const LONG = "The delivered site is missing the checkout page we agreed on.";

interface World {
  user?: string;
  roles?: string[];
  targetRoles?: string[];
  memberRole?: string | null;
  contractStatus?: string;
  disputeStatus?: string;
  disputeResolution?: string | null;
  openedBy?: string;
  inserted?: boolean;
  suspensionCreatedBy?: string;
  appealStatus?: string;
  statements?: number;
  /** Age of the dispute in days (U29 reply window); default 0 = opened just now. */
  ageDays?: number;
  /** The other side has answered (a statement by the party that did not open it). */
  replied?: boolean;
}

function world(o: World = {}) {
  const user = o.user ?? "c1";
  const dispute = () => ({
    id: "D1", contract_id: "K1", opened_by_party: o.openedBy ?? "client", opened_by: "c1", reason: "quality", description: LONG, desired_outcome: "",
    status: o.disputeStatus ?? "open", resolution: o.disputeResolution ?? null, resolution_note: "", resolved_by: null, resolved_at: null, created_at: new Date(Date.now() - (o.ageDays ?? 0) * 864e5)
  });
  const fake = createFakeSql((text, values) => {
    if (text.startsWith("SELECT enabled FROM feature_flags")) return [{ enabled: true }];
    if (text.startsWith("SELECT role, status FROM user_roles")) {
      const who = String(values[0]);
      return (who === user ? o.roles ?? [] : o.targetRoles ?? []).map((role) => ({ role, status: "active" }));
    }
    if (text.startsWith("SELECT * FROM contracts")) return [{ id: "K1", organization_id: "o1", freelancer_user_id: "f1", status: o.contractStatus ?? "active", current_version: 1, agreed_version: 1 }];
    if (text.includes("FROM organization_memberships m JOIN organizations o") || text.includes("FROM organization_memberships m\n    JOIN organizations o")) {
      return o.memberRole === null ? [] : [{ id: "o1", membership_role: o.memberRole ?? "owner" }];
    }
    if (text.startsWith("SELECT * FROM disputes WHERE id") || text.startsWith("SELECT * FROM disputes WHERE contract_id")) return o.disputeStatus === "none" ? [] : [dispute()];
    if (text.startsWith("INSERT INTO disputes")) return o.inserted === false ? [] : [dispute()];
    if (text.startsWith("UPDATE disputes SET status = 'resolved'")) return [{ ...dispute(), status: "resolved", resolution: values[0] }];
    if (text.startsWith("UPDATE disputes SET status = 'withdrawn'")) return [{ id: "D1" }];
    if (text.startsWith("SELECT count(*)::int AS n FROM dispute_statements")) return [{ n: o.statements ?? 0 }];
    if (text.startsWith("SELECT * FROM dispute_statements WHERE dispute_id")) {
      return o.replied ? [{ id: "S9", dispute_id: "D1", party: (o.openedBy ?? "client") === "client" ? "freelancer" : "client", author_user_id: "f1", body: "Our side of it.", created_at: new Date() }] : [];
    }
    if (text.startsWith("INSERT INTO dispute_statements")) return [{ id: "S1", party: values[2], body: values[4], created_at: new Date() }];
    if (text.startsWith("SELECT DISTINCT milestone_index FROM payment_intents")) return [];
    if (text.startsWith("UPDATE contracts SET status")) return [{ id: "K1" }];
    if (text.startsWith("SELECT id FROM users")) return [{ id: "f1" }];
    if (text.startsWith("INSERT INTO account_suspensions")) return [{ id: "AS1", user_id: "f1", reason: values[2], status: "active", created_by: user, created_at: new Date(), lift_note: "", appeal_text: "", appeal_status: "none" }];
    if (text.startsWith("SELECT * FROM account_suspensions WHERE id")) {
      return [{ id: "AS1", user_id: "f1", reason: "r", status: "active", created_by: o.suspensionCreatedBy ?? "admin2", created_at: new Date(), lift_note: "", appeal_text: "x", appeal_status: o.appealStatus ?? "pending" }];
    }
    if (text.startsWith("UPDATE account_suspensions")) return [{ id: "AS1", user_id: "f1", reason: "r", status: "active", created_at: new Date(), lift_note: "", appeal_text: "t", appeal_status: "pending" }];
    return [];
  });
  const deps: DisputeRouteDeps = { database: () => fake.sql, authenticate: async () => session(user) };
  return { fake, deps };
}

const env = {} as Env;
const call = (deps: DisputeRouteDeps, method: string, path: string, payload?: unknown) => handleDisputeRoute(jsonRequest(method, path, payload), env, "r", deps);

describe("dispute validation", () => {
  it("requires a reason and a real description, and screens off-platform details", () => {
    expect(validateDispute({ reason: "quality", description: LONG }).ok).toBe(true);
    expect(validateDispute({ reason: "anger", description: LONG }).ok).toBe(false);
    expect(validateDispute({ reason: "quality", description: "bad" }).ok).toBe(false);
    expect(validateDispute({ reason: "quality", description: `${LONG} Pay me directly at someone@example.com instead.` }).ok).toBe(false);
  });
});

describe("parties", () => {
  it("lets either side open one dispute on an active contract and records an event", async () => {
    const w = world({ disputeStatus: "none" });
    const res = await call(w.deps, "POST", "/api/v1/contracts/K1/dispute", { reason: "quality", description: LONG });
    expect(res!.status).toBe(201);
    expect(w.fake.queries.some((q) => q.text.startsWith("INSERT INTO contract_events") && q.values.includes("dispute.opened"))).toBe(true);
    expect((await readJson((await call(world({ inserted: false }).deps, "POST", "/api/v1/contracts/K1/dispute", { reason: "quality", description: LONG }))!)).error!.code).toBe("ALREADY_OPEN");
    expect((await call(world({ contractStatus: "completed" }).deps, "POST", "/api/v1/contracts/K1/dispute", { reason: "quality", description: LONG }))!.status).toBe(409);
    expect((await call(world({ user: "f1", memberRole: null, disputeStatus: "none" }).deps, "POST", "/api/v1/contracts/K1/dispute", { reason: "payment", description: LONG }))!.status).toBe(201);
  });

  it("hides disputes from outsiders and blocks client members who cannot manage", async () => {
    expect((await call(world({ user: "x", memberRole: null }).deps, "GET", "/api/v1/contracts/K1/dispute"))!.status).toBe(404);
    expect((await call(world({ user: "x", memberRole: null }).deps, "POST", "/api/v1/disputes/D1/statements", { body: "hello there" }))!.status).toBe(404);
    expect((await call(world({ memberRole: "member" }).deps, "POST", "/api/v1/disputes/D1/statements", { body: "hello there" }))!.status).toBe(403);
  });

  it("adds statements while open, with a cap, and only the opener withdraws", async () => {
    expect((await call(world({ user: "f1", memberRole: null }).deps, "POST", "/api/v1/disputes/D1/statements", { body: "Delivered on time; see submission." }))!.status).toBe(201);
    expect((await call(world({ statements: 20 }).deps, "POST", "/api/v1/disputes/D1/statements", { body: "More detail here" }))!.status).toBe(429);
    expect((await call(world({ disputeStatus: "resolved" }).deps, "POST", "/api/v1/disputes/D1/statements", { body: "More detail here" }))!.status).toBe(409);
    expect((await call(world({ user: "f1", memberRole: null }).deps, "POST", "/api/v1/disputes/D1/withdraw", {}))!.status).toBe(403);
    expect((await call(world().deps, "POST", "/api/v1/disputes/D1/withdraw", {}))!.status).toBe(200);
  });
});

describe("staff decisions", () => {
  it("hides staff endpoints from non-staff", async () => {
    for (const [m, p] of [["GET", "/api/v1/admin/disputes"], ["GET", "/api/v1/admin/disputes/D1"], ["POST", "/api/v1/admin/disputes/D1/resolve"], ["POST", "/api/v1/admin/users/f1/suspend"], ["GET", "/api/v1/admin/suspensions"]]) {
      expect((await call(world().deps, m, p, m === "POST" ? {} : undefined))!.status).toBe(404);
    }
  });

  it("returns an evidence pack without any model involvement", async () => {
    const w = world({ user: "mod1", roles: ["moderator"] });
    const body = await readJson((await call(w.deps, "GET", "/api/v1/admin/disputes/D1"))!);
    expect(body.data.evidence.summary).toBeDefined();
    expect(body.data.can_move_money).toBe(false);
    expect(w.fake.queries.some((q) => q.text.includes("ai_usage_events"))).toBe(false);
  });

  // The dispute is 8 days old here: staff may decide (U29 reply window, D-29; changed on purpose 2026-11-20).
  it("requires an admin for outcomes that move money and logs the decision in the same transaction", async () => {
    const mod = world({ user: "mod1", roles: ["moderator"], ageDays: 8 });
    expect((await call(mod.deps, "POST", "/api/v1/admin/disputes/D1/resolve", { resolution: "release_funded", note: "Work matches the agreed terms." }))!.status).toBe(403);
    expect((await call(mod.deps, "POST", "/api/v1/admin/disputes/D1/resolve", { resolution: "no_action", note: "short" }))!.status).toBe(422);
    expect((await call(mod.deps, "POST", "/api/v1/admin/disputes/D1/resolve", { resolution: "no_action", note: "Both sides should continue as agreed." }))!.status).toBe(200);
    const admin = world({ user: "admin1", roles: ["admin"], ageDays: 8 });
    expect((await call(admin.deps, "POST", "/api/v1/admin/disputes/D1/resolve", { resolution: "release_funded", note: "Work matches the agreed terms." }))!.status).toBe(200);
    const log = admin.fake.queries.find((q) => q.text.startsWith("INSERT INTO moderation_actions"))!;
    expect(log.inTransaction).toBe(true);
    expect(log.values).toContain("dispute.release_funded");
    expect(admin.fake.queries.some((q) => q.text.startsWith("UPDATE contracts SET status = 'completed'"))).toBe(true);
  });

  it("waits for the other side's answer for 7 days, then lets staff decide (D-29)", async () => {
    const early = world({ user: "admin1", roles: ["admin"], ageDays: 2 });
    const r = await call(early.deps, "POST", "/api/v1/admin/disputes/D1/resolve", { resolution: "no_action", note: "Both sides should continue as agreed." });
    expect(r!.status).toBe(409);
    expect((await readJson(r!)).error!.code).toBe("WAITING_FOR_REPLY");
    expect(early.fake.queries.some((q) => q.text.startsWith("UPDATE disputes SET status = 'resolved'"))).toBe(false);
    expect((await call(world({ user: "admin1", roles: ["admin"], ageDays: 2, replied: true }).deps, "POST", "/api/v1/admin/disputes/D1/resolve", { resolution: "no_action", note: "Both sides should continue as agreed." }))!.status).toBe(200);
    expect((await call(world({ user: "admin1", roles: ["admin"], ageDays: 7.1 }).deps, "POST", "/api/v1/admin/disputes/D1/resolve", { resolution: "no_action", note: "Both sides should continue as agreed." }))!.status).toBe(200);
  });

  it("re-runs the same decision idempotently and refuses a different one", async () => {
    const same = world({ user: "admin1", roles: ["admin"], disputeStatus: "resolved", disputeResolution: "refund_funded" });
    expect((await call(same.deps, "POST", "/api/v1/admin/disputes/D1/resolve", { resolution: "refund_funded", note: "Retrying the refund decision." }))!.status).toBe(200);
    expect(same.fake.queries.some((q) => q.text.startsWith("INSERT INTO moderation_actions"))).toBe(false);
    expect((await call(world({ user: "admin1", roles: ["admin"], disputeStatus: "resolved", disputeResolution: "refund_funded" }).deps, "POST", "/api/v1/admin/disputes/D1/resolve", { resolution: "release_funded", note: "Changing my mind on this." }))!.status).toBe(409);
  });
});

describe("suspensions and appeals", () => {
  it("suspends a non-staff user, hides them from discovery and notifies them", async () => {
    const w = world({ user: "mod1", roles: ["moderator"] });
    expect((await call(w.deps, "POST", "/api/v1/admin/users/f1/suspend", { reason: "Repeated off-platform payment requests." }))!.status).toBe(201);
    expect(w.fake.queries.some((q) => q.text.startsWith("UPDATE profiles SET marketplace_visible = false") && q.inTransaction)).toBe(true);
    expect(w.fake.queries.some((q) => q.text.startsWith("INSERT INTO notifications"))).toBe(true);
    expect((await call(world({ user: "mod1", roles: ["moderator"], targetRoles: ["admin"] }).deps, "POST", "/api/v1/admin/users/f1/suspend", { reason: "Repeated off-platform payment requests." }))!.status).toBe(403);
    expect((await call(world({ user: "mod1", roles: ["moderator"] }).deps, "POST", "/api/v1/admin/users/mod1/suspend", { reason: "Repeated off-platform payment requests." }))!.status).toBe(403);
  });

  it("needs a second staff member to decide an appeal", async () => {
    const own = world({ user: "admin1", roles: ["admin"], suspensionCreatedBy: "admin1" });
    expect((await readJson((await call(own.deps, "POST", "/api/v1/admin/suspensions/AS1/appeal", { decision: "overturn", note: "Evidence was mistaken." }))!)).error!.code).toBe("SECOND_REVIEWER_REQUIRED");
    expect((await call(own.deps, "POST", "/api/v1/admin/suspensions/AS1/lift", { note: "Evidence was mistaken." }))!.status).toBe(200);
    const other = world({ user: "admin1", roles: ["admin"] });
    expect((await call(other.deps, "POST", "/api/v1/admin/suspensions/AS1/appeal", { decision: "overturn", note: "Evidence was mistaken." }))!.status).toBe(200);
    expect(other.fake.queries.some((q) => q.text.startsWith("UPDATE users SET suspended_at = NULL"))).toBe(true);
    expect((await call(world({ user: "admin1", roles: ["admin"], appealStatus: "none" }).deps, "POST", "/api/v1/admin/suspensions/AS1/appeal", { decision: "uphold", note: "Evidence stands." }))!.status).toBe(409);
  });

  it("lets the suspended person appeal once", async () => {
    const w = world({ user: "f1" });
    expect((await call(w.deps, "POST", "/api/v1/me/suspension/appeal", { text: "too short" }))!.status).toBe(422);
    expect((await call(w.deps, "POST", "/api/v1/me/suspension/appeal", { text: "I shared a portfolio link, not a payment request. Please review." }))!.status).toBe(201);
  });

  it("blocks every write except sign-out, password, notifications and the appeal", () => {
    expect(suspensionBlocks("GET", "/api/v1/contracts")).toBe(false);
    expect(suspensionBlocks("POST", "/api/v1/me/suspension/appeal")).toBe(false);
    expect(suspensionBlocks("POST", "/api/v1/auth/logout")).toBe(false);
    expect(suspensionBlocks("POST", "/api/v1/listings/L1/proposals")).toBe(true);
    expect(suspensionBlocks("POST", "/api/v1/me/payouts")).toBe(true);
    expect(suspensionBlocks("PATCH", "/api/v1/me/marketplace-profile")).toBe(true);
  });
});
