import type { Queryable } from "./core-routes";
import { jsonList } from "./core-routes";
import { screenText } from "./listings";
import { rankEvidence } from "./proposal-studio";

/**
 * External opportunity lifecycle (U8), deterministic and testable.
 *
 * External jobs are applied for on the original site (or by an authorised
 * integration); their contract and payment happen there. This platform keeps
 * one project-centric record per job: analysis, proposal versions, approvals,
 * submissions, follow-ups, interviews and the outcome.
 *
 *   new ──draft──▶ drafted ──approve──▶ ready ──submit──▶ applied ──▶ replied ──▶ interview ──▶ offer ──▶ won
 *    │               │                    │                 └──────────┴────────────┴────────────┴──▶ lost / withdrawn
 *    └──────────────┴────────────────────┴──▶ skipped ──reopen──▶ new
 *
 * `drafted` and `ready` are set only by the system (a draft was created, the
 * exact text was approved). `applied` needs an approved proposal and records a
 * submission. Terminal: won, lost, withdrawn.
 */

export const EXTERNAL_STATUSES = ["new", "drafted", "ready", "applied", "replied", "interview", "offer", "won", "lost", "withdrawn", "skipped"] as const;
export type ExternalStatus = (typeof EXTERNAL_STATUSES)[number];

const MANUAL: Record<string, ExternalStatus[]> = {
  new: ["skipped"],
  drafted: ["skipped"],
  ready: ["applied", "skipped"],
  applied: ["replied", "interview", "offer", "won", "lost", "withdrawn"],
  replied: ["interview", "offer", "won", "lost", "withdrawn"],
  interview: ["offer", "won", "lost", "withdrawn"],
  offer: ["won", "lost", "withdrawn"],
  skipped: ["new"],
  won: [],
  lost: [],
  withdrawn: []
};

export function allowedTransitions(status: string): ExternalStatus[] {
  return MANUAL[status] ?? [];
}

export function isExternalStatus(value: unknown): value is ExternalStatus {
  return typeof value === "string" && (EXTERNAL_STATUSES as readonly string[]).includes(value);
}

export type TransitionCheck = { ok: true } | { ok: false; code: "INVALID_STATUS" | "INVALID_TRANSITION" | "SYSTEM_STATUS"; message: string };

export function checkTransition(from: string, to: unknown): TransitionCheck {
  if (!isExternalStatus(to)) return { ok: false, code: "INVALID_STATUS", message: `Status must be one of: ${EXTERNAL_STATUSES.join(", ")}.` };
  if (to === "drafted" || to === "ready") {
    return { ok: false, code: "SYSTEM_STATUS", message: to === "drafted" ? "Create a proposal draft instead." : "Approve the exact proposal text instead." };
  }
  if (!allowedTransitions(from).includes(to)) {
    return { ok: false, code: "INVALID_TRANSITION", message: `An opportunity that is ${from} cannot move to ${to}.` };
  }
  return { ok: true };
}

/** What the freelancer should do next, in plain words. */
export function nextStep(status: string): { action: string; text: string } {
  const steps: Record<string, { action: string; text: string }> = {
    new: { action: "draft", text: "Check the analysis, then draft a proposal or skip this job." },
    drafted: { action: "approve", text: "Edit the draft until every sentence is true, then approve the exact text." },
    ready: { action: "submit", text: "Apply on the original site (or send with an authorised integration), then record the submission." },
    applied: { action: "follow_up", text: "Set a follow-up date and record the client's reply when it arrives." },
    replied: { action: "discuss", text: "Answer questions, schedule an interview, or record an offer." },
    interview: { action: "prepare", text: "Prepare for the interview, then record the result." },
    offer: { action: "decide", text: "Review the offer on the original platform, then record won or lost." },
    won: { action: "deliver", text: "Deliver under the original platform's contract; it is tracked in your projects." },
    lost: { action: "learn", text: "Closed. Use analytics to see which jobs you win." },
    withdrawn: { action: "learn", text: "Closed: you withdrew." },
    skipped: { action: "reopen", text: "Skipped. Reopen it if you change your mind." }
  };
  return steps[status] ?? { action: "review", text: "Review this opportunity." };
}

export interface ProfileFacts {
  skills: string[];
  portfolio_links: string[];
  minimum_budget: number | null;
  currency: string;
}

export interface Analysis {
  match_score: number;
  matched_skills: string[];
  missing_skills: string[];
  budget: { status: "fits" | "below_minimum" | "not_stated" | "other_currency"; detail: string };
  client: { payment_verified: boolean | null; rating: number | null; reviews: number | null };
  risks: string[];
  recommendation: "apply" | "consider" | "skip";
  reasons: string[];
  evidence: Array<{ url: string; matched: string[] }>;
}

type OppRow = Record<string, unknown>;

function notes(opp: OppRow): { matched_skills?: string[]; missing_skills?: string[]; eligibility_warnings?: string[] } {
  try {
    const raw = typeof opp.score_breakdown === "string" ? JSON.parse(opp.score_breakdown) : opp.score_breakdown;
    return (raw && typeof raw === "object" && (raw as { notes?: object }).notes) || {};
  } catch {
    return {};
  }
}

const numOrNull = (v: unknown) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

