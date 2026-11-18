import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import { allowedTransitions, analyseOpportunity, checkTransition, nextStep } from "./external-pipeline";
import { handleOpportunityRoute, validateEvent } from "./opportunity-routes";
import type { OpportunityRouteDeps } from "./opportunity-routes";
import { OPERATION_POLICY, policyDecision } from "./agents";
import { redactContactDetails, reviewGeneratedText, sanitizeUntrusted } from "./ai-guard";
import { safeProposalTemplate } from "./core-routes";
import { handleOpsRoute, heldMismatches } from "./ops-routes";
import type { OpsRouteDeps } from "./ops-routes";
import { createFakeSql, jsonRequest, readJson } from "./test-support";

const NOW = new Date("2026-11-18T10:00:00Z");
const session = (id: string) => ({ user: { id, email: `${id}@x.test`, email_verified: true, mfa_enabled: false }, claims: { sub: id, jti: "j", iat: 0, exp: 0 } });

describe("external application state machine", () => {
  it("allows only the documented transitions", () => {
    expect(allowedTransitions("ready")).toEqual(["applied", "skipped"]);
    expect(allowedTransitions("applied")).toContain("interview");
    expect(allowedTransitions("won")).toEqual([]);
    expect(checkTransition("new", "applied")).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect(checkTransition("drafted", "ready")).toMatchObject({ ok: false, code: "SYSTEM_STATUS" });
    expect(checkTransition("applied", "maybe")).toMatchObject({ ok: false, code: "INVALID_STATUS" });
    expect(checkTransition("interview", "offer")).toEqual({ ok: true });
    expect(checkTransition("skipped", "new")).toEqual({ ok: true });
    expect(nextStep("ready").action).toBe("submit");
  });

  it("analyses fit, budget and risks deterministically", () => {
    const opp = {
      title: "Next.js bakery site", description: "Build a shop. Pay a registration fee first.", required_skills: JSON.stringify(["Next.js", "Stripe"]),
      match_score: 82, budget_max: 20000, currency: "INR", client_payment_verified: false, client_rating: 3.5, client_reviews: 6, deadline: "2026-11-01",
      score_breakdown: JSON.stringify({ notes: { matched_skills: ["Next.js"], missing_skills: ["Stripe"] } })
    };
    const a = analyseOpportunity(opp, { skills: ["Next.js"], portfolio_links: ["https://example.dev/work/bakery-site"], minimum_budget: 25000, currency: "INR" }, NOW);
    expect(a.budget.status).toBe("below_minimum");
    expect(a.recommendation).toBe("skip");
    expect(a.risks.join(" ")).toMatch(/not verified.*rating is 3.5.*deadline.*scam/s);
    expect(a.evidence[0].url).toBe("https://example.dev/work/bakery-site");
    const clean = analyseOpportunity({ ...opp, description: "Build a shop.", client_payment_verified: true, client_rating: 4.9, deadline: null, budget_max: 50000 }, { skills: ["Next.js"], portfolio_links: [], minimum_budget: 25000, currency: "INR" }, NOW);
    expect(clean.recommendation).toBe("apply");
  });

  it("validates follow-ups, interviews and notes", () => {
    expect(validateEvent({ kind: "follow_up", note: "Ping the client" }, "2026-11-18").ok).toBe(false);
    expect(validateEvent({ kind: "interview", note: "Call", due_date: "2026-11-17" }, "2026-11-18").ok).toBe(false);
    expect(validateEvent({ kind: "note", note: "Client prefers mornings" }, "2026-11-18")).toEqual({ ok: true, value: { kind: "note", note: "Client prefers mornings", due_date: null } });
    expect(validateEvent({ kind: "payment", note: "x" }, "2026-11-18").ok).toBe(false);
  });
});

