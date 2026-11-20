/**
 * Steps of the project posting wizard (PRODUCT_EXPERIENCE_SPEC §8) and which
 * step holds each brief field, so a server validation error opens the step
 * where the client can fix it. Pure data, unit-tested.
 */

/**
 * Four steps (simplified 2026-11-18 from ten): each step shows several parts of
 * the brief. `parts` are the sections the page renders inside the step.
 */
export const POSTING_PARTS = ['describe', 'category', 'outcome', 'skills', 'acceptance', 'references', 'budget', 'timeline', 'visibility', 'review'] as const;
export type PostingPart = (typeof POSTING_PARTS)[number];

export const POSTING_STEPS: ReadonlyArray<{ key: string; label: string; parts: readonly PostingPart[] }> = [
  { key: 'describe', label: 'Describe the project', parts: ['describe', 'category'] },
  { key: 'scope', label: 'Scope and skills', parts: ['outcome', 'skills', 'acceptance', 'references'] },
  { key: 'budget', label: 'Budget and dates', parts: ['budget', 'timeline'] },
  { key: 'review', label: 'Review and publish', parts: ['visibility', 'review'] },
];

/** The step index that shows a part. */
export function stepOfPart(part: PostingPart): number {
  return POSTING_STEPS.findIndex((s) => s.parts.includes(part));
}

const FIELD_STEP: Record<string, PostingPart> = {
  description: 'describe',
  category_slug: 'category',
  title: 'outcome',
  outcome: 'outcome',
  deliverables: 'outcome',
  budget_model: 'budget',
  budget_min_minor: 'budget',
  budget_max_minor: 'budget',
  currency: 'budget',
  deadline: 'timeline',
  closes_at: 'timeline',
  milestones: 'timeline',
  skills: 'skills',
  experience_level: 'skills',
  languages: 'skills',
  timezone: 'skills',
  acceptance_criteria: 'acceptance',
  revision_rounds: 'acceptance',
  assumptions: 'acceptance',
  ownership_notes: 'acceptance',
  visibility: 'visibility',
  confidentiality: 'visibility',
};

/** The earliest step that has an error, or null when no error maps to a step. */
export function firstStepWithError(errors: Record<string, string>): number | null {
  let best: number | null = null;
  for (const field of Object.keys(errors)) {
    const part = FIELD_STEP[field.split('.')[0]];
    if (!part) continue;
    const index = stepOfPart(part);
    if (best === null || index < best) best = index;
  }
  return best;
}

/** Plain-language gaps shown on the review step before the client submits (mirrors the server's publicationGaps). */
export function briefGaps(f: { outcome: string; deliverables: string; skills: string; acceptance: string; budget_max: string; deadline: string }): string[] {
  const gaps: string[] = [];
  if (f.outcome.trim().length < 20) gaps.push('Describe the business outcome (at least 20 characters).');
  if (!f.deliverables.trim()) gaps.push('List at least one deliverable.');
  if (!f.skills.split(',').some((s) => s.trim())) gaps.push('List at least one skill.');
  if (!f.acceptance.trim()) gaps.push('Add at least one acceptance criterion.');
  if (!f.budget_max.trim()) gaps.push('Set a maximum budget (the platform never invents one).');
  if (!f.deadline) gaps.push('Set a deadline.');
  return gaps;
}

/** Form values the wizard checks (rupee amounts and dates as typed). */
export type BriefFormValues = {
  category_slug: string; title: string; outcome: string; deliverables: string; skills: string; acceptance: string;
  budget_min: string; budget_max: string; deadline: string; closes_at: string; revision_rounds: string;
};

/** Fields marked ★ in the wizard: the server needs them to publish (U31). */
export const REQUIRED_BRIEF_FIELDS = ['category_slug', 'title', 'outcome', 'deliverables', 'skills', 'acceptance_criteria', 'budget_max_minor', 'deadline'] as const;

const AMOUNT = /^\d+(\.\d{1,2})?$/;
const lines = (v: string) => v.split('\n').map((s) => s.trim()).filter(Boolean);
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Every problem in the brief, keyed like the server's fields, with the same rules the
 * server applies to publish (validateBrief + publicationGaps). Pure; `today` is YYYY-MM-DD.
 */
export function briefErrors(f: BriefFormValues, today: string = isoDay(new Date())): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.category_slug) e.category_slug = 'Choose a work category.';
  const title = f.title.trim();
  if (title.length < 5 || title.length > 160) e.title = 'Enter a title of 5 to 160 characters.';
  if (f.outcome.trim().length < 20) e.outcome = 'Describe the business outcome in at least 20 characters.';
  if (!lines(f.deliverables).length) e.deliverables = 'List at least one deliverable (one per line).';
  if (!f.skills.split(',').some((s) => s.trim())) e.skills = 'List at least one skill.';
  if (!lines(f.acceptance).length) e.acceptance_criteria = 'Add at least one acceptance criterion (one per line).';
  const rounds = Number(f.revision_rounds);
  if (!Number.isInteger(rounds) || rounds < 0 || rounds > 10) e.revision_rounds = 'Enter 0 to 10 revision rounds.';
  const min = f.budget_min.trim().replace(/,/g, '');
  const max = f.budget_max.trim().replace(/,/g, '');
  if (min && !AMOUNT.test(min)) e.budget_min_minor = 'Enter an amount in rupees, for example 25000.';
  if (!max) e.budget_max_minor = 'Set a maximum budget (the platform never invents one).';
  else if (!AMOUNT.test(max) || Number(max) <= 0) e.budget_max_minor = 'Enter an amount in rupees, for example 50000.';
  else if (min && AMOUNT.test(min) && Number(max) < Number(min)) e.budget_max_minor = 'The maximum must be at least the minimum.';
  if (!f.deadline) e.deadline = 'Set a deadline.';
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(f.deadline)) e.deadline = 'Use a valid date.';
  else if (f.deadline < today) e.deadline = 'The deadline cannot be in the past.';
  if (f.closes_at) {
    const limit = new Date(`${today}T00:00:00`);
    limit.setDate(limit.getDate() + 180);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.closes_at) || f.closes_at < today) e.closes_at = 'Choose a date from today on.';
    else if (f.closes_at > isoDay(limit)) e.closes_at = 'Choose a date within 180 days.';
  }
  return e;
}

/** Only the problems on one step, so "Next" can stop there. Pure. */
export function stepErrors(f: BriefFormValues, step: number, today?: string): Record<string, string> {
  const all = briefErrors(f, today);
  const parts = POSTING_STEPS[step]?.parts ?? [];
  return Object.fromEntries(Object.entries(all).filter(([field]) => parts.includes(FIELD_STEP[field] as PostingPart)));
}