/** Deterministic fit analysis from the saved job and the freelancer's confirmed profile. */
export function analyseOpportunity(opp: OppRow, profile: ProfileFacts, today: Date): Analysis {
  const n = notes(opp);
  const required = jsonList(opp.required_skills);
  const have = new Set(profile.skills.map((s) => s.toLowerCase()));
  const matched = (n.matched_skills ?? required.filter((s) => have.has(s.toLowerCase()))).slice(0, 20);
  const missing = (n.missing_skills ?? required.filter((s) => !have.has(s.toLowerCase()))).slice(0, 20);
  const score = Math.max(0, Math.min(100, Number(opp.match_score ?? 0)));
  const risks: string[] = [...(n.eligibility_warnings ?? [])];

  const max = numOrNull(opp.budget_max) ?? numOrNull(opp.budget_min);
  const currency = String(opp.currency || "INR");
  let budget: Analysis["budget"] = { status: "not_stated", detail: "The job does not state a budget: ask before you price." };
  if (max !== null) {
    if (profile.minimum_budget !== null && currency !== profile.currency) budget = { status: "other_currency", detail: `Budget is in ${currency}; your minimum is in ${profile.currency}.` };
    else if (profile.minimum_budget !== null && max < profile.minimum_budget) budget = { status: "below_minimum", detail: `Budget up to ${max} ${currency} is below your minimum of ${profile.minimum_budget}.` };
    else budget = { status: "fits", detail: `Budget up to ${max} ${currency}.` };
  }
  if (budget.status === "below_minimum") risks.push("Budget is below your minimum project size.");

  const verified = opp.client_payment_verified === null || opp.client_payment_verified === undefined ? null : Boolean(opp.client_payment_verified);
  const rating = numOrNull(opp.client_rating);
  const reviews = numOrNull(opp.client_reviews);
  if (verified === false) risks.push("The client's payment method is not verified on the original platform.");
  if (rating !== null && reviews !== null && reviews >= 3 && rating < 4) risks.push(`Client rating is ${rating} from ${reviews} reviews.`);
  if (String(opp.competition_level ?? "") === "high") risks.push("Many freelancers have already applied.");
  const deadline = typeof opp.deadline === "string" && /^\d{4}-\d{2}-\d{2}/.test(opp.deadline) ? opp.deadline.slice(0, 10) : null;
  if (deadline && deadline < today.toISOString().slice(0, 10)) risks.push(`The stated deadline (${deadline}) has passed.`);
  const screened = screenText(`${String(opp.title ?? "")}\n${String(opp.description ?? "")}`);
  if (screened.some((f) => f.code === "upfront_fee" || f.code === "off_platform_payment")) risks.push("The post asks for fees or payment outside a platform: a common scam sign.");

  const blocking = screened.some((f) => f.code === "upfront_fee" || f.code === "off_platform_payment") || budget.status === "below_minimum";
  const reasons: string[] = [];
  if (matched.length) reasons.push(`You list ${matched.length} of the requested skills (${matched.slice(0, 5).join(", ")}).`);
  if (missing.length) reasons.push(`Not on your profile: ${missing.slice(0, 5).join(", ")}.`);
  reasons.push(`Match score ${score}/100 from your profile.`);
  const recommendation: Analysis["recommendation"] = blocking || score < 40 ? "skip" : score >= 70 && risks.length === 0 ? "apply" : "consider";

  return {
    match_score: score,
    matched_skills: matched,
    missing_skills: missing,
    budget,
    client: { payment_verified: verified, rating, reviews },
    risks,
    recommendation,
    reasons,
    evidence: rankEvidence(profile.portfolio_links, { title: String(opp.title ?? ""), skills: required }).slice(0, 5)
  };
}

/** True when the table exists (its migration ran). Used to keep older databases working. */
export async function tableExists(sql: Queryable, name: string): Promise<boolean> {
  try {
    const rows = await sql<{ ready: boolean }[]>`SELECT to_regclass(${name}) IS NOT NULL AS ready`;
    return rows[0]?.ready === true;
  } catch {
    return false;
  }
}

/** Records an opportunity event when migration 0069 has run; never fails the caller. */
export async function recordOpportunityEvent(
  sql: Queryable,
  e: { opportunityId: string; userId: string; kind: "status" | "submission" | "follow_up" | "interview" | "note"; from?: string | null; to?: string | null; note?: string; dueDate?: string | null; applicationId?: string | null }
): Promise<void> {
  if (!(await tableExists(sql, "opportunity_events"))) return;
  await sql`
    INSERT INTO opportunity_events (id, opportunity_id, user_id, kind, from_status, to_status, note, due_date, application_id, created_at)
    VALUES (${crypto.randomUUID()}, ${e.opportunityId}, ${e.userId}, ${e.kind}, ${e.from ?? null}, ${e.to ?? null}, ${(e.note ?? "").slice(0, 2000)},
            ${e.dueDate ?? null}, ${e.applicationId ?? null}, now())
  `;
}

/** Records a proposal version when migration 0069 has run. */
export async function recordProposalVersion(
  sql: Queryable,
  v: { proposalId: string; userId: string; version: number; content: string; price: number | null; currency: string; source: "model" | "safe_template" | "edited" }
): Promise<void> {
  if (!(await tableExists(sql, "proposal_versions"))) return;
  await sql`
    INSERT INTO proposal_versions (id, proposal_id, user_id, version, content, proposed_price, currency, source, created_at)
    VALUES (${crypto.randomUUID()}, ${v.proposalId}, ${v.userId}, ${v.version}, ${v.content}, ${v.price}, ${v.currency}, ${v.source}, now())
    ON CONFLICT (proposal_id, version) DO NOTHING
  `;
}
