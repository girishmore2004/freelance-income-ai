import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import { contractActions, hasPendingChange, lockedMilestoneErrors } from "./contracts";
import type { ContractRow, ContractVersionRow } from "./contracts";
import { REVEAL_AFTER_DAYS, handleReviewRoute, reviewsRevealed, validateReview } from "./review-routes";
import type { ReviewRouteDeps } from "./review-routes";
import { createFakeSql, jsonRequest, readJson } from "./test-support";
import type { AuthenticatedSession } from "./session-service";

const DONE = new Date("2026-11-10T10:00:00Z");
const NOW = new Date("2026-11-17T10:00:00Z");
const DAY = 86_400_000;

describe("change orders", () => {
  const active = { status: "active", current_version: 2, agreed_version: 2 } as ContractRow;
  const pending = { status: "active", current_version: 3, agreed_version: 2 } as ContractRow;
  const proposedByClient = { client_accepted_at: NOW, freelancer_accepted_at: null } as ContractVersionRow;

  it("detects a pending change and offers accept/reject only to the other side", () => {
    expect(hasPendingChange(active)).toBe(false);
    expect(hasPendingChange(pending)).toBe(true);
    expect(contractActions(active, proposedByClient, "freelancer", true)).toEqual(["propose_changes"]);
    expect(contractActions(pending, proposedByClient, "freelancer", true)).toEqual(["accept", "propose_changes", "reject_change"]);
    expect(contractActions(pending, proposedByClient, "client", true)).toEqual(["propose_changes", "reject_change"]);
    expect(contractActions({ status: "completed" } as ContractRow, proposedByClient, "client", true)).toEqual([]);
  });

  it("locks delivered milestones' position, title and amount", () => {
    const agreed = [{ title: "Design", amount_minor: 500, due_date: null }, { title: "Build", amount_minor: 1000, due_date: null }];
    expect(lockedMilestoneErrors(agreed, [...agreed, { title: "SEO", amount_minor: 300, due_date: null }], [0])).toEqual({});
    expect(lockedMilestoneErrors(agreed, [{ ...agreed[0], due_date: "2027-01-01" }, agreed[1]], [0])).toEqual({});
    expect(Object.keys(lockedMilestoneErrors(agreed, [{ title: "Design", amount_minor: 400, due_date: null }, agreed[1]], [0]))).toEqual(["milestones.0.title"]);
    expect(Object.keys(lockedMilestoneErrors(agreed, [agreed[0]], [0, 1]))).toEqual(["milestones.1.title"]);
  });
});

describe("review rules", () => {
  it("reveals when both reviewed or after the waiting period", () => {
    expect(reviewsRevealed(DONE, [{ reviewer_party: "client" }], NOW)).toBe(false);
    expect(reviewsRevealed(DONE, [{ reviewer_party: "client" }, { reviewer_party: "freelancer" }], NOW)).toBe(true);
    expect(reviewsRevealed(DONE, [{ reviewer_party: "client" }], new Date(DONE.getTime() + REVEAL_AFTER_DAYS * DAY))).toBe(true);
  });

  it("accepts whole ratings 1–5 and screens comments", () => {
    expect(validateReview({ rating: 5, comment: " Great " })).toEqual({ ok: true, rating: 5, comment: "Great" });
    for (const rating of [0, 6, 4.5, "5"]) expect(validateReview({ rating }).ok).toBe(false);
    expect(validateReview({ rating: 4, comment: "Email me: a@b.co" }).ok).toBe(false);
  });
});

function session(userId: string): AuthenticatedSession {
  return { user: { id: userId, email: `${userId}@x.test`, email_verified: true, mfa_enabled: false }, claims: { sub: userId, jti: "j", iat: 0, exp: 0 } };
}

function world(opts: { user?: string; status?: string; completedAt?: Date | null; reviews?: Array<{ reviewer_party: string; rating: number }>; insertReturns?: boolean; membership?: string; now?: Date } = {}) {
  const contract = { id: "K1", organization_id: "o1", freelancer_user_id: "f1", status: opts.status ?? "completed", completed_at: opts.completedAt === undefined ? DONE : opts.completedAt };
  const fake = createFakeSql((text) => {
    if (text.startsWith("SELECT enabled FROM feature_flags")) return [{ enabled: true }];
    if (text.includes("FROM organization_memberships m JOIN organizations o")) {
      return (opts.user ?? "c1") === "c1" ? [{ id: "o1", name: "Acme", status: "active", membership_role: opts.membership ?? "owner" }] : [];
    }
    if (text.startsWith("SELECT * FROM contracts")) return [contract];
    if (text.startsWith("INSERT INTO contract_reviews")) return opts.insertReturns === false ? [] : [{ id: "R1" }];
    if (text.startsWith("SELECT reviewer_party, rating")) return (opts.reviews ?? []).map((r) => ({ ...r, comment: "", created_at: NOW }));
    return [];
  });
  const deps: ReviewRouteDeps = { database: () => fake.sql, authenticate: async () => session(opts.user ?? "c1"), now: () => opts.now ?? NOW };
  return { fake, deps };
}

const env = {} as Env;
const call = (deps: ReviewRouteDeps, method: string, path: string, payload?: unknown) => handleReviewRoute(jsonRequest(method, path, payload), env, "r", deps);

describe("review routes", () => {
  it("accepts one review per party on completed contracts, within the window, from owners/admins", async () => {
    const ok = world();
    const response = await call(ok.deps, "POST", "/api/v1/contracts/K1/review", { rating: 5, comment: "On time" });
    expect(response!.status).toBe(201);
    expect(ok.fake.queries.find((q) => q.text.startsWith("INSERT INTO contract_reviews"))!.text).toContain("ON CONFLICT (contract_id, reviewer_party) DO NOTHING");
    const cases: Array<[Parameters<typeof world>[0], number, string]> = [
      [{ status: "active", completedAt: null }, 409, "NOT_COMPLETED"],
      [{ now: new Date(DONE.getTime() + 31 * DAY) }, 409, "REVIEW_WINDOW_CLOSED"],
      [{ membership: "member" }, 403, "FORBIDDEN"],
      [{ insertReturns: false }, 409, "ALREADY_REVIEWED"],
      [{ user: "f9" }, 404, "NOT_FOUND"]
    ];
    for (const [opts, status, code] of cases) {
      const r = await call(world(opts).deps, "POST", "/api/v1/contracts/K1/review", { rating: 4 });
      expect([r!.status, (await readJson(r!)).error!.code]).toEqual([status, code]);
    }
  });

  it("hides the other party's review until revealed", async () => {
    const hidden = await call(world({ user: "f1", reviews: [{ reviewer_party: "client", rating: 2 }] }).deps, "GET", "/api/v1/contracts/K1/reviews");
    expect((await readJson(hidden!)).data).toMatchObject({ party: "freelancer", revealed: false, theirs: null, theirs_submitted: true, can_review: true });
    const both = await call(world({ user: "f1", reviews: [{ reviewer_party: "client", rating: 2 }, { reviewer_party: "freelancer", rating: 4 }] }).deps, "GET", "/api/v1/contracts/K1/reviews");
    expect((await readJson(both!)).data).toMatchObject({ revealed: true, theirs: { rating: 2 }, mine: { rating: 4 }, can_review: false });
  });
});
