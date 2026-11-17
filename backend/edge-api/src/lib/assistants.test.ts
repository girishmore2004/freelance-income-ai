import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import { acceptanceChecklist, compareProposals, coverage, keywords, suggestTerms } from "./assistants";
import { handleAssistantRoute } from "./assistant-routes";
import type { AssistantRouteDeps } from "./assistant-routes";
import { createFakeSql, jsonRequest, readJson } from "./test-support";
import type { AuthenticatedSession } from "./session-service";

const TODAY = new Date("2026-11-17T10:00:00Z");
const LISTING = { budget_min_minor: 2_000_000, budget_max_minor: 3_000_000, deadline: "2026-12-17", skills: ["Next.js", "SEO"], deliverables: ["Class booking calendar", "Payment page integration"] };
const base = { freelancer_name: "A", cover_letter: "", skills: [], rating: null, invited: false, created_at: "2026-11-17T00:00:00Z" };

describe("text coverage", () => {
  it("drops stop words and matches simple word forms", () => {
    expect(keywords("The booking calendar shows availability")).toEqual(["booking", "calendar", "shows", "availability"]);
    expect(coverage("Booking calendar shows availability", "We are showing a calendar of availability for booking").ratio).toBe(1);
    expect(coverage("", "anything").ratio).toBe(0);
  });
});

describe("C3 proposal comparison", () => {
  it("states budget and timeline fit and flags gaps, without ranking", () => {
    const result = compareProposals(LISTING, [
      { ...base, id: "p1", price_minor: 3_500_000, estimated_days: 40, skills: ["nextjs", "SEO"], cover_letter: "Class booking calendar and payment page integration included." },
      { ...base, id: "p2", price_minor: 1_000_000, estimated_days: null },
      { ...base, id: "p3", price_minor: 2_500_000, estimated_days: 27 }
    ], TODAY);
    expect(result.rows.map((r) => [r.proposal_id, r.budget_fit, r.timeline_fit])).toEqual([["p1", "above", "late"], ["p2", "below", "not_stated"], ["p3", "within", "tight"]]);
    expect(result.rows[0]).toMatchObject({ skills_covered: ["Next.js", "SEO"], skills_missing: [], deliverables_mentioned: 2 });
    expect(result.rows[1].notes.join(" ")).toContain("Priced below your budget range");
    expect(result.price_range).toEqual({ min: 1_000_000, max: 3_500_000 });
    expect(result.disclaimer).toContain("Nothing is ranked");
  });

  it("handles listings with no budget or deadline", () => {
    const result = compareProposals({ ...LISTING, budget_min_minor: null, budget_max_minor: null, deadline: null }, [{ ...base, id: "p", price_minor: 100, estimated_days: 5 }], TODAY);
    expect([result.rows[0].budget_fit, result.rows[0].timeline_fit]).toEqual(["no_budget", "no_deadline"]);
  });
});

describe("C5 suggested terms", () => {
  it("splits the freelancer's price exactly in whole rupees and spreads dates to the deadline", () => {
    const result = suggestTerms({ title: "T", deliverables: [], milestone_titles: ["Design", "Build", "Launch"], acceptance_criteria: ["Works"], revision_rounds: 2, ownership_notes: "Client owns code", deadline: "2026-12-17", price_minor: 2_500_001 }, TODAY);
    const amounts = result.terms.milestones.map((m) => m.amount_minor);
    expect(amounts).toEqual([833_300, 833_300, 833_401]);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(2_500_001);
    expect(result.terms.milestones.map((m) => m.due_date)).toEqual(["2026-11-27", "2026-12-07", "2026-12-17"]);
    expect(result.missing_terms).toEqual([]);
  });

  it("flags missing terms and falls back to one milestone", () => {
    const result = suggestTerms({ title: "T", deliverables: [], milestone_titles: [], acceptance_criteria: [], revision_rounds: 2, ownership_notes: "", deadline: null, price_minor: 50_000 }, TODAY);
    expect(result.terms.milestones).toEqual([{ title: "Complete project", amount_minor: 50_000, due_date: null }]);
    expect(result.missing_terms).toHaveLength(4);
  });
});

