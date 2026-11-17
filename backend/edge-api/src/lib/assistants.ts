/**
 * Deterministic client-side assistants (Phase 6 batch 2). No model calls, no
 * decisions: each one lays out facts and flags for the client, who decides.
 *
 *   C3 Proposal Comparison      side-by-side facts; never ranks (and never by price alone)
 *   C5 Contract and Milestone   suggested milestone split of the freelancer's own price + missing-term flags
 *   C6 Review and Acceptance    acceptance-criteria checklist against a delivery note
 */

/* ------------------------------------------------------------------ */
/* shared text helpers                                                 */
/* ------------------------------------------------------------------ */

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "are", "can", "all", "from", "have", "has", "will", "must", "should", "into",
  "our", "your", "you", "their", "they", "them", "its", "per", "via", "any", "each", "use", "used", "using", "work", "works",
  "agreed", "page", "pages", "done", "able", "also", "only", "more", "than", "then", "when", "what", "which", "who", "how"
]);

export function keywords(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9][a-z0-9+#.-]{2,}/g) ?? [];
  return [...new Set(words.map((w) => w.replace(/[.-]+$/, "")).filter((w) => w.length >= 3 && !STOP.has(w)))];
}

function stem(word: string): string {
  return word.replace(/(ing|ed|es|s)$/, "");
}

/** Share of a phrase's keywords (by stem) found in a text, and which were found. */
export function coverage(phrase: string, text: string): { ratio: number; matched: string[] } {
  const want = keywords(phrase);
  if (!want.length) return { ratio: 0, matched: [] };
  const have = new Set(keywords(text).map(stem));
  const matched = want.filter((w) => have.has(stem(w)));
  return { ratio: matched.length / want.length, matched };
}

/* ------------------------------------------------------------------ */
/* C3 Proposal Comparison                                              */
/* ------------------------------------------------------------------ */

export interface ComparisonListing {
  budget_min_minor: number | null;
  budget_max_minor: number | null;
  deadline: string | null;
  skills: string[];
  deliverables: string[];
}

export interface ComparisonProposal {
  id: string;
  freelancer_name: string;
  price_minor: number;
  estimated_days: number | null;
  cover_letter: string;
  skills: string[];
  rating: { average: number; count: number } | null;
  invited: boolean;
  created_at: string;
}

export type BudgetFit = "within" | "below" | "above" | "no_budget";
export type TimelineFit = "fits" | "tight" | "late" | "no_deadline" | "not_stated";

export interface ComparisonRow {
  proposal_id: string;
  freelancer_name: string;
  price_minor: number;
  budget_fit: BudgetFit;
  estimated_days: number | null;
  timeline_fit: TimelineFit;
  skills_covered: string[];
  skills_missing: string[];
  deliverables_mentioned: number;
  deliverables_total: number;
  rating: { average: number; count: number } | null;
  invited: boolean;
  notes: string[];
}

function normal(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9+#]/g, "");
}

export function compareProposals(listing: ComparisonListing, proposals: ComparisonProposal[], today: Date): { rows: ComparisonRow[]; price_range: { min: number; max: number } | null; disclaimer: string } {
  const daysLeft = listing.deadline ? Math.floor((Date.parse(`${listing.deadline}T23:59:59Z`) - today.getTime()) / 86_400_000) : null;
  const rows = proposals.map((p): ComparisonRow => {
    const notes: string[] = [];
    let budget: BudgetFit = "no_budget";
    if (listing.budget_min_minor !== null || listing.budget_max_minor !== null) {
      if (listing.budget_max_minor !== null && p.price_minor > listing.budget_max_minor) budget = "above";
      else if (listing.budget_min_minor !== null && p.price_minor < listing.budget_min_minor) budget = "below";
      else budget = "within";
    }
    if (budget === "below") notes.push("Priced below your budget range: check that the scope is fully covered.");
    if (budget === "above") notes.push("Priced above your budget range.");

    let timeline: TimelineFit = "not_stated";
    if (daysLeft === null) timeline = "no_deadline";
    else if (p.estimated_days !== null) timeline = p.estimated_days > daysLeft ? "late" : p.estimated_days > daysLeft * 0.8 ? "tight" : "fits";
    if (timeline === "late") notes.push("Estimated time runs past your deadline.");
    if (timeline === "not_stated") notes.push("No time estimate given: ask before deciding.");

    const own = new Set(p.skills.map(normal));
    const covered = listing.skills.filter((s) => own.has(normal(s)));
    const missing = listing.skills.filter((s) => !own.has(normal(s)));
    const mentioned = listing.deliverables.filter((d) => coverage(d, p.cover_letter).ratio >= 0.5).length;
    if (listing.deliverables.length && mentioned === 0) notes.push("The proposal does not mention your deliverables.");
    if (!p.rating) notes.push("No completed-contract reviews on the platform yet.");

    return {
      proposal_id: p.id,
      freelancer_name: p.freelancer_name,
      price_minor: p.price_minor,
      budget_fit: budget,
      estimated_days: p.estimated_days,
      timeline_fit: timeline,
      skills_covered: covered,
      skills_missing: missing,
      deliverables_mentioned: mentioned,
      deliverables_total: listing.deliverables.length,
      rating: p.rating,
      invited: p.invited,
      notes
    };
  });
  const prices = proposals.map((p) => p.price_minor);
  return {
    // Order is submission order, never a ranking.
    rows,
    price_range: prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null,
    disclaimer: "Facts and flags only, in the order proposals arrived. Nothing is ranked; the lowest price is not a recommendation."
  };
}

