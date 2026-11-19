import type { Env } from "../types";
import { evalSummary, runEvals } from "./agent-evals";
import type { AuthenticatedSession } from "./session-service";
import { authenticateRequest } from "./auth-context";
import { body, database, jsonList, safeHttpUrl } from "./core-routes";
import type { Queryable, Sql } from "./core-routes";
import { failure, success } from "./response";
import { agentEnabled } from "./agents";
import { loadRoles, organizationForMember } from "./identity";
import { versionOut } from "./listings";
import type { VersionRow } from "./listings";
import { contractVersionOut } from "./contracts";
import type { ContractRow, ContractVersionRow } from "./contracts";
import { acceptanceChecklist, compareProposals, coverage, suggestTerms } from "./assistants";
import { parseSections } from "./proposal-studio";
import type { ProposalSections } from "./proposal-studio";
import { evaluateCandidate, normaliseSkill } from "./matching";
import { reviewGeneratedText } from "./ai-guard";
import { screenText } from "./listings";
import { groundSuggestions, skillsInText } from "./profile-routes";
import evalSet from "./ai-eval/guard-cases.json";
import { scoreOpportunity } from "./scoring";
import { templateDraft } from "./brief-builder";

/**
 * Deterministic agents added in U20 and the agent health check.
 *
 *   GET  /api/v1/marketplace/listings/{id}/price-advice?hours=   F5 Pricing and Scope (freelancer; advisory only)
 *   POST /api/v1/contracts/{id}/milestones/{i}/precheck          F8 Delivery QA (freelancer, before delivering)
 *   GET  /api/v1/listing-proposals/{id}/interview-prep           C4 Interview Preparation (client organisation)
 *   GET  /api/v1/admin/agents/health                             staff: per-agent activity + self-tests
 *
 * None of these calls a model or moves money: the numbers and questions come
 * from fixed rules over the user's own records, and the person decides.
 */

export interface AgentToolDeps {
  database: (env: Env) => Sql;
  authenticate: (request: Request, env: Env, requestId: string) => Promise<AuthenticatedSession | Response>;
  now: () => Date;
}

const defaultDeps: AgentToolDeps = { database, authenticate: authenticateRequest, now: () => new Date() };

async function recordRun(sql: Queryable, userId: string, name: string, summary: string): Promise<void> {
  await sql`
    INSERT INTO agent_runs (id, user_id, agent_name, status, summary, created_at)
    VALUES (${crypto.randomUUID()}, ${userId}, ${name}, 'completed', ${summary.slice(0, 500)}, now())
  `.catch(() => undefined);
}

/* ------------------------------------------------------------------ */
/* F5 Pricing and Scope (pure)                                         */
/* ------------------------------------------------------------------ */

