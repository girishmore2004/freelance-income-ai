import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import { evaluateCandidate, freelancerCard, normaliseSkill, shortlist, NEWCOMER_SLOTS, SHORTLIST_SIZE } from "./matching";
import type { CandidateRow, ListingForMatch } from "./matching";
import { expireDueListings, handleMatchRoute, MATCH_LIMITS } from "./match-routes";
import type { MatchRouteDeps } from "./match-routes";
import { parseClosesAt, screenText } from "./listings";
import type { ListingRow, VersionRow } from "./listings";
import { createFakeSql, jsonRequest, readJson } from "./test-support";
import type { AuthenticatedSession } from "./session-service";

const NOW = new Date("2026-11-17T10:00:00Z");
const OLD = new Date("2025-01-01T00:00:00Z");
const RECENT = new Date("2026-11-01T00:00:00Z");

const LISTING: ListingForMatch = {
  title: "Website for a handmade goods shop",
  outcome: "Customers can browse and order online",
  description: "",
  category_slug: "website_development",
  category_name: "Website development",
  skills: ["Next.js", "Payments", "SEO"],
  budget_model: "fixed",
  budget_min_minor: 2_500_000,
  budget_max_minor: 5_000_000,
  currency: "INR",
  timezone: ""
};

function candidate(id: string, overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    user_id: id,
    full_name: `Freelancer ${id}`,
    headline: "Full-stack developer",
    skills: JSON.stringify(["nextjs", "Payments", "SEO"]),
    services: JSON.stringify(["Website builds"]),
    minimum_budget: 20000,
    hourly_rate: 1500,
    currency: "INR",
    weekly_hours: 25,
    timezone: "Asia/Kolkata",
    dealbreakers: "[]",
    user_created_at: OLD,
    ...overrides
  };
}

describe("Match and Shortlist (C2) scoring", () => {
  it("normalises skill spellings", () => {
    expect(normaliseSkill("Next.js")).toBe(normaliseSkill("NEXT JS"));
    expect(normaliseSkill("C#")).not.toBe(normaliseSkill("C"));
  });

  it("scores a full match at 100 with a reason for every component", () => {
    const result = evaluateCandidate(LISTING, candidate("a"), NOW);
    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(result.match.score).toBe(100);
    expect(result.match.breakdown).toEqual({ skills: 50, budget: 20, category: 15, availability: 10, timezone: 5 });
    expect(result.match.reasons.join(" | ")).toContain("Has 3 of 3 requested skills");
    expect(result.match.missing_skills).toEqual([]);
  });

  it("explains partial skill coverage and lists missing skills", () => {
    const result = evaluateCandidate(LISTING, candidate("b", { skills: '["Next.js"]' }), NOW);
    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(result.match.breakdown.skills).toBe(17);
    expect(result.match.missing_skills).toEqual(["Payments", "SEO"]);
  });

  it("excludes freelancers with no requested skill, or whose dealbreakers appear in the listing", () => {
    expect(evaluateCandidate(LISTING, candidate("c", { skills: '["Plumbing"]' }), NOW)).toEqual({ eligible: false, reason: "no_skill_overlap" });
    expect(evaluateCandidate(LISTING, candidate("d", { dealbreakers: '["handmade"]' }), NOW)).toEqual({ eligible: false, reason: "dealbreaker" });
  });

  it("lowers the budget component when the budget is under the freelancer's minimum (never sets a price)", () => {
    const result = evaluateCandidate(LISTING, candidate("e", { minimum_budget: 100000 }), NOW);
    expect(result.eligible).toBe(true);
    if (result.eligible) expect(result.match.breakdown.budget).toBe(5);
    const hourly = evaluateCandidate({ ...LISTING, budget_model: "hourly", budget_min_minor: null, budget_max_minor: 100_000 }, candidate("f", { hourly_rate: 900 }), NOW);
    if (hourly.eligible) expect(hourly.match.breakdown.budget).toBe(20);
  });

  it("drops candidates under the minimum score", () => {
    const weak = candidate("g", { skills: '["SEO"]', services: "[]", headline: "", weekly_hours: 2, minimum_budget: 900000 });
    expect(evaluateCandidate({ ...LISTING, timezone: "Europe/London" }, weak, NOW)).toEqual({ eligible: false, reason: "low_score" });
  });

  it("shows only safe card fields", () => {
    const card = freelancerCard(candidate("h", { full_name: "  " }), NOW);
    expect(card.display_name).toBe("Freelancer");
    expect(Object.keys(card).sort()).toEqual(["currency", "display_name", "headline", "hourly_rate", "newcomer", "services", "skills", "timezone", "user_id", "weekly_hours"]);
  });

  it("reserves up to two places for strong newcomers and labels them", () => {
    const established = Array.from({ length: 12 }, (_, i) => candidate(`e${String(i).padStart(2, "0")}`));
    const newcomers = ["n1", "n2", "n3"].map((id) => candidate(id, { user_created_at: RECENT, skills: '["Next.js","Payments"]' }));
    const list = shortlist(LISTING, [...established, ...newcomers], NOW);
    expect(list).toHaveLength(SHORTLIST_SIZE);
    const slots = list.filter((m) => m.newcomer_slot);
    expect(slots).toHaveLength(NEWCOMER_SLOTS);
    expect(slots[0].reasons.join(" ")).toContain("New to the platform");
    expect(list.map((m) => m.freelancer.user_id)).not.toContain("e09");
  });

  it("is deterministic", () => {
    const rows = [candidate("z"), candidate("y", { skills: '["SEO"]' }), candidate("x")];
    expect(shortlist(LISTING, rows, NOW)).toEqual(shortlist(LISTING, [...rows].reverse(), NOW));
  });
});

