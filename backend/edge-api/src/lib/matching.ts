/**
 * Match and Shortlist agent (C2), deterministic part.
 *
 * Ranks freelancers who opted in to client discovery against one listing.
 * Every point is explained, there is no model call and no money is decided:
 * budget only affects fit, never a price. The ranking reserves a small number
 * of places for newcomers (Master Plan: "newcomer exposure") so new
 * freelancers are not permanently buried under established ones.
 *
 * Score (0–100):
 *   skills        0–50  share of the listing's requested skills the freelancer lists
 *   budget        0–20  listing budget against the freelancer's minimum / hourly rate
 *   category      0–15  the category appears in the freelancer's services or headline
 *   availability  0–10  weekly hours
 *   timezone      0–5   same timezone, or the listing does not ask for one
 */

import { availabilityFit } from "./agent-complete";

export const NEWCOMER_DAYS = 60;
export const SHORTLIST_SIZE = 10;
export const NEWCOMER_SLOTS = 2;
export const MIN_SCORE = 30;
export const NEWCOMER_MIN_SCORE = 40;

export interface CandidateRow {
  user_id: string;
  full_name: string;
  headline: string;
  skills: string;
  services: string;
  minimum_budget: number | string | null;
  hourly_rate: number | string | null;
  currency: string;
  weekly_hours: number | null;
  timezone: string;
  dealbreakers: string;
  user_created_at: Date | string;
  /** Revealed client reviews (optional: only the matching queries load them). */
  rating_avg?: number | string | null;
  /** Weekly limits of the freelancer's active hourly contracts (U24, F7 capacity feeding C2). */
  booked_hours?: number | string | null;
  rating_count?: number | string | null;
  /** Set when staff reviewed the freelancer's public evidence (U10, migration 0071). Never an identity check. */
  verified_at?: Date | string | null;
}

export interface ListingForMatch {
  title: string;
  outcome: string;
  description: string;
  category_slug: string;
  category_name: string;
  skills: string[];
  budget_model: string;
  budget_min_minor: number | null;
  budget_max_minor: number | null;
  currency: string;
  timezone: string;
}

export interface MatchBreakdown {
  skills: number;
  budget: number;
  category: number;
  availability: number;
  timezone: number;
}

export interface FreelancerCard {
  user_id: string;
  display_name: string;
  headline: string;
  skills: string[];
  services: string[];
  hourly_rate: number | null;
  currency: string;
  weekly_hours: number | null;
  timezone: string;
  newcomer: boolean;
  /** Staff reviewed the freelancer's public work evidence (not an identity or KYC check). */
  verified: boolean;
  /** Average of revealed client reviews; null until the first one. Not used for ranking. */
  rating: { average: number; count: number } | null;
}

export interface Match {
  freelancer: FreelancerCard;
  score: number;
  breakdown: MatchBreakdown;
  reasons: string[];
  missing_skills: string[];
  newcomer_slot: boolean;
}

export type Evaluation = { eligible: true; match: Match } | { eligible: false; reason: "dealbreaker" | "low_score" | "no_skill_overlap" };

