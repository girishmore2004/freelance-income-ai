/**
 * Pure helpers for the Proposal Studio editor (no React, unit-tested).
 * Milestones are typed one per line as "Title | amount in rupees" and sent in
 * paise; the freelancer sets every amount, the platform never changes it.
 */

export type StudioMilestone = { title: string; amount_minor: number };
export type StudioEvidence = { url: string; note: string };
export type StudioSections = {
  understanding: string;
  approach: string;
  evidence: StudioEvidence[];
  deliverables: string[];
  milestones: StudioMilestone[];
  assumptions: string[];
  exclusions: string[];
  questions: string[];
  revision_rounds: number | null;
};

export type StudioForm = {
  cover: string;
  price: string;
  days: string;
  understanding: string;
  approach: string;
  deliverables: string;
  milestones: string;
  assumptions: string;
  exclusions: string;
  questions: string;
  revisions: string;
  evidence: StudioEvidence[];
};

export const EMPTY_FORM: StudioForm = {
  cover: '', price: '', days: '', understanding: '', approach: '', deliverables: '', milestones: '', assumptions: '', exclusions: '', questions: '', revisions: '', evidence: [],
};

export function lines(value: string): string[] {
  return value.split('\n').map((l) => l.trim()).filter(Boolean);
}

export function rupeesToPaise(value: string): number | null {
  const trimmed = value.trim().replace(/[,₹\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

/** "Design | 10000" → {title, amount_minor}. Returns the line numbers that could not be read. */
export function parseMilestones(value: string): { items: StudioMilestone[]; bad: number[] } {
  const items: StudioMilestone[] = [];
  const bad: number[] = [];
  lines(value).forEach((line, i) => {
    const at = line.lastIndexOf('|');
    const title = at >= 0 ? line.slice(0, at).trim() : '';
    const amount = at >= 0 ? rupeesToPaise(line.slice(at + 1)) : null;
    if (!title || amount === null || amount < 100) bad.push(i + 1);
    else items.push({ title, amount_minor: amount });
  });
  return { items, bad };
}

export function formatMilestones(items: StudioMilestone[]): string {
  return items.map((m) => `${m.title} | ${m.amount_minor % 100 === 0 ? m.amount_minor / 100 : (m.amount_minor / 100).toFixed(2)}`).join('\n');
}

export function hasSections(f: StudioForm): boolean {
  return Boolean(
    f.understanding.trim() || f.approach.trim() || f.deliverables.trim() || f.milestones.trim() || f.assumptions.trim() ||
    f.exclusions.trim() || f.questions.trim() || f.revisions.trim() || f.evidence.length,
  );
}

export type BuiltPayload =
  | { ok: true; payload: { cover_letter: string; price_minor: number; estimated_days: number | null; sections?: StudioSections } }
  | { ok: false; errors: Record<string, string> };

/** Builds the exact request body; the same body is checked, hashed and submitted. */
export function buildPayload(f: StudioForm): BuiltPayload {
  const errors: Record<string, string> = {};
  const price = rupeesToPaise(f.price);
  if (price === null || price < 100) errors.price_minor = 'Enter your price in rupees, for example 30000.';
  let days: number | null = null;
  if (f.days.trim()) {
    const n = Number(f.days);
    if (!Number.isInteger(n) || n < 1 || n > 730) errors.estimated_days = 'Estimated days must be a whole number from 1 to 730.';
    else days = n;
  }
  const milestones = parseMilestones(f.milestones);
  if (milestones.bad.length) errors['sections.milestones'] = `Write each milestone as "Title | amount" (check line ${milestones.bad.join(', ')}).`;
  let revisions: number | null = null;
  if (f.revisions.trim()) {
    const n = Number(f.revisions);
    if (!Number.isInteger(n) || n < 0 || n > 10) errors['sections.revision_rounds'] = 'Revision rounds must be 0 to 10.';
    else revisions = n;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  const base = { cover_letter: f.cover.trim(), price_minor: price as number, estimated_days: days };
  if (!hasSections(f)) return { ok: true, payload: base };
  return {
    ok: true,
    payload: {
      ...base,
      sections: {
        understanding: f.understanding.trim(),
        approach: f.approach.trim(),
        evidence: f.evidence.map((e) => ({ url: e.url, note: e.note.trim() })),
        deliverables: lines(f.deliverables),
        milestones: milestones.items,
        assumptions: lines(f.assumptions),
        exclusions: lines(f.exclusions),
        questions: lines(f.questions),
        revision_rounds: revisions,
      },
    },
  };
}

/** Fills the editor from a saved proposal. */
export function formFrom(p: { cover_letter: string; price_minor: number; estimated_days: number | null; sections?: StudioSections | null }): StudioForm {
  const s = p.sections;
  const rupees = p.price_minor % 100 === 0 ? String(p.price_minor / 100) : (p.price_minor / 100).toFixed(2);
  return {
    cover: p.cover_letter,
    price: rupees,
    days: p.estimated_days ? String(p.estimated_days) : '',
    understanding: s?.understanding ?? '',
    approach: s?.approach ?? '',
    deliverables: (s?.deliverables ?? []).join('\n'),
    milestones: formatMilestones(s?.milestones ?? []),
    assumptions: (s?.assumptions ?? []).join('\n'),
    exclusions: (s?.exclusions ?? []).join('\n'),
    questions: (s?.questions ?? []).join('\n'),
    revisions: s?.revision_rounds === null || s?.revision_rounds === undefined ? '' : String(s.revision_rounds),
    evidence: s?.evidence ?? [],
  };
}

/** One-line summary of the scope details for lists and comparison tables. */
export function scopeSummary(s: { deliverables: string[]; milestones: unknown[]; assumptions: string[]; exclusions: string[]; questions: string[] } | null | undefined): string {
  if (!s) return 'Short proposal';
  const part = (n: number, one: string, many: string) => (n ? `${n} ${n === 1 ? one : many}` : '');
  return [
    part(s.deliverables.length, 'deliverable', 'deliverables'),
    part(s.milestones.length, 'milestone', 'milestones'),
    part(s.assumptions.length, 'assumption', 'assumptions'),
    part(s.exclusions.length, 'exclusion', 'exclusions'),
    part(s.questions.length, 'question', 'questions'),
  ].filter(Boolean).join(' · ') || 'Short proposal';
}
