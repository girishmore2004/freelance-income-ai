import type { Queryable } from "./core-routes";
import { tableExists } from "./external-pipeline";

/**
 * Fair proposals (Master Plan B12) and freelancer–client blocks (Step 6).
 *
 * 1. Weekly proposal limit: a modest number of proposals per rolling 7 days
 *    that rises with the freelancer's hire rate over the last 90 days
 *    ("a modest limit that rises with acceptance rate is more effective than
 *    a hard cap alone"). Deterministic; no AI.
 * 2. Client load control: an optional cap on proposals per project; reaching
 *    it closes the project to new proposals. The client can also close or
 *    reopen it by hand (columns from migration 0078).
 * 3. Quality gate: a proposal that is a near-copy of one the freelancer sent
 *    to another project is flagged before submission (a warning, never a
 *    block: reusing good wording is allowed, mass pasting is discouraged).
 * 4. Blocks: one row per side between a freelancer and a client account.
 *    Either side's block stops proposals, invitations, service orders and
 *    proposal messages between them. Messages are neutral ("not available")
 *    so the blocked side is not told who blocked whom.
 */

/** Provisional numbers (BUSINESS_DECISIONS D-23); change here and in the record together. */
export const QUOTA = {
  /** Proposals per rolling 7 days for everyone. */
  base: 10,
  /** Highest weekly limit, reached at a 50% hire rate. */
  max: 30,
  /** Extra proposals per week for each 1.0 of hire rate (0.5 → +20). */
  perHireRate: 40,
  /** Proposals in the last 90 days before the hire rate counts. */
  minHistory: 5
} as const;

export const NEAR_DUPLICATE = 0.8;
export const MAX_PROPOSALS_CAP = 500;

export interface QuotaFacts {
  /** Proposals sent in the last 7 days (any status, withdrawn included: sending is what is limited). */
  sent7: number;
  /** Proposals sent in the last 90 days. */
  sent90: number;
  /** Of those, how many led to a hire. */
  hired90: number;
}

export interface Quota {
  limit: number;
  used: number;
  remaining: number;
  hire_rate: number | null;
  explanation: string;
}

/** The weekly proposal limit for these facts. Pure. */
export function proposalQuota(facts: QuotaFacts): Quota {
  const sent7 = Math.max(0, Math.floor(facts.sent7));
  const sent90 = Math.max(0, Math.floor(facts.sent90));
  const hired90 = Math.max(0, Math.min(sent90, Math.floor(facts.hired90)));
  const counts = sent90 >= QUOTA.minHistory;
  const hireRate = counts ? hired90 / sent90 : null;
  const limit = hireRate === null ? QUOTA.base : Math.min(QUOTA.max, QUOTA.base + Math.floor(hireRate * QUOTA.perHireRate));
  const explanation = hireRate === null
    ? `Up to ${QUOTA.base} proposals a week. The limit rises as clients hire you (after ${QUOTA.minHistory} proposals).`
    : limit === QUOTA.base
    ? `Up to ${QUOTA.base} proposals a week. Each hire raises the limit (up to ${QUOTA.max}); focus on projects that fit you best.`
    : `Up to ${limit} proposals a week: ${QUOTA.base} for everyone plus more for your hire rate of ${Math.round(hireRate * 100)}% over 90 days (most is ${QUOTA.max}).`;
  return { limit, used: sent7, remaining: Math.max(0, limit - sent7), hire_rate: hireRate === null ? null : Math.round(hireRate * 1000) / 1000, explanation };
}

const words = (text: string): string[] =>
  text.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 0);

function shingles(text: string): Set<string> {
  const w = words(text);
  if (w.length < 3) return new Set(w);
  const out = new Set<string>();
  for (let i = 0; i + 2 < w.length; i += 1) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  return out;
}

/** Jaccard similarity of word triples (0–1). Case, punctuation and spacing are ignored. Pure. */
export function textSimilarity(a: string, b: string): number {
  const x = shingles(a);
  const y = shingles(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const s of x) if (y.has(s)) shared += 1;
  return shared / (x.size + y.size - shared);
}

/** Closest earlier proposal by the same freelancer to another project, when it is a near-copy. */
export async function nearDuplicate(
  sql: Queryable,
  userId: string,
  listingId: string,
  text: string
): Promise<{ similarity: number; project_title: string } | null> {
  const rows = await sql<{ cover_letter: string; title: string }[]>`
    SELECT p.cover_letter, v.title
    FROM listing_proposals p
    JOIN project_listings l ON l.id = p.listing_id
    JOIN project_listing_versions v ON v.listing_id = l.id AND v.version = l.current_version
    WHERE p.freelancer_user_id = ${userId} AND p.listing_id <> ${listingId}
    ORDER BY p.created_at DESC
    LIMIT 20
  `;
  let best: { similarity: number; project_title: string } | null = null;
  for (const row of rows) {
    const similarity = textSimilarity(text, row.cover_letter ?? "");
    if (similarity >= NEAR_DUPLICATE && (!best || similarity > best.similarity)) best = { similarity: Math.round(similarity * 100) / 100, project_title: row.title };
  }
  return best;
}

