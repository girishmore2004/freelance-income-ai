import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import { handleTrustRoute } from "./trust-routes";
import type { TrustRouteDeps } from "./trust-routes";
import { createFakeSql, jsonRequest, readJson } from "./test-support";
import type { AuthenticatedSession } from "./session-service";

function session(userId: string): AuthenticatedSession {
  return { user: { id: userId, email: `${userId}@x.test`, email_verified: true, mfa_enabled: false }, claims: { sub: userId, jti: "j", iat: 0, exp: 0 } };
}

function world(opts: { roles?: string[]; user?: string; inserted?: boolean; openCount?: number; inReview?: boolean; reportStatus?: string; reportTarget?: string; ownListing?: boolean } = {}) {
  const fake = createFakeSql((text) => {
    if (text.startsWith("SELECT role, status FROM user_roles")) return (opts.roles ?? ["freelancer"]).map((role) => ({ role, status: "active" }));
    if (text.startsWith("SELECT l.id, EXISTS")) return [{ id: "X", own: opts.ownListing ?? false }];
    if (text.startsWith("SELECT id FROM users")) return [{ id: "X" }];
    if (text.startsWith("SELECT count(*)::int AS n FROM reports")) return [{ n: opts.openCount ?? 0 }];
    if (text.startsWith("INSERT INTO reports")) return opts.inserted === false ? [] : [{ id: "R1", target_type: "listing", target_id: "L1", reason: "scam", details: "", status: "open", resolution_note: "", resolved_at: null, created_at: new Date(), reporter_user_id: "u1" }];
    if (text.startsWith("UPDATE project_listings SET status = 'published'") || text.startsWith("UPDATE project_listings SET status = 'draft'")) return opts.inReview === false ? [] : [{ id: "L1" }];
    if (text.startsWith("SELECT * FROM reports WHERE id")) return [{ id: "R1", status: opts.reportStatus ?? "open", target_type: opts.reportTarget ?? "listing", target_id: "L1", reason: "scam" }];
    if (text.startsWith("UPDATE project_listings SET status = 'in_review'")) return [{ id: "L1" }];
    if (text.startsWith("UPDATE feature_flags")) return [{ key: "marketplace.client_side", enabled: true }];
    return [];
  });
  const deps: TrustRouteDeps = { database: () => fake.sql, authenticate: async () => session(opts.user ?? "u1") };
  return { fake, deps };
}

const env = {} as Env;
const call = (deps: TrustRouteDeps, method: string, path: string, payload?: unknown) => handleTrustRoute(jsonRequest(method, path, payload), env, "r", deps);

describe("reports", () => {
  it("validates, de-duplicates open reports and limits volume", async () => {
    expect((await call(world().deps, "POST", "/api/v1/reports", { target_type: "listing", target_id: "L1", reason: "scam" }))!.status).toBe(201);
    expect((await readJson((await call(world({ inserted: false }).deps, "POST", "/api/v1/reports", { target_type: "listing", target_id: "L1", reason: "scam" }))!)).error!.code).toBe("ALREADY_REPORTED");
    expect((await call(world({ openCount: 20 }).deps, "POST", "/api/v1/reports", { target_type: "listing", target_id: "L1", reason: "scam" }))!.status).toBe(429);
    expect((await call(world().deps, "POST", "/api/v1/reports", { target_type: "planet", target_id: "L1", reason: "x" }))!.status).toBe(422);
    expect((await call(world().deps, "POST", "/api/v1/reports", { target_type: "user", target_id: "u1", reason: "spam" }))!.status).toBe(422);
    // A project of the reporter's own client account cannot be reported (found by the end-to-end catalogue, 2026-11-20).
    expect((await call(world({ ownListing: true }).deps, "POST", "/api/v1/reports", { target_type: "listing", target_id: "L1", reason: "spam" }))!.status).toBe(422);
  });
});

describe("staff moderation", () => {
  it("hides staff endpoints from users", async () => {
    for (const [method, path] of [["GET", "/api/v1/admin/moderation/listings"], ["GET", "/api/v1/admin/reports"], ["GET", "/api/v1/admin/overview"], ["POST", "/api/v1/admin/reports/R1"]]) {
      expect((await call(world().deps, method, path, method === "POST" ? {} : undefined))!.status).toBe(404);
    }
  });

  it("approves or returns held listings with a logged reason, in one transaction", async () => {
    const back = world({ roles: ["moderator"] });
    expect((await call(back.deps, "POST", "/api/v1/admin/moderation/listings/L1", { decision: "return", note: "no" }))!.status).toBe(422);
    expect((await call(back.deps, "POST", "/api/v1/admin/moderation/listings/L1", { decision: "return", note: "Remove the fee request" }))!.status).toBe(200);
    const log = back.fake.queries.find((q) => q.text.startsWith("INSERT INTO moderation_actions"))!;
    expect(log.inTransaction).toBe(true);
    expect(log.values).toContain("listing.returned");
    expect((await call(world({ roles: ["moderator"], inReview: false }).deps, "POST", "/api/v1/admin/moderation/listings/L1", { decision: "approve" }))!.status).toBe(409);
  });

  it("actions a report and can hide the listing pending review, never delete it", async () => {
    const w = world({ roles: ["moderator"] });
    const response = await call(w.deps, "POST", "/api/v1/admin/reports/R1", { decision: "action", note: "Confirmed scam", hide_listing: true });
    expect((await readJson(response!)).data.listing_hidden).toBe(true);
    expect(w.fake.queries.some((q) => q.text.startsWith("DELETE"))).toBe(false);
    expect(w.fake.queries.filter((q) => q.text.startsWith("INSERT INTO moderation_actions"))).toHaveLength(2);
    expect((await call(world({ roles: ["moderator"], reportStatus: "dismissed" }).deps, "POST", "/api/v1/admin/reports/R1", { decision: "dismiss", note: "Duplicate report" }))!.status).toBe(409);
  });

  it("lets only admins change flags and never payments.live", async () => {
    expect((await call(world({ roles: ["moderator"] }).deps, "POST", "/api/v1/admin/flags/marketplace.client_side", { enabled: true }))!.status).toBe(403);
    const locked = await call(world({ roles: ["admin"] }).deps, "POST", "/api/v1/admin/flags/payments.live", { enabled: true });
    expect((await readJson(locked!)).error!.code).toBe("FLAG_LOCKED");
    const admin = world({ roles: ["admin"] });
    expect((await call(admin.deps, "POST", "/api/v1/admin/flags/marketplace.client_side", { enabled: true }))!.status).toBe(200);
    expect(admin.fake.queries.some((q) => q.text.startsWith("INSERT INTO moderation_actions") && q.values.includes("flag.enabled"))).toBe(true);
  });
});
