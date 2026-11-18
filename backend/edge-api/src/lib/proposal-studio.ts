import { screenText } from "./listings";
import { sha256Hex } from "./core-routes";
import { coverage, keywords } from "./assistants";
import { CLAIM_PATTERNS, reviewGeneratedText, unsupportedSkills } from "./ai-guard";

/**
 * Proposal Studio (Master Plan p.48, PRODUCT_EXPERIENCE_SPEC §5), deterministic part.
 *
 * A native proposal can carry structured sections next to the introduction
 * (`cover_letter`), the freelancer's price and estimated days. Everything here
 * is rule-based and testable: the checks flag unsupported claims, missing
 * assumptions and price/timeline inconsistencies for the freelancer to fix.
 * They never change the price or submit anything. The exact content is hashed
 * so the platform can record which version the freelancer approved.
 */

export interface ProposalMilestone {
  title: string;
  amount_minor: number;
}

export interface EvidenceItem {
  url: string;
  note: string;
}

export interface ProposalSections {
  understanding: string;
  approach: string;
  evidence: EvidenceItem[];
  deliverables: string[];
  milestones: ProposalMilestone[];
  assumptions: string[];
  exclusions: string[];
  questions: string[];
  revision_rounds: number | null;
}

/* Same bounds as contracts.ts (kept here to avoid an import cycle with it). */
const MIN_AMOUNT_MINOR = 100;
const MAX_AMOUNT_MINOR = 100_000_000_000;

type Result<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };

const LIMITS = { understanding: 2000, approach: 4000, item: 300, items: 20, evidence: 10, milestones: 10, questions: 10 } as const;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max + 1) : "";
}

function list(value: unknown, maxItems: number, maxLength: number): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const items = value.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean);
  if (items.length > maxItems || items.some((v) => v.length > maxLength)) return null;
  return items;
}

