import { screenText } from "./listings";
import { sha256Hex } from "./core-routes";
import { parseSections } from "./proposal-studio";

/**
 * Proposals and two-party contract terms (Phase 3), deterministic rules only.
 *
 * Money is always integer minor units (paise for INR). Amounts are typed by
 * people — the freelancer sets the proposal price, the client sets offer
 * milestones — and the total is computed here, never by a model.
 */

export const PROPOSAL_STATUSES = ["submitted", "shortlisted", "declined", "withdrawn", "offered", "hired"] as const;
export const OPEN_PROPOSAL_STATUSES = ["submitted", "shortlisted"];
export const CONTRACT_STATUSES = ["offered", "active", "declined", "withdrawn", "completed", "cancelled"] as const;

export const MAX_AMOUNT_MINOR = 100_000_000_000; // ₹100 crore: far above any plausible project; guards typos and overflow.
export const MIN_AMOUNT_MINOR = 100; // ₹1

export type Party = "client" | "freelancer";

type Result<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };

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

function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_AMOUNT_MINOR && value <= MAX_AMOUNT_MINOR;
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function screened(fields: string[]): string[] {
  return screenText(fields.join("\n")).map((f) => f.code);
}

/* ------------------------------------------------------------------ */
/* Proposals                                                           */
/* ------------------------------------------------------------------ */

export interface ProposalInput {
  cover_letter: string;
  price_minor: number;
  estimated_days: number | null;
}

export function validateProposal(input: Record<string, unknown>): Result<ProposalInput> {
  const errors: Record<string, string> = {};
  const cover = text(input.cover_letter, 5000);
  if (cover.length < 50) errors.cover_letter = "Write at least 50 characters about how you would do the work.";
  else if (cover.length > 5000) errors.cover_letter = "Keep the proposal under 5,000 characters.";
  if (!isAmount(input.price_minor)) errors.price_minor = "Enter your price in rupees (at least ₹1).";
  let days: number | null = null;
  if (input.estimated_days !== undefined && input.estimated_days !== null && input.estimated_days !== "") {
    const n = Number(input.estimated_days);
    if (!Number.isInteger(n) || n < 1 || n > 730) errors.estimated_days = "Estimated days must be a whole number from 1 to 730.";
    else days = n;
  }
  if (!errors.cover_letter) {
    const codes = screened([cover]);
    if (codes.length) errors.cover_letter = "Keep contact and payment on the platform: remove phone numbers, emails, messaging apps or payment requests.";
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { cover_letter: cover, price_minor: input.price_minor as number, estimated_days: days } };
}

/* ------------------------------------------------------------------ */
/* Contract terms                                                      */
/* ------------------------------------------------------------------ */

export interface ContractMilestone {
  title: string;
  amount_minor: number;
  due_date: string | null;
}

export interface ContractTerms {
  title: string;
  scope: string;
  deliverables: string[];
  milestones: ContractMilestone[];
  total_minor: number;
  currency: string;
  revision_rounds: number;
  acceptance_criteria: string[];
  ownership_terms: string;
}

export function validateTerms(input: Record<string, unknown>, currency: string, today = new Date()): Result<ContractTerms> {
  const errors: Record<string, string> = {};
  const title = text(input.title, 160);
  if (title.length < 3 || title.length > 160) errors.title = "Title must be 3 to 160 characters.";
  const scope = text(input.scope, 8000);
  if (scope.length > 8000) errors.scope = "Keep the scope under 8,000 characters.";
  const deliverables = list(input.deliverables, 30, 300);
  if (!deliverables) errors.deliverables = "Up to 30 deliverables, each under 300 characters.";
  const acceptance = list(input.acceptance_criteria, 30, 300);
  if (!acceptance) errors.acceptance_criteria = "Up to 30 acceptance criteria, each under 300 characters.";
  const ownership = text(input.ownership_terms, 2000);
  if (ownership.length > 2000) errors.ownership_terms = "Keep ownership terms under 2,000 characters.";
  const revisions = input.revision_rounds === undefined ? 2 : Number(input.revision_rounds);
  if (!Number.isInteger(revisions) || revisions < 0 || revisions > 10) errors.revision_rounds = "Revision rounds must be 0 to 10.";
  if (input.currency !== undefined && input.currency !== currency) errors.currency = `Use the project currency (${currency}).`;

  const milestones: ContractMilestone[] = [];
  const todayStr = today.toISOString().slice(0, 10);
  if (!Array.isArray(input.milestones) || input.milestones.length < 1 || input.milestones.length > 20) {
    errors.milestones = "Add 1 to 20 milestones.";
  } else {
    input.milestones.forEach((raw, i) => {
      const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const mTitle = text(m.title, 160);
      const due = m.due_date === undefined || m.due_date === null || m.due_date === "" ? null : String(m.due_date);
      if (mTitle.length < 1 || mTitle.length > 160) errors[`milestones.${i}.title`] = "Each milestone needs a title (up to 160 characters).";
      if (!isAmount(m.amount_minor)) errors[`milestones.${i}.amount_minor`] = "Each milestone needs an amount of at least ₹1.";
      if (due !== null && (!isDate(due) || due < todayStr)) errors[`milestones.${i}.due_date`] = "Use a real date from today onwards.";
      milestones.push({ title: mTitle, amount_minor: Number(m.amount_minor), due_date: due });
    });
  }
  const total = milestones.reduce((sum, m) => sum + (Number.isInteger(m.amount_minor) ? m.amount_minor : 0), 0);
  if (!errors.milestones && total > MAX_AMOUNT_MINOR) errors.milestones = "The total is too large.";

  if (Object.keys(errors).length === 0) {
    const codes = screened([title, scope, ...(deliverables ?? []), ...(acceptance ?? []), ownership, ...milestones.map((m) => m.title)]);
    if (codes.length) errors.terms = "Keep contact and payment on the platform: remove phone numbers, emails, messaging apps or off-platform payment terms.";
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title,
      scope,
      deliverables: deliverables ?? [],
      milestones,
      total_minor: total,
      currency,
      revision_rounds: revisions,
      acceptance_criteria: acceptance ?? [],
      ownership_terms: ownership
    }
  };
}

