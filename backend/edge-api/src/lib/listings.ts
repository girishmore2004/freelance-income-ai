import { sha256Hex } from "./core-routes";

/**
 * Native project listings (Phase 2; migration 0051).
 *
 * Lifecycle (Master Plan "Listing states"):
 *   draft → in_review (moderation) → published → hiring → closed
 *   alternatives: paused, cancelled, expired
 * Every edit creates an immutable version; the listing points at the current
 * version. Money is integer minor units (paise for INR).
 */

export const LISTING_STATUSES = ["draft", "in_review", "published", "hiring", "paused", "closed", "cancelled", "expired"] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const LISTING_ACTIONS = ["submit", "pause", "resume", "close", "cancel"] as const;
export type ListingAction = (typeof LISTING_ACTIONS)[number];

const TRANSITIONS: Record<ListingAction, ListingStatus[]> = {
  submit: ["draft"],
  pause: ["published"],
  resume: ["paused"],
  close: ["published", "paused", "hiring"],
  cancel: ["draft", "in_review", "published", "paused"]
};

/** Statuses in which the brief may be edited (a new version is created). */
export const EDITABLE_STATUSES: ListingStatus[] = ["draft", "in_review", "published", "paused"];

export function isListingAction(value: unknown): value is ListingAction {
  return typeof value === "string" && (LISTING_ACTIONS as readonly string[]).includes(value);
}

export function canTransition(status: string, action: ListingAction): boolean {
  return (TRANSITIONS[action] as string[]).includes(status);
}

/** Target status of a valid non-submit action. Submit depends on screening. */
export function nextStatus(action: Exclude<ListingAction, "submit">): ListingStatus {
  return ({ pause: "paused", resume: "published", close: "closed", cancel: "cancelled" } as const)[action];
}

/* ------------------------------------------------------------------ */
/* Brief validation                                                    */
/* ------------------------------------------------------------------ */

export interface Milestone {
  title: string;
  description: string;
}

export interface Brief {
  title: string;
  category_slug: string;
  outcome: string;
  description: string;
  deliverables: string[];
  skills: string[];
  experience_level: "any" | "entry" | "intermediate" | "expert";
  budget_model: "fixed" | "hourly";
  budget_min_minor: number | null;
  budget_max_minor: number | null;
  currency: string;
  deadline: string | null;
  milestones: Milestone[];
  acceptance_criteria: string[];
  revision_rounds: number;
  languages: string[];
  timezone: string;
  confidentiality: "standard" | "confidential";
  ownership_notes: string;
  assumptions: string[];
  visibility: "public" | "invite_only" | "private";
}

export type BriefValidation = { ok: true; brief: Brief } | { ok: false; errors: Record<string, string> };

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(CONTROL, "").trim().slice(0, max + 1) : "";
}

function list(value: unknown, maxItems: number, maxLength: number): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const out = value.map((item) => text(item, maxLength)).filter(Boolean);
  if (out.length > maxItems || out.some((item) => item.length > maxLength)) return null;
  return Array.from(new Set(out));
}

function minor(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 10_000_000_000) return undefined;
  return n;
}