function oppWorld(opts: { ready?: boolean; owner?: boolean } = {}) {
  const fake = createFakeSql((text) => {
    if (text.startsWith("SELECT to_regclass(")) return [{ ready: opts.ready ?? true }];
    if (text.startsWith("SELECT * FROM opportunities WHERE id")) return opts.owner === false ? [] : [{ id: "O1", user_id: "f1", title: "Site", description: "d", status: "applied", match_score: 70, currency: "INR", source: "remotive", source_url: "javascript:alert(1)", required_skills: "[]", score_breakdown: "{}" }];
    if (text.startsWith("SELECT skills, portfolio_links")) return [{ skills: '["Next.js"]', portfolio_links: "[]", minimum_budget: null, currency: "INR" }];
    if (text.startsWith("SELECT * FROM proposals WHERE opportunity_id")) return [{ id: "P1", opportunity_id: "O1", version: 2, content: "Hello", status: "sent", currency: "INR", created_at: NOW }];
    if (text.startsWith("SELECT * FROM approvals")) return [{ id: "A1", proposal_id: "P1", decision: "approved", note: "", created_at: NOW, decided_at: NOW }];
    if (text.startsWith("SELECT proposal_id, version")) return [{ proposal_id: "P1", version: 2, content: "Hello", proposed_price: null, currency: "INR", source: "edited", created_at: NOW }, { proposal_id: "P1", version: 1, content: "Hi", proposed_price: null, currency: "INR", source: "model", created_at: NOW }];
    if (text.startsWith("SELECT a.id, a.proposal_id")) return [{ id: "AP1", proposal_id: "P1", channel: "manual", status: "sent", recipient: "", external_ref: "", sent_at: NOW, created_at: NOW, replies: 1 }];
    if (text.startsWith("SELECT id, kind, from_status")) return [{ id: "E1", kind: "status", from_status: "ready", to_status: "applied", note: "", due_date: null, done_at: null, application_id: "AP1", created_at: NOW }];
    if (text.startsWith("SELECT count(*)::int AS n FROM opportunity_events")) return [{ n: 0 }];
    if (text.startsWith("INSERT INTO opportunity_events")) return [{ id: "E2", kind: "follow_up", note: "Ping", due_date: "2026-11-20", created_at: NOW }];
    if (text.startsWith("UPDATE opportunity_events SET done_at")) return [{ id: "E2" }];
    return [];
  });
  const deps: OpportunityRouteDeps = { database: () => fake.sql, authenticate: async () => session("f1"), now: () => NOW };
  return { fake, deps };
}
const call = (deps: OpportunityRouteDeps, method: string, path: string, payload?: unknown) => handleOpportunityRoute(jsonRequest(method, path, payload), {} as Env, "r", deps);

describe("opportunity timeline routes", () => {
  it("returns one project-centric record with versions, approvals, submissions and events", async () => {
    const { deps } = oppWorld();
    const data = (await readJson((await call(deps, "GET", "/api/v1/opportunities/O1/timeline"))!)).data;
    expect(data.proposals[0].versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(data.proposals[0].approvals[0].decision).toBe("approved");
    expect(data.applications[0]).toMatchObject({ channel: "manual", replies: 1 });
    expect(data.events[0]).toMatchObject({ from_status: "ready", to_status: "applied" });
    expect(data.allowed_transitions).toContain("interview");
    expect(data.opportunity.source_url).toBe(""); // unsafe links never leave the API
  });

  it("is owner-only and degrades before migration 0069", async () => {
    expect((await call(oppWorld({ owner: false }).deps, "GET", "/api/v1/opportunities/O1/timeline"))!.status).toBe(404);
    expect((await call(oppWorld({ ready: false }).deps, "POST", "/api/v1/opportunities/O1/events", { kind: "note", note: "hi there" }))!.status).toBe(503);
    const before = (await readJson((await call(oppWorld({ ready: false }).deps, "GET", "/api/v1/opportunities/O1/timeline"))!)).data;
    expect(before.history_available).toBe(false);
  });

  it("adds follow-ups and marks them done, scoped to the user", async () => {
    const { deps, fake } = oppWorld();
    expect((await call(deps, "POST", "/api/v1/opportunities/O1/events", { kind: "follow_up", note: "Ping", due_date: "2026-11-20" }))!.status).toBe(201);
    await call(deps, "POST", "/api/v1/opportunity-events/E2/done");
    const done = fake.queries.find((q) => q.text.startsWith("UPDATE opportunity_events SET done_at"))!;
    expect(done.values).toEqual(["E2", "f1"]);
  });
});

describe("AI governor policy", () => {
  const live = { enabled: true, status: "live", autonomy_ceiling: "A2", tools_json: '["retrieve:R", "draft:D"]' };
  it("checks switch, build status, tool, autonomy and the caller's role", () => {
    const p = OPERATION_POLICY.proposal_draft;
    expect(policyDecision(p, live, ["freelancer"])).toEqual({ allowed: true });
    expect(policyDecision(p, { ...live, enabled: false }, ["freelancer"]).allowed).toBe(false);
    expect(policyDecision(p, { ...live, status: "planned" }, ["freelancer"]).allowed).toBe(false);
    expect(policyDecision(p, { ...live, tools_json: '["retrieve:R"]' }, ["freelancer"]).allowed).toBe(false);
    expect(policyDecision(p, { ...live, autonomy_ceiling: "A1" }, ["freelancer"]).allowed).toBe(false);
    expect(policyDecision(p, live, ["client"]).allowed).toBe(false);
    expect(policyDecision(OPERATION_POLICY.brief_builder, { ...live, tools_json: '["draft:D"]' }, ["client"]).allowed).toBe(true);
    expect(policyDecision(p, null, null)).toEqual({ allowed: true }); // registry and roles not migrated yet
  });
});

describe("safety validation and fallback", () => {
  it("removes contact details from untrusted input", () => {
    expect(redactContactDetails("Mail jo@acme.com or call +91 98765 43210")).toBe("Mail [email removed] or call [phone removed]");
    expect(sanitizeUntrusted("reach me at jo@acme.com")).toBe("reach me at [email removed]");
  });

  it("blocks invented experience and flags skills the profile does not list", () => {
    const r = reviewGeneratedText("I have 8 years of experience with Stripe and Next.js.", { price: null, allowedLinks: [], profileSkills: ["Next.js"], jobSkills: ["Next.js", "Stripe"] });
    expect(r.blocked).toBe(true);
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["unsupported_claim", "unsupported_skill"]));
    const ok = reviewGeneratedText("I would build it in Next.js and ask about Stripe.", { price: null, allowedLinks: [], profileSkills: ["Next.js"], jobSkills: ["Next.js", "Stripe"] });
    expect(ok.blocked).toBe(false);
  });

  it("builds a usable template from confirmed facts only, turning missing skills into questions", () => {
    const t = safeProposalTemplate({ title: "Bakery site", name: "Asha", headline: "Web developer", profileSkills: ["Next.js"], jobSkills: ["Next.js", "Stripe"], portfolio: ["https://example.dev/a"], price: 30000, currency: "INR" });
    expect(t).toContain("Relevant skills on my profile: Next.js.");
    expect(t).toContain("How important is Stripe");
    expect(t).toContain("30000 INR");
    expect(t).toContain("https://example.dev/a");
    expect(reviewGeneratedText(t, { price: 30000, allowedLinks: ["https://example.dev/a"] }).blocked).toBe(false);
  });
});