/* ------------------------------------------------------------------ */
/* C5 Contract and Milestone Assistant                                 */
/* ------------------------------------------------------------------ */

export interface SuggestionInput {
  title: string;
  deliverables: string[];
  milestone_titles: string[];
  acceptance_criteria: string[];
  revision_rounds: number;
  ownership_notes: string;
  deadline: string | null;
  price_minor: number;
}

/**
 * Splits the freelancer's own price across the listing's milestones in whole
 * rupees (remainder on the last milestone) and spreads due dates evenly to the
 * deadline. The client edits everything before sending; nothing is decided here.
 */
export function suggestTerms(input: SuggestionInput, today: Date) {
  const titles = input.milestone_titles.length ? input.milestone_titles.slice(0, 20) : ["Complete project"];
  const n = titles.length;
  const rupees = Math.floor(input.price_minor / 100);
  const paise = input.price_minor % 100;
  const base = Math.floor(rupees / n);
  const amounts = titles.map((_, i) => (i === n - 1 ? (rupees - base * (n - 1)) * 100 + paise : base * 100));
  let dueDates: Array<string | null> = titles.map(() => null);
  if (input.deadline) {
    const end = Date.parse(`${input.deadline}T00:00:00Z`);
    const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    if (end > start) {
      dueDates = titles.map((_, i) => new Date(start + Math.round(((end - start) * (i + 1)) / n)).toISOString().slice(0, 10));
    }
  }
  const missing: string[] = [];
  if (!input.acceptance_criteria.length) missing.push("No acceptance criteria: say how each milestone will be checked.");
  if (!input.deadline) missing.push("No deadline: agree due dates for each milestone.");
  if (!input.ownership_notes.trim()) missing.push("Ownership and licensing are not stated: say who owns the work and source files.");
  if (!input.milestone_titles.length) missing.push("The brief has no milestones: one milestone covers everything; consider splitting the work.");
  if (amounts.some((a) => a <= 0)) missing.push("The price is too small to split across every milestone: merge milestones.");
  return {
    terms: {
      title: input.title,
      scope: "",
      deliverables: input.deliverables,
      milestones: titles.map((title, i) => ({ title, amount_minor: amounts[i], due_date: dueDates[i] })),
      revision_rounds: input.revision_rounds,
      acceptance_criteria: input.acceptance_criteria,
      ownership_terms: input.ownership_notes
    },
    missing_terms: missing,
    note: "Suggested split of the freelancer's quoted price. Edit every amount and date before sending."
  };
}

/* ------------------------------------------------------------------ */
/* C6 Review and Acceptance Assistant                                  */
/* ------------------------------------------------------------------ */

export function acceptanceChecklist(criteria: string[], note: string, links: string[]) {
  const text = `${note}\n${links.join(" ")}`;
  const items = criteria.map((c) => {
    const { ratio, matched } = coverage(c, text);
    return { criterion: c, mentioned: ratio >= 0.5, matched_terms: matched };
  });
  const unmentioned = items.filter((i) => !i.mentioned).length;
  return {
    items,
    summary: criteria.length === 0
      ? "The contract has no acceptance criteria to check against."
      : unmentioned === 0
        ? "The delivery note mentions every acceptance criterion. Check the work itself before approving."
        : `${unmentioned} of ${criteria.length} criteria are not mentioned in the delivery note. Ask, or check them yourself.`,
    note: "A word-match checklist, not a judgement of quality. You decide whether to approve or request a revision."
  };
}