/** Validates a full brief. Publication requirements are checked separately. */
export function validateBrief(input: Record<string, unknown>, categories: Set<string>, today = new Date()): BriefValidation {
  const errors: Record<string, string> = {};

  const title = text(input.title, 160);
  if (title.length < 5 || title.length > 160) errors.title = "Enter a title of 5 to 160 characters.";

  const category = text(input.category_slug, 60);
  if (!categories.has(category)) errors.category_slug = "Choose an available category.";

  const outcome = text(input.outcome, 2000);
  if (outcome.length > 2000) errors.outcome = "Keep the outcome under 2,000 characters.";
  const description = text(input.description, 8000);
  if (description.length > 8000) errors.description = "Keep the description under 8,000 characters.";

  const deliverables = list(input.deliverables, 20, 300);
  if (!deliverables) errors.deliverables = "Up to 20 deliverables of 300 characters each.";
  const skills = list(input.skills, 15, 60);
  if (!skills) errors.skills = "Up to 15 skills of 60 characters each.";
  const acceptance = list(input.acceptance_criteria, 20, 300);
  if (!acceptance) errors.acceptance_criteria = "Up to 20 acceptance criteria of 300 characters each.";
  const assumptions = list(input.assumptions, 20, 300);
  if (!assumptions) errors.assumptions = "Up to 20 assumptions of 300 characters each.";
  const languages = list(input.languages ?? ["en"], 5, 20);
  if (!languages || languages.some((l) => !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(l))) errors.languages = "Use language codes such as en or hi.";

  let milestones: Milestone[] = [];
  if (input.milestones !== undefined && input.milestones !== null) {
    if (!Array.isArray(input.milestones) || input.milestones.length > 12) {
      errors.milestones = "Up to 12 milestones.";
    } else {
      milestones = input.milestones
        .map((m) => (m && typeof m === "object" ? (m as Record<string, unknown>) : {}))
        .map((m) => ({ title: text(m.title, 120), description: text(m.description, 600) }))
        .filter((m) => m.title);
      if (milestones.some((m) => m.title.length > 120 || m.description.length > 600)) errors.milestones = "Milestone titles up to 120 and descriptions up to 600 characters.";
    }
  }

  const experience = input.experience_level ?? "any";
  if (!["any", "entry", "intermediate", "expert"].includes(String(experience))) errors.experience_level = "Choose any, entry, intermediate or expert.";
  const budgetModel = input.budget_model ?? "fixed";
  if (budgetModel !== "fixed" && budgetModel !== "hourly") errors.budget_model = "Choose fixed or hourly.";

  const min = minor(input.budget_min_minor);
  const max = minor(input.budget_max_minor);
  if (min === undefined) errors.budget_min_minor = "Enter the minimum budget as a whole amount in paise (or leave empty).";
  if (max === undefined) errors.budget_max_minor = "Enter the maximum budget as a whole amount in paise (or leave empty).";
  if (typeof min === "number" && typeof max === "number" && max < min) errors.budget_max_minor = "Maximum must be at least the minimum.";

  const currency = text(input.currency ?? "INR", 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) errors.currency = "Use a three-letter currency code such as INR.";

  let deadline: string | null = null;
  if (input.deadline !== undefined && input.deadline !== null && input.deadline !== "") {
    const raw = text(input.deadline, 10);
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00Z`) : null;
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) errors.deadline = "Use a date in YYYY-MM-DD format.";
    else if (parsed.getTime() < todayUtc) errors.deadline = "The deadline cannot be in the past.";
    else deadline = raw;
  }

  const revisions = input.revision_rounds === undefined ? 2 : Number(input.revision_rounds);
  if (!Number.isInteger(revisions) || revisions < 0 || revisions > 10) errors.revision_rounds = "Revision rounds must be 0 to 10.";

  const confidentiality = input.confidentiality ?? "standard";
  if (confidentiality !== "standard" && confidentiality !== "confidential") errors.confidentiality = "Choose standard or confidential.";
  const visibility = input.visibility ?? "public";
  if (!["public", "invite_only", "private"].includes(String(visibility))) errors.visibility = "Choose public, invite-only or private.";

  const timezone = text(input.timezone, 60);
  if (timezone && !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(timezone)) errors.timezone = "Use a time zone such as Asia/Kolkata.";
  const ownership = text(input.ownership_notes, 2000);

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    brief: {
      title,
      category_slug: category,
      outcome,
      description,
      deliverables: deliverables ?? [],
      skills: skills ?? [],
      experience_level: experience as Brief["experience_level"],
      budget_model: budgetModel as Brief["budget_model"],
      budget_min_minor: min ?? null,
      budget_max_minor: max ?? null,
      currency,
      deadline,
      milestones,
      acceptance_criteria: acceptance ?? [],
      revision_rounds: revisions,
      languages: languages ?? ["en"],
      timezone,
      confidentiality: confidentiality as Brief["confidentiality"],
      ownership_notes: ownership,
      assumptions: assumptions ?? [],
      visibility: visibility as Brief["visibility"]
    }
  };
}

/** Fields a brief must have before it can leave draft (Master Plan required inputs). */
export function publicationGaps(brief: Brief): string[] {
  const gaps: string[] = [];
  if (brief.outcome.length < 20) gaps.push("Describe the business outcome (at least 20 characters).");
  if (brief.deliverables.length === 0) gaps.push("List at least one deliverable.");
  if (brief.skills.length === 0) gaps.push("List at least one skill.");
  if (brief.acceptance_criteria.length === 0) gaps.push("Add at least one acceptance criterion.");
  if (brief.budget_max_minor === null) gaps.push("Set a budget (the platform never invents one).");
  if (!brief.deadline) gaps.push("Set a deadline.");
  return gaps;
}

/** Stable hash of the brief content (excluding visibility, which lives on the listing). */
export async function briefHash(brief: Brief): Promise<string> {
  const { visibility: _visibility, ...content } = brief;
  return sha256Hex(JSON.stringify(content, Object.keys(content).sort()));
}

/* ------------------------------------------------------------------ */
/* Basic listing screen (P1 Trust and Safety, deterministic)           */
/* ------------------------------------------------------------------ */

export interface ScreenFinding {
  code: "off_platform_contact" | "off_platform_payment" | "upfront_fee" | "prohibited_work" | "link_shortener";
  evidence: string;
}

const SCREEN_RULES: Array<{ code: ScreenFinding["code"]; pattern: RegExp }> = [
  { code: "off_platform_contact", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { code: "off_platform_contact", pattern: /(?:\+?\d[\s-]?){10,13}/ },
  { code: "off_platform_contact", pattern: /\b(whats\s?app|telegram|signal|wechat|skype)\b/i },
  { code: "off_platform_payment", pattern: /\b(pay|payment|paid)\s+(outside|off)[\s-]?(the\s+)?(platform|site)\b/i },
  { code: "off_platform_payment", pattern: /\b(crypto|usdt|bitcoin|gift\s?cards?)\b/i },
  { code: "upfront_fee", pattern: /\b(registration|joining|security|training|application)\s+(fee|deposit|charges?)\b/i },
  { code: "upfront_fee", pattern: /\bpay\s+(us|me)?\s*(to|before)\s+(apply|start|join)/i },
  { code: "prohibited_work", pattern: /\b(take|write|do)\s+my\s+(exam|test|assignment|thesis|homework)\b/i },
  { code: "prohibited_work", pattern: /\b(fake|buy|paid)\s+(reviews?|ratings?|followers?|likes?)\b/i },
  { code: "prohibited_work", pattern: /\b(hack|crack|ddos|phishing|carding|keylogger|bypass\s+captcha)\b/i },
  { code: "link_shortener", pattern: /\b(bit\.ly|tinyurl\.com|t\.co|goo\.gl|cutt\.ly|rb\.gy)\//i }
];

/**
 * Flags listings that need a human moderator before publication. A flag is
 * not a verdict: flagged listings wait in `in_review` for staff (Phase 7 admin).
 */
export function screenBrief(brief: Brief): ScreenFinding[] {
  return screenText([brief.title, brief.outcome, brief.description, ...brief.deliverables, ...brief.acceptance_criteria, brief.ownership_notes, ...brief.assumptions].join("\n"));
}

/** The same rules for any client-written text (e.g. invitation messages). */
export function screenText(haystack: string): ScreenFinding[] {
  const findings: ScreenFinding[] = [];
  for (const rule of SCREEN_RULES) {
    const match = haystack.match(rule.pattern);
    if (match && !findings.some((f) => f.code === rule.code)) findings.push({ code: rule.code, evidence: match[0].slice(0, 80) });
  }
  return findings;
}

/* ------------------------------------------------------------------ */
/* Closing date                                                        */
/* ------------------------------------------------------------------ */

export const MAX_OPEN_DAYS = 180;

/**
 * Optional `closes_at` (YYYY-MM-DD). Listings close at the end of that day
 * (23:59:59 UTC) and the 6-hourly job marks them expired. Must be between
 * tomorrow and MAX_OPEN_DAYS ahead. `undefined` = not provided.
 */
export function parseClosesAt(value: unknown, today = new Date()): { ok: true; value: string | null | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false, error: "Use a date (YYYY-MM-DD)." };
  const end = new Date(`${value}T23:59:59.000Z`);
  if (Number.isNaN(end.getTime()) || end.toISOString().slice(0, 10) !== value) return { ok: false, error: "Use a real date." };
  const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = (end.getTime() - startOfToday) / 86_400_000;
  if (days < 1) return { ok: false, error: "The closing date must be after today." };
  if (days > MAX_OPEN_DAYS + 1) return { ok: false, error: `Listings can stay open for at most ${MAX_OPEN_DAYS} days.` };
  return { ok: true, value: end.toISOString() };
}

/* ------------------------------------------------------------------ */
/* Output shapes                                                       */
/* ------------------------------------------------------------------ */

export interface ListingRow {
  id: string;
  organization_id: string;
  category_slug: string;
  status: string;
  visibility: string;
  moderation_status: string;
  moderation_notes: string;
  current_version: number;
  published_at: Date | null;
  closes_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface VersionRow {
  version: number;
  title: string;
  category_slug: string;
  outcome: string;
  description: string;
  deliverables_json: string;
  skills_json: string;
  experience_level: string;
  budget_model: string;
  budget_min_minor: string | number | null;
  budget_max_minor: string | number | null;
  currency: string;
  deadline: string | Date | null;
  milestones_json: string;
  acceptance_json: string;
  revision_rounds: number;
  languages_json: string;
  timezone: string;
  confidentiality: string;
  ownership_notes: string;
  assumptions_json: string;
  content_hash: string;
  created_at: Date;
}

function parseList<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function money(value: string | number | null): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function day(value: string | Date | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

export function versionOut(v: VersionRow) {
  return {
    version: v.version,
    title: v.title,
    category_slug: v.category_slug,
    outcome: v.outcome,
    description: v.description,
    deliverables: parseList<string>(v.deliverables_json),
    skills: parseList<string>(v.skills_json),
    experience_level: v.experience_level,
    budget_model: v.budget_model,
    budget_min_minor: money(v.budget_min_minor),
    budget_max_minor: money(v.budget_max_minor),
    currency: v.currency,
    deadline: day(v.deadline),
    milestones: parseList<Milestone>(v.milestones_json),
    acceptance_criteria: parseList<string>(v.acceptance_json),
    revision_rounds: v.revision_rounds,
    languages: parseList<string>(v.languages_json),
    timezone: v.timezone,
    confidentiality: v.confidentiality,
    ownership_notes: v.ownership_notes,
    assumptions: parseList<string>(v.assumptions_json),
    content_hash: v.content_hash,
    created_at: new Date(v.created_at).toISOString()
  };
}

/** What organisation members see. */
export function listingOut(listing: ListingRow, version: VersionRow) {
  return {
    id: listing.id,
    organization_id: listing.organization_id,
    status: listing.status,
    visibility: listing.visibility,
    moderation_status: listing.moderation_status,
    moderation_notes: listing.moderation_notes,
    current_version: listing.current_version,
    published_at: listing.published_at ? new Date(listing.published_at).toISOString() : null,
    closes_at: listing.closes_at ? new Date(listing.closes_at).toISOString() : null,
    created_at: new Date(listing.created_at).toISOString(),
    updated_at: new Date(listing.updated_at).toISOString(),
    brief: versionOut(version)
  };
}

/**
 * What freelancers see on the marketplace. Never includes the organisation's
 * billing details, internal notes, ownership notes or assumptions; a
 * confidential brief also hides the client's name and the long description.
 */
export function publicListingOut(listing: ListingRow, version: VersionRow, clientName: string) {
  const brief = versionOut(version);
  const confidential = brief.confidentiality === "confidential";
  return {
    id: listing.id,
    published_at: listing.published_at ? new Date(listing.published_at).toISOString() : null,
    closes_at: listing.closes_at ? new Date(listing.closes_at).toISOString() : null,
    visibility: listing.visibility,
    client_name: confidential ? "Confidential client" : clientName,
    title: brief.title,
    category_slug: brief.category_slug,
    outcome: brief.outcome,
    description: confidential ? "" : brief.description,
    deliverables: brief.deliverables,
    skills: brief.skills,
    experience_level: brief.experience_level,
    budget_model: brief.budget_model,
    budget_min_minor: brief.budget_min_minor,
    budget_max_minor: brief.budget_max_minor,
    currency: brief.currency,
    deadline: brief.deadline,
    milestones: brief.milestones.map((m) => m.title),
    acceptance_criteria: brief.acceptance_criteria,
    revision_rounds: brief.revision_rounds,
    languages: brief.languages,
    timezone: brief.timezone,
    confidential
  };
}
