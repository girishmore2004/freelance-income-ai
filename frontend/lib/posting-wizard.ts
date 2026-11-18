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
