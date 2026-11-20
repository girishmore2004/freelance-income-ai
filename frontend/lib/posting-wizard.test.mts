import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POSTING_STEPS, briefGaps, firstStepWithError } from './posting-wizard.ts';

test('the wizard has four steps covering every part of the brief once, ending with review', () => {
  assert.equal(POSTING_STEPS.length, 4);
  assert.equal(POSTING_STEPS[0].key, 'describe');
  assert.equal(POSTING_STEPS[3].key, 'review');
  const parts = POSTING_STEPS.flatMap((s) => s.parts);
  assert.equal(new Set(parts).size, parts.length);
  assert.equal(parts.length, 10);
});

test('a server error opens the earliest step that holds a failing field', () => {
  assert.equal(firstStepWithError({ deadline: 'x', title: 'y' }), 1);
  assert.equal(firstStepWithError({ 'milestones.0.title': 'x' }), 2);
  assert.equal(firstStepWithError({ visibility: 'x' }), 3);
  assert.equal(firstStepWithError({ category_slug: 'x' }), 0);
  assert.equal(firstStepWithError({ unknown: 'x' }), null);
});

test('review lists what still blocks publication, matching the server rules', () => {
  const full = { outcome: 'Customers order cakes online for pickup.', deliverables: 'Order form', skills: 'Next.js', acceptance: 'Orders arrive', budget_max: '40000', deadline: '2030-01-01' };
  assert.deepEqual(briefGaps(full), []);
  assert.equal(briefGaps({ ...full, outcome: 'short', skills: ' , ', budget_max: '' }).length, 3);
});

const good = { category_slug: 'website_development', title: 'Bakery ordering site', outcome: 'Customers order cakes online and pick a time.', deliverables: 'Order form', skills: 'Next.js', acceptance: 'Works on mobile', budget_min: '20000', budget_max: '40000', deadline: '2026-12-20', closes_at: '', revision_rounds: '2' };

test('U31: the wizard checks the same rules as the server before publishing', async () => {
  const { briefErrors, REQUIRED_BRIEF_FIELDS } = await import('./posting-wizard.ts');
  assert.deepEqual(briefErrors(good, '2026-11-20'), {});
  const empty = briefErrors({ ...good, category_slug: '', title: 'Cake', outcome: 'Short', deliverables: ' \n ', skills: ' , ', acceptance: '', budget_max: '', deadline: '' }, '2026-11-20');
  assert.deepEqual(Object.keys(empty).sort(), [...REQUIRED_BRIEF_FIELDS].sort());
  assert.match(briefErrors({ ...good, budget_min: '50000' }, '2026-11-20').budget_max_minor, /at least the minimum/);
  assert.match(briefErrors({ ...good, budget_max: '4o000' }, '2026-11-20').budget_max_minor, /rupees/);
  assert.match(briefErrors({ ...good, deadline: '2026-11-19' }, '2026-11-20').deadline, /past/);
  assert.equal(briefErrors({ ...good, deadline: '2026-11-20' }, '2026-11-20').deadline, undefined);
  assert.match(briefErrors({ ...good, closes_at: '2027-06-30' }, '2026-11-20').closes_at, /180 days/);
  assert.match(briefErrors({ ...good, revision_rounds: '11' }, '2026-11-20').revision_rounds, /0 to 10/);
});

test('U31: "Next" stops only on problems shown on the current step', async () => {
  const { stepErrors } = await import('./posting-wizard.ts');
  const bad = { ...good, title: '', budget_max: '' };
  assert.deepEqual(Object.keys(stepErrors(bad, 0, '2026-11-20')), []);
  assert.deepEqual(Object.keys(stepErrors(bad, 1, '2026-11-20')), ['title']);
  assert.deepEqual(Object.keys(stepErrors(bad, 2, '2026-11-20')), ['budget_max_minor']);
});