/** Host plus path, lower-case, no trailing slash: how portfolio links are compared. */
export function linkKey(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.hostname.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Validates the optional sections. Evidence links must be links the freelancer
 * already put on their profile: the studio never accepts invented portfolio.
 * Returns null when no sections were sent (the older single-text form).
 */
export function validateSections(input: unknown, portfolioLinks: string[]): Result<ProposalSections | null> {
  if (input === undefined || input === null) return { ok: true, value: null };
  if (typeof input !== "object" || Array.isArray(input)) return { ok: false, errors: { sections: "Sections must be an object." } };
  const raw = input as Record<string, unknown>;
  const errors: Record<string, string> = {};

  const understanding = text(raw.understanding, LIMITS.understanding);
  if (understanding.length > LIMITS.understanding) errors["sections.understanding"] = "Keep your understanding of the project under 2,000 characters.";
  const approach = text(raw.approach, LIMITS.approach);
  if (approach.length > LIMITS.approach) errors["sections.approach"] = "Keep the approach under 4,000 characters.";

  const named: Record<"deliverables" | "assumptions" | "exclusions" | "questions", string[]> = { deliverables: [], assumptions: [], exclusions: [], questions: [] };
  for (const key of Object.keys(named) as Array<keyof typeof named>) {
    const max = key === "questions" ? LIMITS.questions : LIMITS.items;
    const items = list(raw[key], max, LIMITS.item);
    if (!items) errors[`sections.${key}`] = `Up to ${max} ${key}, each under ${LIMITS.item} characters.`;
    else named[key] = items;
  }

  const allowed = new Set(portfolioLinks.map(linkKey).filter((k): k is string => Boolean(k)));
  const evidence: EvidenceItem[] = [];
  if (raw.evidence !== undefined && raw.evidence !== null) {
    if (!Array.isArray(raw.evidence) || raw.evidence.length > LIMITS.evidence) {
      errors["sections.evidence"] = `Add up to ${LIMITS.evidence} portfolio links.`;
    } else {
      raw.evidence.forEach((item, i) => {
        const e = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
        const url = typeof e.url === "string" ? e.url.trim() : "";
        const note = text(e.note, LIMITS.item);
        const key = linkKey(url);
        if (!key || !allowed.has(key)) errors[`sections.evidence.${i}`] = "Use a link from your profile's portfolio links. Add new work to your profile first.";
        else if (note.length > LIMITS.item) errors[`sections.evidence.${i}`] = "Keep each evidence note under 300 characters.";
        else evidence.push({ url, note });
      });
    }
  }

  const milestones: ProposalMilestone[] = [];
  if (raw.milestones !== undefined && raw.milestones !== null) {
    if (!Array.isArray(raw.milestones) || raw.milestones.length > LIMITS.milestones) {
      errors["sections.milestones"] = `Add up to ${LIMITS.milestones} milestones.`;
    } else {
      raw.milestones.forEach((item, i) => {
        const m = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
        const title = text(m.title, 160);
        const amount = m.amount_minor;
        if (title.length < 1 || title.length > 160) errors[`sections.milestones.${i}.title`] = "Each milestone needs a title (up to 160 characters).";
        if (typeof amount !== "number" || !Number.isInteger(amount) || amount < MIN_AMOUNT_MINOR || amount > MAX_AMOUNT_MINOR) {
          errors[`sections.milestones.${i}.amount_minor`] = "Each milestone needs an amount of at least ₹1.";
        }
        milestones.push({ title, amount_minor: Number(amount) });
      });
    }
  }

  let revisions: number | null = null;
  if (raw.revision_rounds !== undefined && raw.revision_rounds !== null && raw.revision_rounds !== "") {
    const n = Number(raw.revision_rounds);
    if (!Number.isInteger(n) || n < 0 || n > 10) errors["sections.revision_rounds"] = "Revision rounds must be 0 to 10.";
    else revisions = n;
  }

  if (Object.keys(errors).length === 0) {
    const all = [understanding, approach, ...Object.values(named).flat(), ...evidence.map((e) => e.note), ...milestones.map((m) => m.title)];
    if (screenText(all.join("\n")).length) {
      errors.sections = "Keep contact and payment on the platform: remove phone numbers, emails, messaging apps or payment requests.";
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { understanding, approach, evidence, milestones, revision_rounds: revisions, ...named } };
}

export interface StudioContent {
  cover_letter: string;
  price_minor: number;
  estimated_days: number | null;
  sections: ProposalSections | null;
}

/** Canonical form of the exact content the freelancer approves (key order fixed). */
export function canonicalContent(c: StudioContent): string {
  const s = c.sections;
  return JSON.stringify({
    cover_letter: c.cover_letter,
    price_minor: c.price_minor,
    estimated_days: c.estimated_days,
    sections: s
      ? {
          understanding: s.understanding,
          approach: s.approach,
          evidence: s.evidence.map((e) => ({ url: e.url, note: e.note })),
          deliverables: s.deliverables,
          milestones: s.milestones.map((m) => ({ title: m.title, amount_minor: m.amount_minor })),
          assumptions: s.assumptions,
          exclusions: s.exclusions,
          questions: s.questions,
          revision_rounds: s.revision_rounds
        }
      : null
  });
}

export async function contentHash(c: StudioContent): Promise<string> {
  return sha256Hex(canonicalContent(c));
}

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

export type FindingSeverity = "warn" | "info";
export interface Finding {
  code:
    | "price_above_budget"
    | "price_below_budget"
    | "milestones_total_mismatch"
    | "timeline_after_deadline"
    | "unsupported_skill"
    | "unsupported_claim"
    | "unknown_link"
    | "commitment"
    | "deliverable_not_covered"
    | "missing_deliverables"
    | "missing_assumptions"
    | "missing_exclusions"
    | "no_evidence"
    | "near_duplicate"
    | "revisions_below_brief";
  severity: FindingSeverity;
  field: string;
  message: string;
}

export interface CheckListing {
  budget_model: string;
  budget_min_minor: number | null;
  budget_max_minor: number | null;
  deadline: string | null;
  skills: string[];
  deliverables: string[];
  revision_rounds: number | null;
}

export interface CheckProfile {
  skills: string[];
  portfolio_links: string[];
}



const rupees = (minor: number) => `₹${Math.round(minor / 100).toLocaleString("en-IN")}`;

function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}


/**
 * Deterministic proposal review. Every finding is a suggestion for the
 * freelancer: nothing is blocked here (the validator blocks contact details,
 * off-platform payment and invented evidence links on submit).
 */
export function checkProposal(content: StudioContent, listing: CheckListing, profile: CheckProfile, today: Date): Finding[] {
  const findings: Finding[] = [];
  const s = content.sections;
  const body = [content.cover_letter, s?.understanding ?? "", s?.approach ?? "", ...(s?.deliverables ?? []), ...(s?.assumptions ?? [])].join("\n");
  const unit = listing.budget_model === "hourly" ? " per hour" : "";

  if (listing.budget_max_minor !== null && content.price_minor > listing.budget_max_minor) {
    findings.push({ code: "price_above_budget", severity: "warn", field: "price_minor", message: `Your price (${rupees(content.price_minor)}${unit}) is above the client's budget (up to ${rupees(listing.budget_max_minor)}${unit}). Explain the extra value in your approach, or adjust the scope.` });
  } else if (listing.budget_min_minor !== null && content.price_minor < listing.budget_min_minor) {
    findings.push({ code: "price_below_budget", severity: "info", field: "price_minor", message: `Your price is below the client's stated range (from ${rupees(listing.budget_min_minor)}${unit}). Check that it covers the full scope.` });
  }

  if (s && s.milestones.length > 0 && listing.budget_model !== "hourly") {
    const total = s.milestones.reduce((sum, m) => sum + m.amount_minor, 0);
    if (total !== content.price_minor) {
      findings.push({ code: "milestones_total_mismatch", severity: "warn", field: "sections.milestones", message: `Your milestones add up to ${rupees(total)} but your price is ${rupees(content.price_minor)}. Make them match so the client sees one consistent figure.` });
    }
  }

  if (listing.deadline && content.estimated_days !== null) {
    const available = daysBetween(today.toISOString().slice(0, 10), listing.deadline);
    if (available >= 0 && content.estimated_days > available) {
      findings.push({ code: "timeline_after_deadline", severity: "warn", field: "estimated_days", message: `${content.estimated_days} days would finish after the client's deadline (${listing.deadline}, ${available} days from today). Propose a phased plan or ask about the date.` });
    }
  }

  for (const skill of unsupportedSkills(body, listing.skills, profile.skills)) {
    findings.push({ code: "unsupported_skill", severity: "warn", field: "cover_letter", message: `You mention "${skill}", but it is not on your profile. Add it to your profile with evidence, or describe how you would handle it instead of claiming experience.` });
  }

  for (const pattern of CLAIM_PATTERNS) {
    const match = body.match(pattern);
    if (match) findings.push({ code: "unsupported_claim", severity: "warn", field: "cover_letter", message: `"${match[0]}" is a claim the client cannot check here. Back it with a portfolio link or remove it.` });
  }

  const guard = reviewGeneratedText(body, { price: null, allowedLinks: profile.portfolio_links });
  for (const issue of guard.issues) {
    if (issue.code === "unknown_link") findings.push({ code: "unknown_link", severity: "warn", field: "cover_letter", message: `The link ${issue.evidence} is not in your profile's portfolio links. Add it to your profile or remove it.` });
    if (issue.code === "commitment") findings.push({ code: "commitment", severity: "warn", field: "cover_letter", message: `"${issue.evidence}" reads as a guarantee or binding commitment. Describe what you will do instead; terms are agreed in the contract.` });
  }

  if (listing.deliverables.length > 0) {
    const offered = [...(s?.deliverables ?? []), content.cover_letter, s?.approach ?? ""].join("\n");
    if (s && s.deliverables.length === 0) {
      findings.push({ code: "missing_deliverables", severity: "info", field: "sections.deliverables", message: "List what you will deliver so the client can compare it with the brief." });
    }
    for (const wanted of listing.deliverables) {
      if (keywords(wanted).length === 0) continue;
      if (coverage(wanted, offered).ratio < 0.5) {
        findings.push({ code: "deliverable_not_covered", severity: "info", field: "sections.deliverables", message: `The brief asks for "${wanted}". Your proposal does not mention it yet.` });
      }
    }
  }

  if (s) {
    if (s.assumptions.length === 0) findings.push({ code: "missing_assumptions", severity: "info", field: "sections.assumptions", message: "State your assumptions (what you expect the client to provide, access, content, approvals)." });
    if (s.exclusions.length === 0) findings.push({ code: "missing_exclusions", severity: "info", field: "sections.exclusions", message: "List what is not included, so the scope is clear before an offer." });
    if (s.evidence.length === 0 && profile.portfolio_links.length > 0) findings.push({ code: "no_evidence", severity: "info", field: "sections.evidence", message: "Attach a relevant link from your portfolio as evidence." });
    if (listing.revision_rounds !== null && s.revision_rounds !== null && s.revision_rounds < listing.revision_rounds) {
      findings.push({ code: "revisions_below_brief", severity: "info", field: "sections.revision_rounds", message: `The brief expects ${listing.revision_rounds} revision round(s); you offer ${s.revision_rounds}.` });
    }
  }
  return findings;
}

/**
 * Portfolio links ordered by how many brief keywords appear in the link
 * itself. Only the freelancer's own profile links are ever suggested.
 */
export function rankEvidence(portfolioLinks: string[], listing: { title: string; skills: string[] }): Array<{ url: string; matched: string[] }> {
  const wanted = keywords([listing.title, ...listing.skills].join(" "));
  return portfolioLinks
    .filter((url) => linkKey(url) !== null)
    .map((url, index) => {
      const words = new Set(keywords(decodeURIComponent(url).replace(/[/_.-]+/g, " ")));
      return { url, index, matched: wanted.filter((w) => words.has(w)) };
    })
    .sort((a, b) => b.matched.length - a.matched.length || a.index - b.index)
    .map(({ url, matched }) => ({ url, matched }));
}

const EMPTY_SECTIONS: ProposalSections = {
  understanding: "", approach: "", evidence: [], deliverables: [], milestones: [], assumptions: [], exclusions: [], questions: [], revision_rounds: null
};

/** Short description of what changed between two versions, for the history list. */
export function describeChanges(
  before: { cover_letter: string; price_minor: number; estimated_days: number | null; sections: ProposalSections | null },
  after: { cover_letter: string; price_minor: number; estimated_days: number | null; sections: ProposalSections | null }
): string[] {
  const changes: string[] = [];
  if (before.price_minor !== after.price_minor) changes.push(`Price ${rupees(before.price_minor)} → ${rupees(after.price_minor)}`);
  if (before.estimated_days !== after.estimated_days) changes.push(`Estimated days ${before.estimated_days ?? "—"} → ${after.estimated_days ?? "—"}`);
  if (before.cover_letter !== after.cover_letter) changes.push("Introduction edited");
  const keys: Array<[keyof ProposalSections, string]> = [
    ["understanding", "Understanding"], ["approach", "Approach"], ["evidence", "Evidence"], ["deliverables", "Deliverables"], ["milestones", "Milestones"],
    ["assumptions", "Assumptions"], ["exclusions", "Exclusions"], ["questions", "Questions"], ["revision_rounds", "Revision rounds"]
  ];
  const a = before.sections ?? EMPTY_SECTIONS;
  const b = after.sections ?? EMPTY_SECTIONS;
  for (const [key, label] of keys) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) changes.push(`${label} changed`);
  }
  return changes;
}