function parseList(value: string): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map((x) => String(x).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** "Next.js", "nextjs" and "NEXT JS" compare equal. */
export function normaliseSkill(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+#]/g, "");
}

function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function isNewcomer(createdAt: Date | string, now: Date): boolean {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return false;
  return now.getTime() - created < NEWCOMER_DAYS * 86_400_000;
}

export function freelancerCard(row: CandidateRow, now: Date): FreelancerCard {
  return {
    user_id: row.user_id,
    display_name: row.full_name.trim() || "Freelancer",
    headline: row.headline,
    skills: parseList(row.skills).slice(0, 12),
    services: parseList(row.services).slice(0, 6),
    hourly_rate: num(row.hourly_rate) || null,
    currency: row.currency || "INR",
    weekly_hours: row.weekly_hours,
    timezone: row.timezone,
    newcomer: isNewcomer(row.user_created_at, now),
    verified: Boolean(row.verified_at),
    rating: Number(row.rating_count ?? 0) > 0 ? { average: Math.round(Number(row.rating_avg) * 10) / 10, count: Number(row.rating_count) } : null
  };
}

function rupees(minor: number): string {
  return `${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function evaluateCandidate(listing: ListingForMatch, row: CandidateRow, now: Date): Evaluation {
  const listingText = `${listing.title}\n${listing.outcome}\n${listing.description}`.toLowerCase();
  const dealbreaker = parseList(row.dealbreakers).find((d) => d.length >= 3 && listingText.includes(d.toLowerCase()));
  if (dealbreaker) return { eligible: false, reason: "dealbreaker" };

  const reasons: string[] = [];
  const breakdown: MatchBreakdown = { skills: 0, budget: 0, category: 0, availability: 0, timezone: 0 };

  // Skills
  const own = new Set(parseList(row.skills).map(normaliseSkill).filter(Boolean));
  const requested = listing.skills.filter((s) => normaliseSkill(s));
  const covered = requested.filter((s) => own.has(normaliseSkill(s)));
  const missing = requested.filter((s) => !own.has(normaliseSkill(s)));
  if (requested.length) {
    if (!covered.length) return { eligible: false, reason: "no_skill_overlap" };
    breakdown.skills = Math.round((50 * covered.length) / requested.length);
    reasons.push(`Has ${covered.length} of ${requested.length} requested skills: ${covered.join(", ")}`);
  } else {
    breakdown.skills = 25;
    reasons.push("The listing names no specific skills");
  }

  // Budget (fit only; never sets a price)
  const max = listing.budget_max_minor ?? listing.budget_min_minor;
  const sameCurrency = (row.currency || "INR").toUpperCase() === listing.currency.toUpperCase();
  if (max === null) {
    breakdown.budget = 10;
  } else if (!sameCurrency) {
    breakdown.budget = 8;
    reasons.push(`Works in ${row.currency}; the budget is in ${listing.currency}`);
  } else if (listing.budget_model === "hourly") {
    const rate = num(row.hourly_rate);
    if (!rate) breakdown.budget = 10;
    else if (rate * 100 <= max) {
      breakdown.budget = 20;
      reasons.push(`Hourly rate fits the budget (up to ${rupees(max)} per hour)`);
    } else breakdown.budget = Math.max(0, Math.round(20 * (max / (rate * 100))) - 5);
  } else {
    const minimum = num(row.minimum_budget);
    if (!minimum) breakdown.budget = 15;
    else if (minimum * 100 <= max) {
      breakdown.budget = 20;
      reasons.push(`Budget (up to ${rupees(max)}) meets their minimum project size`);
    } else breakdown.budget = Math.max(0, Math.round(20 * (max / (minimum * 100))) - 5);
  }

  // Category
  const offered = `${parseList(row.services).join(" ")} ${row.headline}`.toLowerCase();
  const categoryWords = listing.category_name
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3 && w !== "development");
  if (categoryWords.some((w) => offered.includes(w)) || offered.includes(listing.category_slug.replace(/_/g, " "))) {
    breakdown.category = 15;
    reasons.push(`Offers ${listing.category_name.toLowerCase()} services`);
  }

  // Availability: free hours after active hourly contracts (F7 capacity feeds matching).
  const fit = availabilityFit(row.weekly_hours, Number(row.booked_hours ?? 0) || 0);
  breakdown.availability = fit.points;
  if (fit.reason) reasons.push(fit.reason);

  // Timezone
  if (!listing.timezone || listing.timezone === row.timezone) {
    breakdown.timezone = 5;
    if (listing.timezone) reasons.push(`Same timezone (${listing.timezone})`);
  } else breakdown.timezone = 2;

  const score = breakdown.skills + breakdown.budget + breakdown.category + breakdown.availability + breakdown.timezone;
  const card = freelancerCard(row, now);
  if (score < MIN_SCORE) return { eligible: false, reason: "low_score" };
  return { eligible: true, match: { freelancer: card, score, breakdown, reasons, missing_skills: missing, newcomer_slot: false } };
}

/**
 * Top SHORTLIST_SIZE by score (ties broken by user id for a stable order), with up to NEWCOMER_SLOTS of the best remaining newcomers
 * (score ≥ NEWCOMER_MIN_SCORE) swapped in for the lowest-ranked established
 * freelancers.
 */
export function shortlist(listing: ListingForMatch, rows: CandidateRow[], now: Date): Match[] {
  const eligible: Match[] = [];
  for (const row of rows) {
    const result = evaluateCandidate(listing, row, now);
    if (result.eligible) eligible.push(result.match);
  }
  eligible.sort((a, b) => b.score - a.score || a.freelancer.user_id.localeCompare(b.freelancer.user_id));

  const top = eligible.slice(0, SHORTLIST_SIZE);
  const newcomersInTop = top.filter((m) => m.freelancer.newcomer).length;
  const extra = eligible
    .slice(SHORTLIST_SIZE)
    .filter((m) => m.freelancer.newcomer && m.score >= NEWCOMER_MIN_SCORE)
    .slice(0, Math.max(0, NEWCOMER_SLOTS - newcomersInTop));

  for (const newcomer of extra) {
    let replace = -1;
    for (let i = top.length - 1; i >= 0; i -= 1) {
      if (!top[i].freelancer.newcomer) {
        replace = i;
        break;
      }
    }
    if (replace === -1) break;
    top[replace] = {
      ...newcomer,
      newcomer_slot: true,
      reasons: [...newcomer.reasons, "New to the platform: shown so new freelancers get a fair chance"]
    };
  }
  return top.sort((a, b) => b.score - a.score || a.freelancer.user_id.localeCompare(b.freelancer.user_id));
}