/** This freelancer's weekly limit and use. */
export async function loadQuota(sql: Queryable, userId: string): Promise<Quota> {
  const rows = await sql<{ sent7: number; sent90: number; hired90: number }[]>`
    SELECT count(*) FILTER (WHERE p.created_at > now() - interval '7 days')::int AS sent7,
           count(*)::int AS sent90,
           count(*) FILTER (WHERE p.status = 'hired' OR EXISTS (
             SELECT 1 FROM contracts c WHERE c.proposal_id = p.id AND c.status IN ('active', 'completed')))::int AS hired90
    FROM listing_proposals p
    WHERE p.freelancer_user_id = ${userId} AND p.created_at > now() - interval '90 days'
  `;
  const r = rows[0] ?? { sent7: 0, sent90: 0, hired90: 0 };
  return proposalQuota({ sent7: Number(r.sent7), sent90: Number(r.sent90), hired90: Number(r.hired90) });
}

export interface Intake {
  max_proposals: number | null;
  closed: boolean;
  received: number;
}

/** Whether a project still takes proposals (always open before migration 0078). */
export async function intakeOf(sql: Queryable, listingId: string): Promise<Intake> {
  const rows = await sql<{ max_proposals: string | null; closed_at: string | null; received: number }[]>`
    SELECT (to_jsonb(l)->>'max_proposals') AS max_proposals, (to_jsonb(l)->>'proposals_closed_at') AS closed_at,
           (SELECT count(*)::int FROM listing_proposals p WHERE p.listing_id = l.id AND p.status <> 'withdrawn') AS received
    FROM project_listings l WHERE l.id = ${listingId} LIMIT 1
  `;
  const r = rows[0];
  if (!r) return { max_proposals: null, closed: false, received: 0 };
  const max = r.max_proposals === null ? null : Number(r.max_proposals);
  const received = Number(r.received);
  return { max_proposals: max, closed: r.closed_at !== null || (max !== null && received >= max), received };
}

/** Validates a client's intake settings. Pure. */
export function validateIntake(input: Record<string, unknown>): { ok: true; value: { max_proposals: number | null; accepting: boolean } } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const raw = input.max_proposals;
  let max: number | null = null;
  if (raw !== null && raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > MAX_PROPOSALS_CAP) errors.max_proposals = `Choose 1 to ${MAX_PROPOSALS_CAP} proposals, or no limit.`;
    else max = n;
  }
  if (typeof input.accepting !== "boolean") errors.accepting = "Choose whether the project takes new proposals.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { max_proposals: max, accepting: input.accepting as boolean } };
}

/** True when either side has blocked the other (false before migration 0078). */
export async function isBlocked(sql: Queryable, freelancerUserId: string, organizationId: string): Promise<boolean> {
  if (!(await tableExists(sql, "marketplace_blocks"))) return false;
  const rows = await sql`
    SELECT 1 FROM marketplace_blocks WHERE freelancer_user_id = ${freelancerUserId} AND organization_id = ${organizationId} LIMIT 1
  `;
  return rows.length > 0;
}

/** Client accounts this freelancer is blocked with, either way (for hiding their projects). */
export async function blockedOrganizations(sql: Queryable, freelancerUserId: string): Promise<string[]> {
  if (!(await tableExists(sql, "marketplace_blocks"))) return [];
  const rows = await sql<{ organization_id: string }[]>`
    SELECT DISTINCT organization_id FROM marketplace_blocks WHERE freelancer_user_id = ${freelancerUserId}
  `;
  return rows.map((r) => r.organization_id);
}

/** Freelancers a client account is blocked with, either way (for hiding them from matching). */
export async function blockedFreelancers(sql: Queryable, organizationId: string): Promise<string[]> {
  if (!(await tableExists(sql, "marketplace_blocks"))) return [];
  const rows = await sql<{ freelancer_user_id: string }[]>`
    SELECT DISTINCT freelancer_user_id FROM marketplace_blocks WHERE organization_id = ${organizationId}
  `;
  return rows.map((r) => r.freelancer_user_id);
}

/** The number of proposals as a range, so freelancers see the competition without exact counts. Pure. */
export function proposalBucket(n: number): string {
  if (n < 5) return "Less than 5";
  if (n < 10) return "5 to 10";
  if (n < 20) return "10 to 20";
  if (n < 50) return "20 to 50";
  return "50+";
}

export const NOT_AVAILABLE = "This is not available between your accounts.";