describe("finance exceptions and job retries", () => {
  it("finds contracts whose held funds differ from funded payments", () => {
    expect(heldMismatches(
      [{ contract_id: "K1", mode: "sandbox", held: "1000" }, { contract_id: "K2", mode: "sandbox", held: 0 }],
      [{ contract_id: "K1", mode: "sandbox", funded: 1000 }, { contract_id: "K3", mode: "sandbox", funded: "500" }]
    )).toEqual([{ contract_id: "K3", mode: "sandbox", ledger_held_minor: 0, funded_intents_minor: 500 }]);
  });

  function opsWorld(roles: string[], job: Record<string, unknown> | null = null) {
    const fake = createFakeSql((text) => {
      if (text.startsWith("SELECT role, status FROM user_roles")) return roles.map((role) => ({ role, status: "active" }));
      if (text.startsWith("SELECT id, user_id, job_type, status, payload_json")) return job ? [job] : [];
      if (text.startsWith("INSERT INTO background_jobs")) return [{ id: "J2" }];
      if (text.startsWith("UPDATE payment_intents SET status = 'cancelled'")) return [{ id: "I1" }];
      return [];
    });
    const deps: OpsRouteDeps = { database: () => fake.sql, authenticate: async () => session("s1") };
    return { fake, deps };
  }
  const ops = (deps: OpsRouteDeps, method: string, path: string, payload?: unknown) => handleOpsRoute(jsonRequest(method, path, payload), {} as Env, "r", deps);

  it("limits finance views to finance/admin and retries to admins, and logs actions", async () => {
    expect((await ops(opsWorld(["moderator"]).deps, "GET", "/api/v1/admin/finance-exceptions"))!.status).toBe(404);
    expect((await ops(opsWorld(["finance"]).deps, "GET", "/api/v1/admin/finance-exceptions"))!.status).toBe(200);
    expect((await ops(opsWorld(["finance"]).deps, "GET", "/api/v1/admin/jobs"))!.status).toBe(404);
    const fin = opsWorld(["finance"]);
    expect((await ops(fin.deps, "POST", "/api/v1/admin/payments/I1/cancel-checkout", {}))!.status).toBe(200);
    expect(fin.fake.queries.some((q) => q.text.startsWith("INSERT INTO moderation_actions"))).toBe(true);
    expect((await ops(opsWorld(["admin"], { id: "J1", user_id: "u1", job_type: "discovery.refresh", status: "running", payload_json: "{}" }).deps, "POST", "/api/v1/admin/jobs/J1/retry"))!.status).toBe(409);
    expect((await ops(opsWorld(["admin"], { id: "J1", user_id: "u1", job_type: "python.only", status: "dead", payload_json: "{}" }).deps, "POST", "/api/v1/admin/jobs/J1/retry"))!.status).toBe(409);
  });
});
