import { acceptanceChecklist, compareProposals, suggestTerms } from "./assistants";
import { evaluateCandidate } from "./matching";
import { reviewGeneratedText } from "./ai-guard";
import { screenText } from "./listings";
import { groundSuggestions } from "./profile-routes";
import { scoreOpportunity } from "./scoring";
import { templateDraft } from "./brief-builder";
import { safeHttpUrl } from "./core-routes";
import { textSimilarity } from "./fair-proposals";
import evalSet from "./ai-eval/guard-cases.json";
import {
  availabilityFit, balanceAlerts, capacityPlan, freshnessDecision, notificationGroup, profileReview, rankEvidence, riskFindings, ruleAnswer, spendForecast, triageMessage
} from "./agent-complete";
import type { CategoryBalance } from "./agent-complete";

/**
 * P8 Quality and Evaluation (U24): an evaluation set per agent. Each case runs
 * the agent's deterministic part on a fixed input with a known answer. The
 * same sets run in CI (agent-evals.test.ts) and on the admin Agent health page,
 * so a change that breaks an agent's behaviour is caught before and after
 * release. Model-based agents are evaluated on their guard and fallback.
 */

export type EvalCase = { code: string; name: string; ok: boolean; detail: string };

/** Agent functions that live in route files, passed in to avoid import cycles. */
export type EvalHooks = {
  priceAdvice: (i: {
    budget_model: string; budget_min_minor: number | null; budget_max_minor: number | null; deliverables: number; deadline_days: number | null;
    hourly_rate_minor: number | null; minimum_budget_minor: number | null; past_wins_minor: number[]; hours: number | null;
  }) => { available: boolean; low_minor?: number; high_minor?: number; warnings: string[] };
  interviewPrep: (p: {
    brief: { deliverables: string[]; skills: string[]; acceptance_criteria: string[]; budget_min_minor: number | null; budget_max_minor: number | null; deadline: string | null };
    proposal: { price_minor: number; estimated_days: number | null; cover_letter: string; sections: null };
    freelancer_skills: string[]; newcomer: boolean; today: Date;
  }) => Array<{ topic: string }>;
};

