import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_FORM, buildPayload, formFrom, formatMilestones, parseMilestones, scopeSummary } from './proposal-studio.ts';

test('milestones are read as "Title | rupees" and reported by line when unreadable', () => {
  assert.deepEqual(parseMilestones('Design | 10,000\nBuild | ₹20000.50\n\nLaunch'), {
    items: [{ title: 'Design', amount_minor: 1_000_000 }, { title: 'Build', amount_minor: 2_000_050 }],
    bad: [3],
  });
  assert.equal(formatMilestones([{ title: 'Design', amount_minor: 1_000_000 }, { title: 'Build', amount_minor: 2_000_050 }]), 'Design | 10000\nBuild | 20000.50');
});

test('a proposal without sections stays a short proposal (no sections key)', () => {
  const built = buildPayload({ ...EMPTY_FORM, cover: '  Plan  ', price: '30000', days: '21' });
  assert.deepEqual(built, { ok: true, payload: { cover_letter: 'Plan', price_minor: 3_000_000, estimated_days: 21 } });
});

test('sections are trimmed into lists, and bad numbers are reported, never guessed', () => {
  const built = buildPayload({ ...EMPTY_FORM, cover: 'x', price: '25000', deliverables: 'Site\n\n Admin ', milestones: 'A | 10000\nB | 15000', revisions: '2', questions: 'Hosting?' });
  assert.equal(built.ok, true);
  if (built.ok) {
    assert.deepEqual(built.payload.sections?.deliverables, ['Site', 'Admin']);
    assert.equal(built.payload.sections?.milestones.length, 2);
    assert.equal(built.payload.sections?.revision_rounds, 2);
  }
  const bad = buildPayload({ ...EMPTY_FORM, cover: 'x', price: 'abc', days: '0', revisions: '20', milestones: 'Nope' });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.deepEqual(Object.keys(bad.errors).sort(), ['estimated_days', 'price_minor', 'sections.milestones', 'sections.revision_rounds']);
});

test('a saved proposal fills the editor and builds back to the same body', () => {
  const saved = {
    cover_letter: 'Intro', price_minor: 2_500_000, estimated_days: 10,
    sections: { understanding: 'U', approach: 'A', evidence: [{ url: 'https://example.dev/a', note: 'n' }], deliverables: ['D'], milestones: [{ title: 'M', amount_minor: 2_500_000 }], assumptions: [], exclusions: ['E'], questions: [], revision_rounds: 1 },
  };
  const built = buildPayload(formFrom(saved));
  assert.deepEqual(built, { ok: true, payload: saved });
});

test('scope summary counts only what is there', () => {
  assert.equal(scopeSummary(null), 'Short proposal');
  assert.equal(scopeSummary({ deliverables: ['a', 'b'], milestones: [1], assumptions: [], exclusions: ['x'], questions: [] }), '2 deliverables · 1 milestone · 1 exclusion');
});