/** Parses a stored sections_json value back into sections (null for the older form). */
export function parseSections(value: unknown): ProposalSections | null {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    understanding: typeof r.understanding === "string" ? r.understanding : "",
    approach: typeof r.approach === "string" ? r.approach : "",
    evidence: Array.isArray(r.evidence)
      ? r.evidence.filter((e): e is EvidenceItem => Boolean(e) && typeof (e as EvidenceItem).url === "string").map((e) => ({ url: e.url, note: typeof e.note === "string" ? e.note : "" }))
      : [],
    deliverables: strings(r.deliverables),
    milestones: Array.isArray(r.milestones)
      ? r.milestones.filter((m): m is ProposalMilestone => Boolean(m) && typeof (m as ProposalMilestone).title === "string").map((m) => ({ title: m.title, amount_minor: Number(m.amount_minor) }))
      : [],
    assumptions: strings(r.assumptions),
    exclusions: strings(r.exclusions),
    questions: strings(r.questions),
    revision_rounds: typeof r.revision_rounds === "number" ? r.revision_rounds : null
  };
}

/** What the client comparison shows from a proposal's sections (links stay in the proposal itself). */
export function studioSummary(s: ProposalSections | null) {
  if (!s) return null;
  return {
    deliverables: s.deliverables,
    milestones: s.milestones,
    assumptions: s.assumptions,
    exclusions: s.exclusions,
    questions: s.questions,
    revision_rounds: s.revision_rounds,
    evidence_count: s.evidence.length
  };
}