export type PriceInput = {
  budget_model: string; budget_min_minor: number | null; budget_max_minor: number | null; deliverables: number; deadline_days: number | null;
  hourly_rate_minor: number | null; minimum_budget_minor: number | null; past_wins_minor: number[]; hours: number | null;
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const round100 = (n: number) => Math.round(n / 10000) * 10000; // whole ₹100

/**
 * An advisory price range with every reason shown. Anchors: the client's
 * budget, the freelancer's own minimum, their rate × the hours they estimate,
 * and the median of their own past winning prices. Never a recommendation to
 * bid below their stated minimum. Pure.
 */
export function priceAdvice(i: PriceInput) {
  const basis: string[] = [];
  const warnings: string[] = [];
  const anchors: number[] = [];
  if (i.budget_model === "hourly") {
    basis.push("The client pays by the hour: quote your hourly rate; the weekly limit is set in the offer.");
  }
  const rateTotal = i.hourly_rate_minor && i.hours ? i.hourly_rate_minor * i.hours : null;
  if (rateTotal) { anchors.push(rateTotal); basis.push(`Your rate × ${i.hours} estimated hours.`); }
  const wins = median(i.past_wins_minor);
  if (wins) { anchors.push(wins); basis.push(`Median of your ${i.past_wins_minor.length} hired proposal${i.past_wins_minor.length === 1 ? "" : "s"} in this category.`); }
  if (i.budget_min_minor || i.budget_max_minor) basis.push("The client's stated budget range.");
  let low: number;
  let high: number;
  if (i.budget_min_minor !== null || i.budget_max_minor !== null) {
    const bmin = i.budget_min_minor ?? Math.round((i.budget_max_minor as number) * 0.7);
    const bmax = i.budget_max_minor ?? Math.round((i.budget_min_minor as number) * 1.3);
    const own = anchors.length ? Math.round(anchors.reduce((a, b) => a + b, 0) / anchors.length) : null;
    low = own ? Math.max(bmin, Math.min(own, bmax)) : bmin;
    high = own ? Math.min(bmax, Math.max(own, bmin) * 1.15) : bmax;
    if (high < low) high = low;
    if (own && own > bmax) warnings.push("Your usual price for this work is above the client's budget: explain the value or reduce the scope.");
  } else if (anchors.length) {
    const own = Math.round(anchors.reduce((a, b) => a + b, 0) / anchors.length);
    low = Math.round(own * 0.9);
    high = Math.round(own * 1.15);
  } else {
    return {
      available: false as const,
      basis,
      warnings: ["Not enough information: the client gave no budget. Add your hourly rate on your profile and enter the hours you expect."],
      assumptions: [], exclusions: [], note: "Advisory only. You set the price."
    };
  }
  if (i.minimum_budget_minor && high < i.minimum_budget_minor) warnings.push("This range is below your minimum project budget. Consider skipping this project.");
  if (i.minimum_budget_minor && low < i.minimum_budget_minor) { low = Math.min(i.minimum_budget_minor, high); basis.push("Raised to your minimum project budget."); }
  const assumptions = [
    "Content (text, images, logins) is provided by the client before work starts.",
    ...(i.deadline_days !== null && i.deadline_days < 14 ? ["The short deadline needs quick feedback from the client (within 1 working day)."] : []),
    `Covers the ${i.deliverables || "listed"} deliverable${i.deliverables === 1 ? "" : "s"} in the brief.`
  ];
  const exclusions = ["Paid third-party tools, hosting or licences.", "Work outside the brief (quoted separately as a change order)."];
  return {
    available: true as const,
    low_minor: round100(low),
    high_minor: round100(Math.max(high, low)),
    basis, warnings, assumptions, exclusions,
    note: "Advisory only, from your own records and the brief. You set the price; nothing is sent."
  };
}

/* ------------------------------------------------------------------ */
/* C4 Interview Preparation (pure)                                     */
/* ------------------------------------------------------------------ */

export type PrepInput = {
  brief: { deliverables: string[]; skills: string[]; acceptance_criteria: string[]; budget_min_minor: number | null; budget_max_minor: number | null; deadline: string | null };
  proposal: { price_minor: number; estimated_days: number | null; cover_letter: string; sections: ProposalSections | null };
  freelancer_skills: string[];
  newcomer: boolean;
  today: Date;
};

/** Questions a client can ask in the interview, each with the reason it came up. Pure. */
export function interviewPrep(p: PrepInput): Array<{ topic: string; question: string; why: string }> {
  const out: Array<{ topic: string; question: string; why: string }> = [];
  const text = [p.proposal.cover_letter, p.proposal.sections?.approach ?? "", p.proposal.sections?.understanding ?? "", ...(p.proposal.sections?.deliverables ?? [])].join("\n");
  for (const d of p.brief.deliverables) {
    if (coverage(d, text).ratio < 0.5) out.push({ topic: "Scope", question: `How will you deliver "${d}"?`, why: "The proposal does not mention this deliverable." });
  }
  const have = new Set(p.freelancer_skills.map(normaliseSkill));
  const missing = p.brief.skills.filter((s) => !have.has(normaliseSkill(s)));
  if (missing.length) out.push({ topic: "Skills", question: `Can you show past work using ${missing.slice(0, 3).join(", ")}?`, why: "These skills are in your brief but not on the freelancer's profile." });
  if (p.brief.budget_max_minor !== null && p.proposal.price_minor > p.brief.budget_max_minor) out.push({ topic: "Price", question: "Your price is above our budget: which parts could be simplified or phased?", why: "The proposal is above the budget you set." });
  if (p.brief.budget_min_minor !== null && p.proposal.price_minor < p.brief.budget_min_minor * 0.6) out.push({ topic: "Price", question: "Your price is well below our budget: what is included, and what is not?", why: "A very low price can mean a different scope." });
  if (p.brief.deadline && p.proposal.estimated_days !== null) {
    const days = Math.ceil((Date.parse(`${p.brief.deadline}T00:00:00Z`) - p.today.getTime()) / 86_400_000);
    if (p.proposal.estimated_days > days) out.push({ topic: "Timeline", question: `You estimate ${p.proposal.estimated_days} days; we need it in ${Math.max(days, 0)}. What can be ready by then?`, why: "The estimate is longer than your deadline." });
  }
  for (const a of p.proposal.sections?.assumptions ?? []) out.push({ topic: "Assumptions", question: `Confirm: "${a}"`, why: "The freelancer's price depends on this assumption." });
  for (const e of p.proposal.sections?.exclusions ?? []) out.push({ topic: "Exclusions", question: `"${e}" is excluded: do we need it, and what would it cost?`, why: "Excluded work often becomes a change order." });
  for (const q of p.proposal.sections?.questions ?? []) out.push({ topic: "Their questions", question: q, why: "The freelancer asked this; answering it early avoids delays." });
  if (!(p.proposal.sections?.evidence ?? []).length) out.push({ topic: "Evidence", question: "Which past project is most like ours? Can you share a link?", why: "The proposal links no portfolio evidence." });
  if (p.newcomer) out.push({ topic: "Working style", question: "How will you keep us updated, and how often?", why: "The freelancer is new on this marketplace, so there are no reviews yet." });
  if (p.brief.acceptance_criteria.length === 0) out.push({ topic: "Acceptance", question: "How should we check the work is finished?", why: "Your brief has no acceptance criteria yet: agree them before the offer." });
  return out.slice(0, 15);
}

/* ------------------------------------------------------------------ */
/* Self-tests for the agent health check (pure, fixed fixtures)        */
/* ------------------------------------------------------------------ */

type Check = { code: string; ok: boolean; detail: string };

/** Runs every deterministic agent on fixed inputs with known answers. Pure. */
export function selfTests(now: Date): Check[] {
  const checks: Check[] = [];
  const run = (code: string, fn: () => [boolean, string]) => {
    try {
      const [ok, detail] = fn();
      checks.push({ code, ok, detail });
    } catch (error) {
      checks.push({ code, ok: false, detail: `Crashed: ${error instanceof Error ? error.message : "unknown"}` });
    }
  };
  const listing = { title: "Bakery website", outcome: "Online orders", description: "", category_slug: "website_development", category_name: "Website", skills: ["Next.js", "Stripe"], budget_model: "fixed", budget_min_minor: 2_000_000, budget_max_minor: 4_000_000, currency: "INR", timezone: "Asia/Kolkata" };
  const candidate = { user_id: "u", full_name: "Asha", headline: "Next.js developer", skills: '["Next.js","Stripe"]', services: "[]", minimum_budget: 10000, hourly_rate: 800, currency: "INR", weekly_hours: 20, timezone: "Asia/Kolkata", dealbreakers: "[]", user_created_at: new Date("2025-01-01T00:00:00Z") };
  run("C2", () => { const e = evaluateCandidate(listing, candidate, now); return [e.eligible && e.match.score >= 70, `Match score ${e.eligible ? e.match.score : "not eligible"} for a full skill match (expected ≥ 70).`]; });
  run("C3", () => {
    const r = compareProposals(
      { budget_min_minor: 2_000_000, budget_max_minor: 4_000_000, deadline: null, skills: ["Next.js"], deliverables: ["Order form"] },
      [{ id: "p", freelancer_name: "A", price_minor: 3_000_000, estimated_days: 10, cover_letter: "Order form in Next.js", skills: ["Next.js"], rating: null, invited: false, created_at: now.toISOString() }],
      now
    );
    return [r.rows.length === 1 && r.rows[0].budget_fit === "within", `Budget fit "${r.rows[0]?.budget_fit}" (expected "within").`];
  });
  run("C5", () => {
    const r = suggestTerms({ title: "Site", deliverables: ["Site"], milestone_titles: ["Design", "Build"], acceptance_criteria: ["Works"], revision_rounds: 1, ownership_notes: "", deadline: null, price_minor: 10_001 }, now);
    const sum = r.terms.milestones.reduce((s, m) => s + m.amount_minor, 0);
    return [sum === 10_001, `Milestones add up to ${sum} (expected 10001, exact split).`];
  });
  run("C6", () => { const r = acceptanceChecklist(["Order form works"], "The order form works on mobile", []); return [r.items[0].mentioned, "Criterion mentioned in the delivery note is detected."]; });
  run("F8", () => { const r = acceptanceChecklist(["Payment page"], "Built the homepage", []); return [!r.items[0].mentioned, "Missing criterion is flagged before delivery."]; });
  run("F3", () => {
    const g = groundSuggestions({ skills: ["React", "Kubernetes"], projects: [{ title: "Invented app", description: "", skills: [], link: "", year: "" }] }, "I build React apps.");
    return [g.kept.skills.length === 1 && g.kept.projects.length === 0 && skillsInText("Python and SQL").length === 2, "Unsupported skills and projects are dropped; vocabulary reading works."];
  });
  run("F5", () => {
    const a = priceAdvice({ budget_model: "fixed", budget_min_minor: 2_000_000, budget_max_minor: 4_000_000, deliverables: 2, deadline_days: 30, hourly_rate_minor: 100_000, minimum_budget_minor: 2_500_000, past_wins_minor: [], hours: 30 });
    return [a.available && a.low_minor >= 2_500_000 && a.high_minor <= 4_000_000, a.available ? `Range ₹${a.low_minor / 100}–₹${a.high_minor / 100} within the budget and above the minimum.` : "No range."];
  });
  run("C4", () => {
    const q = interviewPrep({ brief: { deliverables: ["Payment page"], skills: ["Stripe"], acceptance_criteria: [], budget_min_minor: null, budget_max_minor: 1_000_000, deadline: null }, proposal: { price_minor: 2_000_000, estimated_days: null, cover_letter: "I will build the homepage", sections: null }, freelancer_skills: [], newcomer: false, today: now });
    const topics = new Set(q.map((x) => x.topic));
    return [["Scope", "Skills", "Price", "Acceptance"].every((t) => topics.has(t)), `Topics found: ${[...topics].join(", ")}.`];
  });
  run("F2", () => {
    const strong = scoreOpportunity(
      { skills: ["React", "Node.js"], minimum_budget: 100, weekly_hours: 20, dealbreakers: [], preferred_work_types: [], preferred_industries: [] },
      { title: "React app", description: "React and Node.js", required_skills: ["React", "Node.js"], budget_min: 500, budget_max: 1000, deadline: "", job_type: "fixed", industry: "", estimated_hours: 20, competition_level: "low", client_rating: 4.8, client_reviews: 10, client_payment_verified: true }
    ).score;
    const weak = scoreOpportunity(
      { skills: ["React"], minimum_budget: 5000, weekly_hours: 20, dealbreakers: [], preferred_work_types: [], preferred_industries: [] },
      { title: "Rust", description: "Rust compiler work", required_skills: ["Rust"], budget_min: 50, budget_max: 100, deadline: "", job_type: "fixed", industry: "", estimated_hours: 20, competition_level: "high", client_rating: null, client_reviews: null, client_payment_verified: false }
    ).score;
    return [strong > weak, `Full match scores ${strong}, poor match ${weak} (expected higher for the full match).`];
  });
  run("C1", () => {
    const d = templateDraft("We need an online shop for our candles with checkout.", "Website development", { inputs: ["Pages"], stages: ["Design", "Build"], acceptance: ["Checkout works"], default_revisions: 2 });
    return [d.title.length > 0 && d.acceptance_criteria.length > 0, "Template brief (used when the AI is unavailable) has a title and acceptance criteria."];
  });
  run("P1", () => {
    const bad = screenText("Pay a registration fee first and WhatsApp me on +91 98765 43210").map((f) => f.code);
    const good = screenText("Build a bakery website with an order form").length;
    return [bad.length >= 2 && good === 0, `Flagged ${bad.join(", ")}; clean text passed.`];
  });
  run("P8", () => {
    const cases = (evalSet as { cases: Array<{ output: string; price: number | null; links: string[]; block: boolean }> }).cases;
    let correct = 0;
    for (const c of cases) {
      const r = reviewGeneratedText(c.output, { price: c.price, allowedLinks: c.links });
      if (r.blocked === c.block) correct += 1;
    }
    return [correct === cases.length, `AI output guard regression set: ${correct}/${cases.length} correct.`];
  });
  return checks;
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

export async function handleAgentToolRoute(request: Request, env: Env, requestId: string, deps: AgentToolDeps = defaultDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const price = path.match(/^\/api\/v1\/marketplace\/listings\/([\w-]{1,64})\/price-advice$/);
  const precheck = path.match(/^\/api\/v1\/contracts\/([\w-]{1,64})\/milestones\/(\d{1,2})\/precheck$/);
  const prep = path.match(/^\/api\/v1\/listing-proposals\/([\w-]{1,64})\/interview-prep$/);
  const health = path === "/api/v1/admin/agents/health";
  const known = (price && method === "GET") || (precheck && method === "POST") || (prep && method === "GET") || (health && method === "GET");
  if (!known) return null;
  const auth = await deps.authenticate(request, env, requestId);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  const sql = deps.database(env);
  try {
    const now = deps.now();

    /* ---------------- health ---------------- */
    if (health) {
      const roles = await loadRoles(sql, userId);
      if (!roles.includes("admin") && !roles.includes("moderator")) return failure("NOT_FOUND", "Not found", 404, requestId);
      const agents = await sql<Array<{ code: string; name: string; status: string; enabled: boolean; runtime_names_json: string }>>`
        SELECT code, name, status, enabled, runtime_names_json FROM agent_definitions ORDER BY code
      `.catch(() => []);
      const runs = await sql<Array<{ agent_name: string; runs: number; failed: number; last_at: Date | null }>>`
        SELECT agent_name, count(*)::int AS runs, count(*) FILTER (WHERE status IN ('failed', 'error'))::int AS failed, max(created_at) AS last_at
        FROM agent_runs WHERE created_at > now() - interval '7 days' GROUP BY agent_name
      `.catch(() => []);
      const ai = await sql<Array<{ operation: string; calls: number }>>`
        SELECT operation, count(*)::int AS calls FROM ai_usage_events WHERE created_at > now() - interval '7 days' GROUP BY operation
      `.catch(() => []);
      const tests = selfTests(now);
      // P8 (U24): the per-agent evaluation sets, also run in CI.
      const evals = evalSummary(runEvals(now, { priceAdvice, interviewPrep }));
      // ?live=1 (admin): one tiny model call to prove the AI provider answers. Costs one small call.
      let liveModel: { ok: boolean; ms: number; detail: string } | null = null;
      if (url.searchParams.get("live") === "1" && roles.includes("admin")) {
        const started = Date.now();
        try {
          if (!env.AI) throw new Error("No AI binding on this Worker.");
          const out = (await env.AI.run(env.WORKERS_AI_MODEL || "@cf/meta/llama-3.1-8b-instruct", {
            messages: [{ role: "user", content: "Reply with the single word OK." }], max_tokens: 5
          })) as { response?: string } | null;
          const text = String(out?.response ?? "").trim();
          liveModel = { ok: text.length > 0, ms: Date.now() - started, detail: text ? `Model answered: "${text.slice(0, 20)}"` : "Model returned an empty answer." };
        } catch (error) {
          liveModel = { ok: false, ms: Date.now() - started, detail: error instanceof Error ? error.message : "Model call failed." };
        }
      }
      const byName = new Map(runs.map((r) => [r.agent_name, r]));
      const items = agents.map((a) => {
        const names = jsonList(a.runtime_names_json);
        const r = names.map((n) => byName.get(n)).filter((x): x is NonNullable<typeof x> => Boolean(x));
        const test = tests.find((t) => t.code === a.code) ?? null;
        const last = r.map((x) => x.last_at).filter(Boolean).sort().pop() ?? null;
        return {
          code: a.code, name: a.name, status: a.status, enabled: a.enabled,
          runs_7d: r.reduce((n, x) => n + Number(x.runs), 0), failed_7d: r.reduce((n, x) => n + Number(x.failed), 0),
          last_run_at: last ? new Date(last).toISOString() : null,
          self_test: test ? { ok: test.ok, detail: test.detail } : null,
          evaluation: evals[a.code] ?? null,
          verdict: !a.enabled ? "switched_off"
            : (test && !test.ok) || (evals[a.code] && evals[a.code].failed.length) ? "failing"
            : ["planned", "blocked"].includes(a.status) ? a.status
            : test?.ok || evals[a.code] ? "working" : "no_test"
        };
      });
      return success(
        {
          ai_provider: { configured: Boolean(env.AI), model: env.WORKERS_AI_MODEL || "@cf/meta/llama-3.1-8b-instruct", calls_7d: ai.reduce((n, x) => n + Number(x.calls), 0), by_operation: ai, live_check: liveModel },
          items,
          passed: tests.filter((t) => t.ok).length, total: tests.length,
          evaluation: { cases: Object.values(evals).reduce((n, e) => n + e.cases, 0), passed: Object.values(evals).reduce((n, e) => n + e.passed, 0), agents: Object.keys(evals).length },
          note: "Self-tests run each rules-based agent on fixed examples with known answers. Model-based agents (F4, F9, F11, C1, F3 extraction) also need the AI provider; their fallbacks are tested here."
        },
        "Agent health", 200, requestId
      );
    }

    /* ---------------- F5 price advice ---------------- */
    if (price) {
      if (!(await agentEnabled(sql, "F5"))) return failure("AGENT_DISABLED", "Price advice is switched off by the platform.", 403, requestId);
      const rows = await sql<(VersionRow & { visibility: string; status: string; is_member: boolean; invited: boolean })[]>`
        SELECT v.*, l.visibility, l.status,
               EXISTS (SELECT 1 FROM organization_memberships m WHERE m.organization_id = l.organization_id AND m.user_id = ${userId} AND m.status = 'active') AS is_member,
               EXISTS (SELECT 1 FROM listing_invitations i WHERE i.listing_id = l.id AND i.freelancer_user_id = ${userId} AND i.status IN ('pending', 'accepted')) AS invited
        FROM project_listings l JOIN project_listing_versions v ON v.listing_id = l.id AND v.version = l.current_version
        JOIN organizations o ON o.id = l.organization_id
        WHERE l.id = ${price[1]} AND o.status = 'active' LIMIT 1
      `;
      const row = rows[0];
      if (!row || row.is_member || (row.visibility !== "public" && !row.invited) || !["published", "hiring"].includes(row.status)) return failure("NOT_FOUND", "Project not found", 404, requestId);
      const brief = versionOut(row);
      const profile = (await sql<Array<{ hourly_rate: number | null; minimum_budget: number | null }>>`SELECT hourly_rate, minimum_budget FROM profiles WHERE user_id = ${userId} LIMIT 1`)[0];
      const wins = await sql<Array<{ price_minor: string | number }>>`
        SELECT p.price_minor FROM listing_proposals p JOIN project_listings l ON l.id = p.listing_id
        WHERE p.freelancer_user_id = ${userId} AND p.status = 'hired' AND l.category_slug = ${brief.category_slug} ORDER BY p.created_at DESC LIMIT 20
      `;
      const hoursRaw = Number(url.searchParams.get("hours"));
      const hours = Number.isInteger(hoursRaw) && hoursRaw >= 1 && hoursRaw <= 2000 ? hoursRaw : null;
      const deadlineDays = brief.deadline ? Math.ceil((Date.parse(`${brief.deadline}T00:00:00Z`) - now.getTime()) / 86_400_000) : null;
      // Profile money fields are whole rupees.
      const advice = priceAdvice({
        budget_model: brief.budget_model, budget_min_minor: brief.budget_min_minor, budget_max_minor: brief.budget_max_minor,
        deliverables: brief.deliverables.length, deadline_days: deadlineDays,
        hourly_rate_minor: profile?.hourly_rate ? Math.round(Number(profile.hourly_rate) * 100) : null,
        minimum_budget_minor: profile?.minimum_budget ? Math.round(Number(profile.minimum_budget) * 100) : null,
        past_wins_minor: wins.map((w) => Number(w.price_minor)), hours
      });
      await recordRun(sql, userId, "pricing_advice", advice.available ? `Advised ₹${advice.low_minor / 100}–₹${advice.high_minor / 100} for project ${price[1]}` : `No price range for project ${price[1]}: not enough information`);
      return success(advice, "Price advice", 200, requestId);
    }

    /* ---------------- F8 delivery precheck ---------------- */
    if (precheck) {
      if (!(await agentEnabled(sql, "F8"))) return failure("AGENT_DISABLED", "The delivery check is switched off by the platform.", 403, requestId);
      const contract = (await sql<ContractRow[]>`SELECT * FROM contracts WHERE id = ${precheck[1]} LIMIT 1`)[0];
      if (!contract || contract.freelancer_user_id !== userId) return failure("NOT_FOUND", "Contract not found", 404, requestId);
      const version = (await sql<ContractVersionRow[]>`
        SELECT * FROM contract_versions WHERE contract_id = ${contract.id} AND version = ${contract.agreed_version ?? contract.current_version} LIMIT 1
      `)[0];
      const terms = version ? contractVersionOut(version) : null;
      const index = Number(precheck[2]);
      if (!terms || index >= terms.milestones.length) return failure("NOT_FOUND", "Milestone not found", 404, requestId);
      const payload = (await body(request)) ?? {};
      const note = typeof payload.note === "string" ? payload.note.slice(0, 5000) : "";
      const links = (Array.isArray(payload.links) ? payload.links : []).map((l) => safeHttpUrl(l, 500)).filter(Boolean).slice(0, 10);
      const criteria = terms.acceptance_criteria;
      const result = acceptanceChecklist(criteria, note, links);
      const deliverables = terms.deliverables.map((d) => ({ deliverable: d, mentioned: coverage(d, `${note}\n${links.join(" ")}`).ratio >= 0.5 }));
      const tips = [
        ...(links.length === 0 ? ["Add a link the client can open (staging site, file, design)."] : []),
        ...(note.trim().length < 40 ? ["Explain what you delivered and how to check it in a few sentences."] : []),
        ...result.items.filter((x) => !x.mentioned).map((x) => `Say how "${x.criterion}" is met.`)
      ];
      await recordRun(sql, userId, "delivery_qa", `Pre-checked milestone ${index + 1} of contract ${contract.id}: ${result.items.filter((x) => x.mentioned).length}/${result.items.length} criteria mentioned`);
      return success({ milestone: index, title: terms.milestones[index].title, ...result, deliverables, tips, ready: tips.length === 0 }, "Delivery check", 200, requestId);
    }

    /* ---------------- C4 interview prep ---------------- */
    if (!(await agentEnabled(sql, "C4"))) return failure("AGENT_DISABLED", "Interview preparation is switched off by the platform.", 403, requestId);
    const proposal = (await sql<Array<{ id: string; listing_id: string; freelancer_user_id: string; price_minor: string | number; estimated_days: number | null; cover_letter: string; status: string; sections_json: unknown; user_created_at: Date; skills: string | null }>>`
      SELECT p.id, p.listing_id, p.freelancer_user_id, p.price_minor, p.estimated_days, p.cover_letter, p.status,
             to_jsonb(p)->'sections_json' AS sections_json, u.created_at AS user_created_at, pr.skills
      FROM listing_proposals p JOIN users u ON u.id = p.freelancer_user_id LEFT JOIN profiles pr ON pr.user_id = p.freelancer_user_id
      WHERE p.id = ${prep![1]} LIMIT 1
    `)[0];
    const listing = proposal ? (await sql<Array<{ organization_id: string; current_version: number }>>`SELECT organization_id, current_version FROM project_listings WHERE id = ${proposal.listing_id} LIMIT 1`)[0] : undefined;
    const org = listing ? await organizationForMember(sql, userId, listing.organization_id) : null;
    if (!proposal || !listing || !org || proposal.status === "withdrawn") return failure("NOT_FOUND", "Proposal not found", 404, requestId);
    const version = (await sql<VersionRow[]>`SELECT * FROM project_listing_versions WHERE listing_id = ${proposal.listing_id} AND version = ${listing.current_version} LIMIT 1`)[0];
    if (!version) return failure("NOT_FOUND", "Proposal not found", 404, requestId);
    const brief = versionOut(version);
    const questions = interviewPrep({
      brief: { deliverables: brief.deliverables, skills: brief.skills, acceptance_criteria: brief.acceptance_criteria, budget_min_minor: brief.budget_min_minor, budget_max_minor: brief.budget_max_minor, deadline: brief.deadline },
      proposal: { price_minor: Number(proposal.price_minor), estimated_days: proposal.estimated_days, cover_letter: proposal.cover_letter, sections: parseSections(proposal.sections_json) },
      freelancer_skills: jsonList(proposal.skills),
      newcomer: now.getTime() - new Date(proposal.user_created_at).getTime() < 30 * 86_400_000,
      today: now
    });
    await recordRun(sql, userId, "interview_prep", `Prepared ${questions.length} interview questions for proposal ${proposal.id}`);
    return success({ questions, note: "Suggested from the brief and the proposal. Ask what matters to you; nothing is sent." }, "Interview questions", 200, requestId);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
