import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import { handleDeliveryRoute, milestoneViews, validateLinks } from "./delivery-routes";
import type { DeliveryRouteDeps } from "./delivery-routes";
import { createFakeSql, jsonRequest, readJson } from "./test-support";
import type { AuthenticatedSession } from "./session-service";

const T0 = new Date("2026-11-17T10:00:00Z");
const T1 = new Date("2026-11-18T10:00:00Z");
const MILESTONES = [{ title: "Design", amount_minor: 500_000, due_date: null }, { title: "Build", amount_minor: 1_000_000, due_date: "2026-12-31" }];

describe("milestone states", () => {
  it("derives each milestone's state from its latest submission and counts revisions", () => {
    const views = milestoneViews(MILESTONES, [
      { id: "s1", milestone_index: 0, contract_version: 1, status: "revision_requested", note: "", links_json: "[]", submitted_at: T0, reviewed_at: T0, review_note: "warmer" },
      { id: "s2", milestone_index: 0, contract_version: 1, status: "submitted", note: "v2", links_json: '["https://a.example/x"]', submitted_at: T1, reviewed_at: null, review_note: "" }
    ]);
    expect(views.map((v) => [v.state, v.revisions_used, v.submissions.length])).toEqual([["submitted", 1, 2], ["pending", 0, 0]]);
    expect(views[0].submissions[0].links).toEqual(["https://a.example/x"]);
    expect(views[1].due_date).toBe("2026-12-31");
  });

  it("accepts only https links with a real host, at most ten", () => {
    expect(validateLinks(["https://www.figma.com/file/abc"])).toEqual(["https://www.figma.com/file/abc"]);
    expect(validateLinks(undefined)).toEqual([]);
    for (const bad of [["http://x.com"], ["javascript:alert(1)"], ["https://localhost/x"], "https://x.com", Array(11).fill("https://x.com")]) {
      expect(validateLinks(bad)).toBeNull();
    }
  });
});

function session(userId: string): AuthenticatedSession {
  return { user: { id: userId, email: `${userId}@x.test`, email_verified: true, mfa_enabled: false }, claims: { sub: userId, jti: "j", iat: 0, exp: 0 } };
}

interface World {
  user?: string;
  flag?: boolean;
  membership?: string | null;
  status?: string;
  latest?: string | null;
  open?: boolean;
  revisionsUsed?: number;
  approved?: number[];
  rounds?: number;
}

function world(opts: World = {}) {
  const contract = { id: "K1", listing_id: "L1", proposal_id: "P1", organization_id: "o1", freelancer_user_id: "f1", status: opts.status ?? "active", current_version: 1, created_at: T0, updated_at: T0, activated_at: T0 };
  const version = {
    version: 1, title: "T", scope: "", deliverables_json: "[]", milestones_json: JSON.stringify(MILESTONES), total_minor: "1500000", currency: "INR",
    revision_rounds: opts.rounds ?? 2, acceptance_json: "[]", ownership_terms: "", content_hash: "h", proposed_by: "client", created_at: T0,
    client_accepted_at: T0, freelancer_accepted_at: T0
  };
  const fake = createFakeSql((text) => {
    if (text.startsWith("SELECT enabled FROM feature_flags")) return [{ enabled: opts.flag ?? true }];
    if (text.includes("FROM organization_memberships m JOIN organizations o")) {
      const user = opts.user ?? "c1";
      if (opts.membership === null || (opts.membership === undefined && user !== "c1")) return [];
      return [{ id: "o1", name: "Acme", status: "active", membership_role: opts.membership ?? "owner" }];
    }
    if (text.startsWith("SELECT * FROM contracts WHERE id")) return [contract];
    if (text.startsWith("SELECT * FROM contract_versions")) return [version];
    if (text.startsWith("SELECT status FROM milestone_submissions")) return opts.latest ? [{ status: opts.latest }] : [];
    if (text.startsWith("SELECT id FROM milestone_submissions")) return opts.open === false ? [] : [{ id: "s1" }];
    if (text.startsWith("SELECT count(*)::int AS n FROM milestone_submissions")) return [{ n: opts.revisionsUsed ?? 0 }];
    if (text.startsWith("SELECT DISTINCT milestone_index")) return (opts.approved ?? [0]).map((milestone_index) => ({ milestone_index }));
    return [];
  });
  const deps: DeliveryRouteDeps = { database: () => fake.sql, authenticate: async () => session(opts.user ?? "c1") };
  return { fake, deps };
}

const env = {} as Env;
const call = (deps: DeliveryRouteDeps, method: string, path: string, payload?: unknown) => handleDeliveryRoute(jsonRequest(method, path, payload), env, "r", deps);

