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