describe("C6 acceptance checklist", () => {
  it("marks criteria the delivery note mentions and says the client decides", () => {
    const result = acceptanceChecklist(["Booking calendar shows live availability", "Mobile layout works on phones"], "Calendar with booking availability is ready.", []);
    expect(result.items.map((i) => i.mentioned)).toEqual([true, false]);
    expect(result.summary).toContain("1 of 2 criteria are not mentioned");
    expect(result.note).toContain("You decide");
    expect(acceptanceChecklist([], "x", []).summary).toContain("no acceptance criteria");
  });
});

function session(userId: string): AuthenticatedSession {
  return { user: { id: userId, email: `${userId}@x.test`, email_verified: true, mfa_enabled: false }, claims: { sub: userId, jti: "j", iat: 0, exp: 0 } };
}

function world(opts: { agentOn?: boolean; member?: boolean } = {}) {
  const fake = createFakeSql((text) => {
    if (text.startsWith("SELECT enabled FROM feature_flags")) return [{ enabled: true }];
    if (text.startsWith("SELECT enabled FROM agent_definitions")) return [{ enabled: opts.agentOn ?? true }];
    if (text.startsWith("SELECT role, status FROM user_roles")) return [{ role: "client", status: "active" }];
    if (text.includes("FROM organization_memberships m JOIN organizations o")) return opts.member === false ? [] : [{ id: "o1", name: "Acme", status: "active", membership_role: "member" }];
    if (text.startsWith("SELECT * FROM project_listings")) return [{ id: "L1", organization_id: "o1", current_version: 1 }];
    if (text.startsWith("SELECT * FROM project_listing_versions")) {
      return [{ version: 1, title: "T", category_slug: "w", outcome: "", description: "", deliverables_json: "[]", skills_json: "[]", experience_level: "any", budget_model: "fixed", budget_min_minor: null, budget_max_minor: null, currency: "INR", deadline: null, milestones_json: "[]", acceptance_json: "[]", revision_rounds: 2, languages_json: "[]", timezone: "", confidentiality: "standard", ownership_notes: "", assumptions_json: "[]", content_hash: "h", created_at: TODAY }];
    }
    return [];
  });
  const deps: AssistantRouteDeps = { database: () => fake.sql, authenticate: async () => session("c1"), now: () => TODAY };
  return { fake, deps };
}

const env = {} as Env;

describe("assistant routes", () => {
  it("ignores other paths and methods", async () => {
    expect(await handleAssistantRoute(jsonRequest("POST", "/api/v1/listings/L1/proposal-comparison", {}), env, "r", world().deps)).toBeNull();
    expect(await handleAssistantRoute(jsonRequest("GET", "/api/v1/listings/L1/proposals"), env, "r", world().deps)).toBeNull();
  });

  it("respects the registry switch and organisation membership, and records the run", async () => {
    const off = await handleAssistantRoute(jsonRequest("GET", "/api/v1/listings/L1/proposal-comparison"), env, "r", world({ agentOn: false }).deps);
    expect((await readJson(off!)).error!.code).toBe("AGENT_DISABLED");
    expect((await handleAssistantRoute(jsonRequest("GET", "/api/v1/listings/L1/proposal-comparison"), env, "r", world({ member: false }).deps))!.status).toBe(404);
    const ok = world();
    const response = await handleAssistantRoute(jsonRequest("GET", "/api/v1/listings/L1/proposal-comparison"), env, "r", ok.deps);
    expect(response!.status).toBe(200);
    expect(ok.fake.queries.some((q) => q.text.startsWith("INSERT INTO agent_runs") && q.values.includes("proposal_comparison"))).toBe(true);
  });
});
