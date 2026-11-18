/**
 * Steps of the project posting wizard (PRODUCT_EXPERIENCE_SPEC §8) and which
 * step holds each brief field, so a server validation error opens the step
 * where the client can fix it. Pure data, unit-tested.
 */

export const POSTING_STEPS = [
  { key: 'describe', label: 'Describe the need' },
  { key: 'category', label: 'Category' },
  { key: 'outcome', label: 'Outcome and deliverables' },
  { key: 'budget', label: 'Budget and model' },
  { key: 'timeline', label: 'Deadline and milestones' },
  { key: 'skills', label: 'Skills and experience' },
  { key: 'references', label: 'References and files' },
  { key: 'acceptance', label: 'Revisions and acceptance' },
  { key: 'visibility', label: 'Visibility' },
  { key: 'review', label: 'Review and publish' },
] as const;

export type PostingStep = (typeof POSTING_STEPS)[number]['key'];

const FIELD_STEP: Record<string, PostingStep> = {
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
    const step = FIELD_STEP[field.split('.')[0]];
    if (!step) continue;
    const index = POSTING_STEPS.findIndex((s) => s.key === step);
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