export function runEvals(now: Date, hooks: EvalHooks): EvalCase[] {
  const out: EvalCase[] = [];
  const check = (code: string, name: string, fn: () => boolean, detail = "") => {
    try {
      out.push({ code, name, ok: Boolean(fn()), detail });
    } catch (error) {
      out.push({ code, name, ok: false, detail: `Crashed: ${error instanceof Error ? error.message : "unknown"}` });
    }
  };
  const day = (n: number) => new Date(now.getTime() - n * 86_400_000);
  const today = now.toISOString().slice(0, 10);

  /* F1 Opportunity Scout */
  check("F1", "hides an old job no longer seen at the source", () => freshnessDecision({ status: "new", posted_at: day(30), first_seen_at: day(30), last_seen_at: day(10) }, now).stale);
  check("F1", "keeps an old job still seen this week", () => !freshnessDecision({ status: "new", posted_at: day(30), first_seen_at: day(30), last_seen_at: day(1) }, now).stale);
  check("F1", "keeps a recent job", () => !freshnessDecision({ status: "new", posted_at: day(5), first_seen_at: day(5), last_seen_at: day(5) }, now).stale);
  check("F1", "never hides a job the person already drafted", () => !freshnessDecision({ status: "drafted", posted_at: day(60), first_seen_at: day(60), last_seen_at: day(60) }, now).stale);

  /* F2 Fit and Risk */
  const prof = { skills: ["React", "Node.js"], minimum_budget: 100, weekly_hours: 20, dealbreakers: [], preferred_work_types: [], preferred_industries: [] };
  const job = (skills: string[], min: number, max: number) => ({ title: skills.join(" "), description: skills.join(" and "), required_skills: skills, budget_min: min, budget_max: max, deadline: "", job_type: "fixed", industry: "", estimated_hours: 20, competition_level: "low", client_rating: 4.8, client_reviews: 10, client_payment_verified: true });
  check("F2", "a full skill match scores above a mismatch", () => scoreOpportunity(prof, job(["React", "Node.js"], 500, 1000)).score > scoreOpportunity(prof, job(["Rust"], 500, 1000)).score);
  check("F2", "a budget above the minimum scores at least as high as one below it", () => scoreOpportunity({ ...prof, minimum_budget: 400 }, job(["React"], 500, 1000)).score >= scoreOpportunity({ ...prof, minimum_budget: 400 }, job(["React"], 50, 100)).score);
  check("F2", "scores stay between 0 and 100", () => { const s = scoreOpportunity(prof, job(["React", "Node.js"], 500, 1000)).score; return s >= 0 && s <= 100; });

  /* F3 Profile Coach */
  check("F3", "drops skills and projects the resume does not show", () => {
    const g = groundSuggestions({ skills: ["React", "Kubernetes"], projects: [{ title: "Invented app", description: "", skills: [], link: "", year: "" }] }, "I build React apps.");
    return g.kept.skills.length === 1 && g.kept.projects.length === 0;
  });
  const base = { headline: "World-class expert web developer for shops", bio: "", skills: ["React"], portfolio_links: [], projects: [], completed_contracts: 0, reviews: 0, hourly_rate: 0 };
  check("F3", "flags a strong claim with no evidence", () => profileReview(base).items.some((i) => i.field === "headline" && i.severity === "warn"));
  check("F3", "accepts the claim once there is completed work", () => !profileReview({ ...base, completed_contracts: 3, reviews: 2 }).items.some((i) => i.message.includes("strong claim")));
  check("F3", "asks for a link on a portfolio project without one", () => profileReview({ ...base, projects: [{ title: "Shop", description: "Built an online shop with checkout for a bakery in Pune.", skills: ["React"], link: "", year: "2025" }] }).projects[0]?.issues.some((x) => x.includes("link")) === true);
  check("F3", "lists a skill no project shows", () => profileReview({ ...base, skills: ["React", "Kubernetes"], projects: [{ title: "Shop", description: "React shop with checkout for a bakery in Pune, Maharashtra.", skills: ["React"], link: "https://x.dev", year: "2025" }] }).skills_without_evidence.includes("Kubernetes"));

  /* F4 Proposal Agent (model-based): its output guard */
  check("F4", "blocks a draft that shares contact details", () => reviewGeneratedText("Great project! Email me at asha@example.com to start.", { price: null, allowedLinks: [] }).blocked);
  check("F4", "allows a clean draft", () => !reviewGeneratedText("I built a bakery ordering site last year and can start with your order form.", { price: null, allowedLinks: [] }).blocked);
  check("F4", "the AI output guard regression set passes", () => {
    const cases = (evalSet as { cases: Array<{ output: string; price: number | null; links: string[]; block: boolean }> }).cases;
    return cases.every((c) => reviewGeneratedText(c.output, { price: c.price, allowedLinks: c.links }).blocked === c.block);
  });

  /* F5 Pricing */
  const pa = { budget_model: "fixed", budget_min_minor: 2_000_000, budget_max_minor: 4_000_000, deliverables: 2, deadline_days: 30, hourly_rate_minor: 100_000, minimum_budget_minor: 2_500_000, past_wins_minor: [], hours: 30 };
  check("F5", "keeps the range inside the budget and above the minimum", () => { const a = hooks.priceAdvice(pa); return a.available && (a.low_minor ?? 0) >= 2_500_000 && (a.high_minor ?? 0) <= 4_000_000; });
  check("F5", "warns when the budget is below the freelancer's minimum", () => hooks.priceAdvice({ ...pa, budget_min_minor: 500_000, budget_max_minor: 1_000_000 }).warnings.some((w) => w.includes("below your minimum")));
  check("F5", "says when there is not enough information", () => !hooks.priceAdvice({ ...pa, budget_min_minor: null, budget_max_minor: null, hourly_rate_minor: null }).available);

  /* F7 Delivery Planner */
  check("F7", "detects over-booking from hourly contracts", () => capacityPlan({ weekly_hours: 20, hourly: [{ contract_id: "a", title: "A", weekly_limit_hours: 15 }, { contract_id: "b", title: "B", weekly_limit_hours: 10 }], due: [] }, today).status === "over");
  check("F7", "warns about three deadlines in one week", () => capacityPlan({ weekly_hours: 30, hourly: [], due: [0, 0, 0].map((_, i) => ({ date: today, title: `M${i}`, kind: "milestone" as const, contract_id: "k" })) }, today).warnings.some((w) => w.startsWith("3 deadlines")));
  check("F7", "a fully booked freelancer gets no availability points in matching", () => availabilityFit(20, 20).points === 0 && availabilityFit(40, 10).points === 10);

  /* F8 Delivery QA */
  check("F8", "flags a criterion the delivery note does not cover", () => !acceptanceChecklist(["Payment page"], "Built the homepage", []).items[0].mentioned);
  check("F8", "detects a covered criterion", () => acceptanceChecklist(["Order form works"], "The order form works on mobile", []).items[0].mentioned);

  /* F9 Inbox Agent */
  check("F9", "a change request", () => triageMessage("Please add a pickup time picker to the form.").kind === "change_request");
  check("F9", "a meeting request", () => triageMessage("Can we have a call tomorrow at 4?").kind === "scheduling");
  check("F9", "an approval", () => triageMessage("Looks good, approved!").kind === "approval");
  check("F9", "a payment question", () => triageMessage("Has the milestone been funded yet?").kind === "payment");
  check("F9", "a plain update", () => triageMessage("Here is the logo file.").kind === "update");

  /* F11 Business Coach */
  const ev = [
    { id: "profile:1", type: "profile", text: "headline=Web developer" },
    { id: "contract:A", type: "contract", text: "Gym booking site; status=active" },
    { id: "contract:B", type: "contract", text: "Bakery ordering website; status=active" },
    { id: "review:R", type: "review_received", text: "Bakery ordering website; rating=5/5; fast" }
  ];
  check("F11", "ranks the records that match the question first (profile stays)", () => { const r = rankEvidence("How is the bakery project going?", ev); return r[0].id === "profile:1" && ["contract:B", "review:R"].includes(r[1].id) && r.at(-1)?.id === "contract:A"; });
  check("F11", "answers without the model by citing records", () => ruleAnswer("bakery", rankEvidence("bakery", ev)).includes("[contract:B]"));
  check("F11", "says so when nothing matches instead of guessing", () => ruleAnswer("tax filing", rankEvidence("tax filing", ev)).includes("none of your records match"));

  /* C1 Brief Builder (template fallback) */
  check("C1", "template brief has a title and acceptance criteria", () => { const d = templateDraft("We need an online shop for our candles with checkout.", "Website development", { inputs: ["Pages"], stages: ["Design", "Build"], acceptance: ["Checkout works"], default_revisions: 2 }); return d.title.length > 0 && d.acceptance_criteria.length > 0; });

  /* C2 Match and Shortlist */
  const listing = { title: "Bakery website", outcome: "Online orders", description: "", category_slug: "website_development", category_name: "Website", skills: ["Next.js", "Stripe"], budget_model: "fixed", budget_min_minor: 2_000_000, budget_max_minor: 4_000_000, currency: "INR", timezone: "Asia/Kolkata" };
  const cand = { user_id: "u", full_name: "Asha", headline: "Next.js developer", skills: '["Next.js","Stripe"]', services: "[]", minimum_budget: 10000, hourly_rate: 800, currency: "INR", weekly_hours: 20, timezone: "Asia/Kolkata", dealbreakers: "[]", user_created_at: new Date("2025-01-01T00:00:00Z") };
  check("C2", "a full skill match scores 70 or more", () => { const e = evaluateCandidate(listing, cand, now); return e.eligible && e.match.score >= 70; });
  check("C2", "a dealbreaker excludes the freelancer", () => !evaluateCandidate(listing, { ...cand, dealbreakers: '["bakery"]' }, now).eligible);
  check("C2", "a fully booked freelancer scores lower than a free one", () => {
    const free = evaluateCandidate(listing, cand, now);
    const booked = evaluateCandidate(listing, { ...cand, booked_hours: 20 }, now);
    return free.eligible && booked.eligible && booked.match.score < free.match.score && booked.match.reasons.includes("Fully booked at the moment");
  });

  /* C3 Proposal Comparison */
  const cmp = compareProposals(
    { budget_min_minor: 2_000_000, budget_max_minor: 4_000_000, deadline: null, skills: ["Next.js"], deliverables: ["Order form"] },
    [
      { id: "p1", freelancer_name: "A", price_minor: 3_000_000, estimated_days: 10, cover_letter: "Order form in Next.js", skills: ["Next.js"], rating: null, invited: false, created_at: now.toISOString() },
      { id: "p2", freelancer_name: "B", price_minor: 1_000_000, estimated_days: 10, cover_letter: "Cheap", skills: [], rating: null, invited: false, created_at: now.toISOString() }
    ],
    now
  );
  check("C3", "budget fit within and below", () => cmp.rows[0].budget_fit === "within" && cmp.rows[1].budget_fit === "below");
  check("C3", "never ranks: rows keep the order proposals arrived", () => cmp.rows.map((r) => r.proposal_id).join() === "p1,p2");

  /* C4 Interview Preparation */
  check("C4", "asks about scope, skills, price and acceptance gaps", () => {
    const q = hooks.interviewPrep({ brief: { deliverables: ["Payment page"], skills: ["Stripe"], acceptance_criteria: [], budget_min_minor: null, budget_max_minor: 1_000_000, deadline: null }, proposal: { price_minor: 2_000_000, estimated_days: null, cover_letter: "I will build the homepage", sections: null }, freelancer_skills: [], newcomer: false, today: now });
    const topics = new Set(q.map((x) => x.topic));
    return ["Scope", "Skills", "Price", "Acceptance"].every((t) => topics.has(t));
  });

  /* C5 Contract and Milestone Assistant */
  check("C5", "milestones add up exactly to the price", () => suggestTerms({ title: "Site", deliverables: ["Site"], milestone_titles: ["Design", "Build"], acceptance_criteria: ["Works"], revision_rounds: 1, ownership_notes: "", deadline: null, price_minor: 10_001 }, now).terms.milestones.reduce((s, m) => s + m.amount_minor, 0) === 10_001);
  check("C5", "three milestones also add up exactly", () => suggestTerms({ title: "Site", deliverables: ["Site"], milestone_titles: ["A", "B", "C"], acceptance_criteria: ["Works"], revision_rounds: 1, ownership_notes: "", deadline: null, price_minor: 2_500_001 }, now).terms.milestones.reduce((s, m) => s + m.amount_minor, 0) === 2_500_001);

  /* C6 Review and Acceptance */
  check("C6", "every criterion gets a line", () => acceptanceChecklist(["Order form works", "Mobile layout"], "The order form works", []).items.length === 2);

  /* C7 Spend and Outcomes */
  const month = today.slice(0, 7);
  const f = spendForecast(
    [
      { contract_id: "k", title: "Site", milestone: "Design", amount_minor: 1_000_000, due_date: `${month}-28`, state: "unfunded" },
      { contract_id: "k", title: "Site", milestone: "Build", amount_minor: 2_000_000, due_date: null, state: "unfunded" },
      { contract_id: "k", title: "Site", milestone: "Old", amount_minor: 500_000, due_date: null, state: "held" }
    ],
    [{ contract_id: "h", title: "Support", hourly_rate_minor: 120_000, weekly_limit_hours: 5 }],
    500, today
  );
  check("C7", "adds the 5% client fee to the month the milestone is due", () => f.months[0].amount_minor === 1_000_000 && f.months[0].fee_minor === 50_000);
  check("C7", "keeps undated milestones and held money separate", () => f.undated.amount_minor === 2_000_000 && f.held_minor === 500_000 && f.remaining_fixed_minor === 3_000_000);
  check("C7", "hourly weekly maximum is rate × limit", () => f.hourly_weekly_max_minor === 600_000);

  /* P1 Trust and Safety */
  check("P1", "flags upfront fees and contact details; clean text passes", () => screenText("Pay a registration fee first and WhatsApp me on +91 98765 43210").length >= 2 && screenText("Build a bakery website with an order form").length === 0);
  check("P1", "three attempts are a medium signal, five are high, two are none", () => {
    const r = riskFindings({ attempts: [{ user_id: "a", contact: 3, payment: 0, last_at: today }, { user_id: "b", contact: 5, payment: 0, last_at: today }, { user_id: "c", contact: 2, payment: 0, last_at: today }], circular: [], ownTeam: [], oneAndDone: [], troubled: [] });
    return r.length === 2 && r[0].user_ids[0] === "b" && r[0].severity === "high" && r[1].severity === "medium";
  });
  check("P1", "circular hiring is high severity", () => riskFindings({ attempts: [], circular: [{ user_a: "a", user_b: "b", contract_a: "1", contract_b: "2" }], ownTeam: [], oneAndDone: [], troubled: [] })[0]?.severity === "high");

  /* P5 Source Compliance */
  check("P5", "takedown and terms links must be http(s)", () => safeHttpUrl("javascript:alert(1)") === "" && safeHttpUrl("https://example.com/job/1") === "https://example.com/job/1");

  /* P7 Marketplace Balance */
  const row = (o: Partial<CategoryBalance>): CategoryBalance => ({ slug: "web", name: "Web", enabled: true, open_projects: 0, waiting_projects: 0, proposals_30d: 0, freelancers_90d: 0, services_live: 0, ...o });
  check("P7", "projects without proposals after 3 days raise an alert", () => balanceAlerts([row({ open_projects: 4, waiting_projects: 3, freelancers_90d: 2 })], 5).some((a) => a.kind === "waiting_projects" && a.severity === "high"));
  check("P7", "no supply in a category with open projects", () => balanceAlerts([row({ open_projects: 2 })], 5).some((a) => a.kind === "no_supply"));
  check("P7", "a balanced category raises nothing", () => balanceAlerts([row({ open_projects: 3, proposals_30d: 15, freelancers_90d: 6 })], 5).length === 0);

  /* P8 Quality: the near-duplicate gate */
  check("P8", "the copied-proposal check catches a copy and passes original text", () => textSimilarity("I built an ordering site for a bakery and can start Monday.", "I built an ordering site for a bakery and can start Monday!") === 1 && textSimilarity("Bakery ordering site", "Gym booking app with payments") < 0.2);

  /* P9 Notification Orchestrator */
  check("P9", "groups notifications for settings", () => notificationGroup("proposal.received") === "proposals" && notificationGroup("milestone.released") === "payments" && notificationGroup("milestone.submitted") === "work" && notificationGroup("jobs.daily_digest") === "alerts");
  check("P9", "account and safety notices can never be muted", () => notificationGroup("account.suspended") === "account" && notificationGroup("dispute.opened") === "account" && notificationGroup("something.new") === "account");

  return out;
}

/** Pass counts per agent code. Pure. */
export function evalSummary(cases: EvalCase[]): Record<string, { cases: number; passed: number; failed: string[] }> {
  const out: Record<string, { cases: number; passed: number; failed: string[] }> = {};
  for (const c of cases) {
    const s = (out[c.code] ??= { cases: 0, passed: 0, failed: [] });
    s.cases += 1;
    if (c.ok) s.passed += 1;
    else s.failed.push(c.name);
  }
  return out;
}