describe("delivery routes", () => {
  it("ignores other contract paths and is closed while the flag is off", async () => {
    const { deps } = world();
    expect(await call(deps, "POST", "/api/v1/contracts/K1/accept")).toBeNull();
    expect(await call(deps, "GET", "/api/v1/contracts/K1")).toBeNull();
    const off = world({ flag: false });
    expect((await call(off.deps, "GET", "/api/v1/contracts/K1/workspace"))!.status).toBe(403);
  });

  it("shows the workspace only to the two parties", async () => {
    const stranger = world({ user: "f9" });
    expect((await call(stranger.deps, "GET", "/api/v1/contracts/K1/workspace"))!.status).toBe(404);
    const freelancer = world({ user: "f1" });
    const response = await call(freelancer.deps, "GET", "/api/v1/contracts/K1/workspace");
    expect(response!.status).toBe(200);
    const json = await readJson(response!);
    expect(json.data).toMatchObject({ party: "freelancer", total_minor: 1_500_000, approved_minor: 0, revision_rounds: 2 });
    expect(json.data.funding_note).toContain("No payment is released");
  });

  it("lets only the freelancer submit, once per open milestone, on active contracts", async () => {
    const ok = world({ user: "f1" });
    const response = await call(ok.deps, "POST", "/api/v1/contracts/K1/milestones/0/submit", { note: "Mockups ready for review", links: ["https://www.figma.com/file/x"] });
    expect(response!.status).toBe(201);
    const insert = ok.fake.queries.find((q) => q.text.startsWith("INSERT INTO milestone_submissions"))!;
    expect(insert.inTransaction).toBe(true);
    expect(ok.fake.queries.some((q) => q.text.startsWith("INSERT INTO contract_events") && q.values.includes("milestone.submitted"))).toBe(true);

    const cases: Array<[World, string, number, string]> = [
      [{ user: "c1" }, "/api/v1/contracts/K1/milestones/0/submit", 403, "FORBIDDEN"],
      [{ user: "f1", status: "offered" }, "/api/v1/contracts/K1/milestones/0/submit", 409, "CONTRACT_NOT_ACTIVE"],
      [{ user: "f1", latest: "submitted" }, "/api/v1/contracts/K1/milestones/0/submit", 409, "MILESTONE_NOT_OPEN"],
      [{ user: "f1", latest: "approved" }, "/api/v1/contracts/K1/milestones/0/submit", 409, "MILESTONE_NOT_OPEN"],
      [{ user: "f1" }, "/api/v1/contracts/K1/milestones/7/submit", 404, "NOT_FOUND"]
    ];
    for (const [opts, path, status, code] of cases) {
      const { deps } = world(opts);
      const r = await call(deps, "POST", path, { note: "Mockups ready for review" });
      expect([r!.status, (await readJson(r!)).error!.code]).toEqual([status, code]);
    }
    const resubmit = world({ user: "f1", latest: "revision_requested" });
    expect((await call(resubmit.deps, "POST", "/api/v1/contracts/K1/milestones/0/submit", { note: "Second version with changes" }))!.status).toBe(201);
  });

  it("limits revision requests to the agreed rounds and requires a reason", async () => {
    const noReason = world();
    expect((await readJson((await call(noReason.deps, "POST", "/api/v1/contracts/K1/milestones/0/review", { decision: "request_revision", note: "no" }))!)).error!.code).toBe("NOTE_REQUIRED");
    const used = world({ revisionsUsed: 2 });
    expect((await readJson((await call(used.deps, "POST", "/api/v1/contracts/K1/milestones/0/review", { decision: "request_revision", note: "Please change the colours" }))!)).error!.code).toBe("NO_REVISIONS_LEFT");
    const fine = world({ revisionsUsed: 1 });
    expect((await call(fine.deps, "POST", "/api/v1/contracts/K1/milestones/0/review", { decision: "request_revision", note: "Please change the colours" }))!.status).toBe(200);
  });

  it("lets only client owners/admins review, and only a waiting delivery", async () => {
    expect((await call(world({ user: "f1" }).deps, "POST", "/api/v1/contracts/K1/milestones/0/review", { decision: "approve" }))!.status).toBe(403);
    expect((await call(world({ membership: "member" }).deps, "POST", "/api/v1/contracts/K1/milestones/0/review", { decision: "approve" }))!.status).toBe(403);
    expect((await readJson((await call(world({ open: false }).deps, "POST", "/api/v1/contracts/K1/milestones/0/review", { decision: "approve" }))!)).error!.code).toBe("NOTHING_TO_REVIEW");
  });

  it("completes the contract when every milestone is approved, and says no money moved", async () => {
    const partial = world({ approved: [0] });
    const first = await call(partial.deps, "POST", "/api/v1/contracts/K1/milestones/0/review", { decision: "approve" });
    const firstJson = await readJson(first!);
    expect(firstJson.data.contract_completed).toBe(false);
    expect(firstJson.message).toContain("No payment is released");
    expect(partial.fake.queries.some((q) => q.text.startsWith("UPDATE contracts SET status = 'completed'"))).toBe(false);

    const all = world({ approved: [0, 1] });
    const last = await call(all.deps, "POST", "/api/v1/contracts/K1/milestones/1/review", { decision: "approve" });
    expect((await readJson(last!)).data.contract_completed).toBe(true);
    const done = all.fake.queries.find((q) => q.text.startsWith("UPDATE contracts SET status = 'completed'"))!;
    expect(done.inTransaction).toBe(true);
  });

  it("screens messages and closes them after the contract ends", async () => {
    const blocked = world({ user: "f1" });
    expect((await readJson((await call(blocked.deps, "POST", "/api/v1/contracts/K1/messages", { body: "Pay me in USDT instead" }))!)).error!.code).toBe("MESSAGE_NOT_ALLOWED");
    const closed = world({ user: "f1", status: "completed" });
    expect((await call(closed.deps, "POST", "/api/v1/contracts/K1/messages", { body: "Thanks!" }))!.status).toBe(409);
    const sent = world({ user: "c1", membership: "member" });
    expect((await call(sent.deps, "POST", "/api/v1/contracts/K1/messages", { body: "Looks good so far" }))!.status).toBe(201);
  });
});