describe("closing date and message screening", () => {
  it("accepts dates from tomorrow up to 180 days and stores end of day UTC", () => {
    expect(parseClosesAt(undefined, NOW)).toEqual({ ok: true, value: undefined });
    expect(parseClosesAt(null, NOW)).toEqual({ ok: true, value: null });
    expect(parseClosesAt("2026-11-18", NOW)).toEqual({ ok: true, value: "2026-11-18T23:59:59.000Z" });
    expect(parseClosesAt("2026-11-17", NOW).ok).toBe(false);
    expect(parseClosesAt("2027-06-30", NOW).ok).toBe(false);
    expect(parseClosesAt("2026-02-30", NOW).ok).toBe(false);
    expect(parseClosesAt(20261130, NOW).ok).toBe(false);
  });

  it("flags off-platform contact in free text", () => {
    expect(screenText("Message me on WhatsApp").map((f) => f.code)).toEqual(["off_platform_contact"]);
    expect(screenText("We liked your portfolio and would love a proposal.")).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

function session(userId = "c1"): AuthenticatedSession {
  return { user: { id: userId, email: `${userId}@x.test`, email_verified: true, mfa_enabled: false }, claims: { sub: userId, jti: "j", iat: 0, exp: 0 } };
}

const VERSION: VersionRow = {
  version: 1, title: LISTING.title, category_slug: "website_development", outcome: LISTING.outcome, description: "",
  deliverables_json: "[]", skills_json: JSON.stringify(LISTING.skills), experience_level: "any", budget_model: "fixed",
  budget_min_minor: "2500000", budget_max_minor: "5000000", currency: "INR", deadline: null, milestones_json: "[]",
  acceptance_json: "[]", revision_rounds: 2, languages_json: '["en"]', timezone: "", confidentiality: "standard",
  ownership_notes: "", assumptions_json: "[]", content_hash: "h", created_at: NOW
};

interface WorldOptions {
  flag?: boolean;
  roles?: string[];
  membership?: string | null;
  status?: string;
  visibility?: string;
  candidates?: CandidateRow[];
  invitationCount?: number;
  insertReturns?: boolean;
  profile?: { full_name: string; skills: string; marketplace_visible: boolean; marketplace_visible_at: Date | null } | null;
  invitation?: Record<string, unknown> | null;
  user?: string;
}

function world(opts: WorldOptions = {}) {
  const listing: ListingRow = {
    id: "L1", organization_id: "o1", category_slug: "website_development", status: opts.status ?? "published",
    visibility: opts.visibility ?? "public", moderation_status: "passed", moderation_notes: "", current_version: 1,
    published_at: NOW, closes_at: null, created_at: NOW, updated_at: NOW
  };
  const candidates = opts.candidates ?? [candidate("f1"), candidate("f2", { skills: '["SEO"]' })];
  const fake = createFakeSql((text, values) => {
    if (text.startsWith("SELECT enabled FROM feature_flags")) return [{ enabled: opts.flag ?? true }];
    if (text.startsWith("SELECT role, status FROM user_roles")) return (opts.roles ?? ["freelancer", "client"]).map((role) => ({ role, status: "active" }));
    if (text.includes("FROM organization_memberships m JOIN organizations o")) {
      return opts.membership === null ? [] : [{ id: "o1", name: "Acme", status: "active", membership_role: opts.membership ?? "owner" }];
    }
    if (text.startsWith("SELECT * FROM project_listings")) return [listing];
    if (text.startsWith("SELECT * FROM project_listing_versions")) return [VERSION];
    if (text.startsWith("SELECT name FROM project_categories")) return [{ name: "Website development" }];
    if (text.includes("FROM profiles p JOIN users u") && text.includes("p.user_id = $")) return candidates.filter((c) => c.user_id === values[0]);
    if (text.includes("FROM profiles p JOIN users u")) return candidates;
    if (text.startsWith("SELECT full_name, skills, marketplace_visible")) return opts.profile === null ? [] : [opts.profile ?? { full_name: "Asha", skills: '["SEO"]', marketplace_visible: false, marketplace_visible_at: null }];
    if (text.startsWith("SELECT count(*)::int AS n FROM listing_invitations")) return [{ n: opts.invitationCount ?? 0 }];
    if (text.startsWith("INSERT INTO listing_invitations")) {
      return opts.insertReturns === false ? [] : [{ id: "i1", listing_id: "L1", freelancer_user_id: values[2], invited_by: values[3], message: values[4], match_score: values[5], status: "pending", created_at: NOW, responded_at: null }];
    }
    if (text.startsWith("SELECT i.*, l.status AS listing_status")) return opts.invitation === null ? [] : [opts.invitation ?? { id: "i1", listing_id: "L1", freelancer_user_id: "f1", invited_by: "c1", message: "", match_score: 90, status: "pending", created_at: NOW, responded_at: null, listing_status: "published" }];
    return [];
  });
  const deps: MatchRouteDeps = { database: () => fake.sql, authenticate: async () => session(opts.user ?? "c1"), now: () => NOW };
  return { fake, deps, listing };
}

const env = {} as Env;

describe("match routes", () => {
  it("is closed while the client-side flag is off", async () => {
    const { deps } = world({ flag: false });
    for (const path of ["/api/v1/me/marketplace-profile", "/api/v1/me/invitations", "/api/v1/listings/L1/matches"]) {
      const response = await handleMatchRoute(jsonRequest("GET", path), env, "r", deps);
      expect(response!.status).toBe(403);
    }
  });

  it("ignores unrelated paths", async () => {
    const { deps } = world();
    expect(await handleMatchRoute(jsonRequest("GET", "/api/v1/listings/L1"), env, "r", deps)).toBeNull();
    expect(await handleMatchRoute(jsonRequest("DELETE", "/api/v1/listings/L1/matches"), env, "r", deps)).toBeNull();
  });

  it("returns 404 to non-members and requires the client role", async () => {
    const outsider = world({ membership: null });
    for (const [method, path] of [["GET", "/api/v1/listings/L1/matches"], ["GET", "/api/v1/listings/L1/invitations"], ["GET", "/api/v1/organizations/o1/saved-freelancers"]]) {
      expect((await handleMatchRoute(jsonRequest(method, path), env, "r", outsider.deps))!.status).toBe(404);
    }
    const freelancerOnly = world({ roles: ["freelancer"] });
    expect((await handleMatchRoute(jsonRequest("GET", "/api/v1/listings/L1/matches"), env, "r", freelancerOnly.deps))!.status).toBe(403);
  });

  it("ranks visible freelancers, logs the agent run and marks invited/saved", async () => {
    const { deps, fake } = world();
    const response = await handleMatchRoute(jsonRequest("GET", "/api/v1/listings/L1/matches"), env, "r", deps);
    const json = await readJson(response!);
    expect(response!.status).toBe(200);
    expect(json.data.method).toBe("deterministic");
    expect(json.data.matches.map((m: { freelancer: { user_id: string } }) => m.freelancer.user_id)).toEqual(["f1", "f2"]);
    expect(json.data.matches[0]).toMatchObject({ invitation_status: null, saved: false });
    expect(JSON.stringify(json.data)).not.toContain("x.test");
    const candidateQuery = fake.queries.find((q) => q.text.includes("FROM profiles p JOIN users u"));
    expect(candidateQuery!.text).toContain("p.marketplace_visible = true");
    expect(candidateQuery!.text).toContain("r.status = 'active'");
    expect(fake.queries.some((q) => q.text.startsWith("INSERT INTO agent_runs") && q.text.includes("'match_shortlist'"))).toBe(true);
  });

  it("refuses matches for closed listings", async () => {
    const { deps } = world({ status: "closed" });
    expect((await handleMatchRoute(jsonRequest("GET", "/api/v1/listings/L1/matches"), env, "r", deps))!.status).toBe(409);
  });

  it("lets owners invite a visible freelancer once", async () => {
    const { deps, fake } = world();
    const response = await handleMatchRoute(jsonRequest("POST", "/api/v1/listings/L1/invitations", { freelancer_user_id: "f1", message: "We liked your portfolio.", match_score: 92 }), env, "r", deps);
    expect(response!.status).toBe(201);
    const json = await readJson(response!);
    expect(json.data).toMatchObject({ status: "pending", match_score: 92, freelancer: { user_id: "f1" } });
    expect(fake.queries.find((q) => q.text.startsWith("INSERT INTO listing_invitations"))!.inTransaction).toBe(true);

    const again = world({ insertReturns: false });
    const duplicate = await handleMatchRoute(jsonRequest("POST", "/api/v1/listings/L1/invitations", { freelancer_user_id: "f1" }), env, "r", again.deps);
    expect((await readJson(duplicate!)).error!.code).toBe("ALREADY_INVITED");
  });

  it("blocks invitations from members, to hidden freelancers, on unpublished or private listings, over the limit, and with contact details", async () => {
    const cases: Array<[WorldOptions, Record<string, unknown>, number, string]> = [
      [{ membership: "member" }, { freelancer_user_id: "f1" }, 403, "FORBIDDEN"],
      [{}, { freelancer_user_id: "ghost" }, 404, "NOT_FOUND"],
      [{}, { freelancer_user_id: "c1" }, 422, "INVALID_FREELANCER"],
      [{ status: "draft" }, { freelancer_user_id: "f1" }, 409, "LISTING_NOT_OPEN"],
      [{ visibility: "private" }, { freelancer_user_id: "f1" }, 409, "LISTING_PRIVATE"],
      [{ invitationCount: MATCH_LIMITS.MAX_INVITATIONS_PER_LISTING }, { freelancer_user_id: "f1" }, 409, "LIMIT_REACHED"],
      [{}, { freelancer_user_id: "f1", message: "Call me on +91 98765 43210" }, 422, "MESSAGE_NOT_ALLOWED"],
      [{}, { freelancer_user_id: "f1", message: "x".repeat(1001) }, 422, "MESSAGE_TOO_LONG"]
    ];
    for (const [opts, payload, status, code] of cases) {
      const { deps } = world(opts);
      const response = await handleMatchRoute(jsonRequest("POST", "/api/v1/listings/L1/invitations", payload), env, "r", deps);
      expect([response!.status, (await readJson(response!)).error!.code]).toEqual([status, code]);
    }
  });

  it("lets freelancers opt in only with the freelancer role and a complete profile", async () => {
    const ok = world({ user: "f1" });
    const response = await handleMatchRoute(jsonRequest("PUT", "/api/v1/me/marketplace-profile", { visible: true }), env, "r", ok.deps);
    expect(response!.status).toBe(200);
    const update = ok.fake.queries.find((q) => q.text.startsWith("UPDATE profiles SET marketplace_visible"));
    expect(update!.values).toEqual([true, NOW.toISOString(), "f1"]);

    const incomplete = world({ user: "f1", profile: { full_name: "", skills: "[]", marketplace_visible: false, marketplace_visible_at: null } });
    expect((await handleMatchRoute(jsonRequest("PUT", "/api/v1/me/marketplace-profile", { visible: true }), env, "r", incomplete.deps))!.status).toBe(422);
    const noRole = world({ user: "f1", roles: ["client"] });
    expect((await handleMatchRoute(jsonRequest("PUT", "/api/v1/me/marketplace-profile", { visible: true }), env, "r", noRole.deps))!.status).toBe(403);
    const bad = world({ user: "f1" });
    expect((await handleMatchRoute(jsonRequest("PUT", "/api/v1/me/marketplace-profile", { visible: "yes" }), env, "r", bad.deps))!.status).toBe(422);
    // Opting out always works.
    const out = world({ user: "f1", roles: [] });
    expect((await handleMatchRoute(jsonRequest("PUT", "/api/v1/me/marketplace-profile", { visible: false }), env, "r", out.deps))!.status).toBe(200);
  });

  it("lets the invited freelancer accept or decline once, and never someone else's invitation", async () => {
    const accept = world({ user: "f1" });
    const response = await handleMatchRoute(jsonRequest("POST", "/api/v1/me/invitations/i1/respond", { response: "accept" }), env, "r", accept.deps);
    expect(response!.status).toBe(200);
    const select = accept.fake.queries.find((q) => q.text.startsWith("SELECT i.*, l.status AS listing_status"));
    expect(select!.values).toEqual(["i1", "f1"]);
    expect(select!.text).toContain("FOR UPDATE OF i");

    const answered = world({ user: "f1", invitation: { id: "i1", status: "declined", listing_status: "published" } });
    expect((await handleMatchRoute(jsonRequest("POST", "/api/v1/me/invitations/i1/respond", { response: "accept" }), env, "r", answered.deps))!.status).toBe(409);
    const closed = world({ user: "f1", invitation: { id: "i1", status: "pending", listing_status: "closed" } });
    expect((await handleMatchRoute(jsonRequest("POST", "/api/v1/me/invitations/i1/respond", { response: "accept" }), env, "r", closed.deps))!.status).toBe(409);
    const other = world({ user: "f9", invitation: null });
    expect((await handleMatchRoute(jsonRequest("POST", "/api/v1/me/invitations/i1/respond", { response: "decline" }), env, "r", other.deps))!.status).toBe(404);
  });

  it("saves only visible freelancers for member organisations", async () => {
    const { deps, fake } = world({ membership: "member" });
    const saved = await handleMatchRoute(jsonRequest("POST", "/api/v1/organizations/o1/saved-freelancers", { freelancer_user_id: "f1", note: "Strong SEO" }), env, "r", deps);
    expect(saved!.status).toBe(201);
    expect(fake.queries.find((q) => q.text.startsWith("INSERT INTO saved_freelancers"))!.text).toContain("ON CONFLICT (organization_id, freelancer_user_id)");
    const hidden = world();
    expect((await handleMatchRoute(jsonRequest("POST", "/api/v1/organizations/o1/saved-freelancers", { freelancer_user_id: "ghost" }), env, "r", hidden.deps))!.status).toBe(404);
    const removed = world();
    const response = await handleMatchRoute(jsonRequest("DELETE", "/api/v1/organizations/o1/saved-freelancers/f1"), env, "r", removed.deps);
    expect(response!.status).toBe(200);
    expect(removed.fake.queries.find((q) => q.text.startsWith("DELETE FROM saved_freelancers"))!.values).toEqual(["o1", "f1"]);
  });
});

describe("listing expiry", () => {
  it("expires only open listings past their closing date, and only with the flag on", async () => {
    const on = createFakeSql((text) => {
      if (text.startsWith("SELECT enabled FROM feature_flags")) return [{ enabled: true }];
      if (text.startsWith("UPDATE project_listings SET status = 'expired'")) return [{ id: "L1" }, { id: "L2" }];
      return [];
    });
    expect(await expireDueListings(env, on.sql)).toBe(2);
    const update = on.queries.find((q) => q.text.startsWith("UPDATE project_listings"))!;
    expect(update.text).toContain("status IN ('published', 'hiring', 'paused')");
    expect(update.text).toContain("closes_at <= now()");

    const off = createFakeSql((text) => (text.startsWith("SELECT enabled FROM feature_flags") ? [{ enabled: false }] : []));
    expect(await expireDueListings(env, off.sql)).toBe(0);
    expect(off.queries.some((q) => q.text.startsWith("UPDATE"))).toBe(false);
  });
});