export async function termsHash(terms: ContractTerms): Promise<string> {
  return sha256Hex(JSON.stringify(terms));
}

/* ------------------------------------------------------------------ */
/* Rows and output                                                     */
/* ------------------------------------------------------------------ */

export interface ProposalRow {
  id: string;
  listing_id: string;
  freelancer_user_id: string;
  invitation_id: string | null;
  status: string;
  cover_letter: string;
  price_minor: string | number;
  currency: string;
  budget_model: string;
  estimated_days: number | null;
  created_at: Date;
  updated_at: Date;
  decided_at: Date | null;
  /* Proposal Studio (migration 0067); absent before it runs. */
  sections_json?: unknown;
  current_version?: number | null;
  content_hash?: string | null;
  revision_requested_at?: Date | null;
  revision_note?: string | null;
}

export function proposalOut(row: ProposalRow) {
  return {
    id: row.id,
    listing_id: row.listing_id,
    freelancer_user_id: row.freelancer_user_id,
    invited: row.invitation_id !== null,
    status: row.status,
    cover_letter: row.cover_letter,
    price_minor: Number(row.price_minor),
    currency: row.currency,
    budget_model: row.budget_model,
    estimated_days: row.estimated_days,
    sections: parseSections(row.sections_json),
    current_version: Number(row.current_version ?? 1),
    content_hash: row.content_hash ?? null,
    revision_requested_at: row.revision_requested_at ? new Date(row.revision_requested_at).toISOString() : null,
    revision_note: row.revision_note ?? null,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString()
  };
}

export interface ContractRow {
  id: string;
  listing_id: string;
  proposal_id: string;
  organization_id: string;
  freelancer_user_id: string;
  status: string;
  current_version: number;
  created_at: Date;
  updated_at: Date;
  activated_at: Date | null;
  completed_at?: Date | null;
  agreed_version?: number | null;
}

export interface ContractVersionRow {
  version: number;
  title: string;
  scope: string;
  deliverables_json: string;
  milestones_json: string;
  total_minor: string | number;
  currency: string;
  revision_rounds: number;
  acceptance_json: string;
  ownership_terms: string;
  content_hash: string;
  proposed_by: string;
  created_at: Date;
  client_accepted_at: Date | null;
  freelancer_accepted_at: Date | null;
}

function parse<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

export function contractVersionOut(v: ContractVersionRow) {
  return {
    version: v.version,
    title: v.title,
    scope: v.scope,
    deliverables: parse<string>(v.deliverables_json),
    milestones: parse<ContractMilestone>(v.milestones_json),
    total_minor: Number(v.total_minor),
    currency: v.currency,
    revision_rounds: v.revision_rounds,
    acceptance_criteria: parse<string>(v.acceptance_json),
    ownership_terms: v.ownership_terms,
    content_hash: v.content_hash,
    proposed_by: v.proposed_by,
    created_at: new Date(v.created_at).toISOString(),
    client_accepted_at: iso(v.client_accepted_at),
    freelancer_accepted_at: iso(v.freelancer_accepted_at)
  };
}

/** True while an active contract has a proposed change (newer version) not yet accepted by both. */
export function hasPendingChange(contract: ContractRow): boolean {
  return contract.status === "active" && contract.agreed_version !== null && contract.agreed_version !== undefined && contract.current_version !== contract.agreed_version;
}

/** What the viewing party may do right now. */
export function contractActions(contract: ContractRow, version: ContractVersionRow, party: Party, canManage: boolean): string[] {
  const mayAct = party === "freelancer" || canManage;
  if (!mayAct) return [];
  const mineAccepted = party === "client" ? version.client_accepted_at !== null : version.freelancer_accepted_at !== null;
  if (contract.status === "offered") {
    const actions: string[] = [];
    if (!mineAccepted) actions.push("accept");
    actions.push("propose_changes");
    actions.push(party === "freelancer" ? "decline" : "withdraw");
    return actions;
  }
  if (contract.status === "active") {
    if (!hasPendingChange(contract)) return ["propose_changes"];
    const actions: string[] = [];
    if (!mineAccepted) actions.push("accept");
    actions.push("propose_changes", "reject_change");
    return actions;
  }
  return [];
}

/**
 * Change orders may not rewrite work that was already delivered: a milestone
 * with any delivery keeps its position, title and amount.
 */
export function lockedMilestoneErrors(agreed: ContractMilestone[], proposed: ContractMilestone[], deliveredIndexes: number[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const i of deliveredIndexes) {
    const before = agreed[i];
    const after = proposed[i];
    if (!before) continue;
    if (!after || after.title !== before.title || after.amount_minor !== before.amount_minor) {
      errors[`milestones.${i}.title`] = `Milestone ${i + 1} ("${before.title}") already has a delivery; keep its title and amount.`;
    }
  }
  return errors;
}
