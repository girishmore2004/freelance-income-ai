import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POSTING_STEPS, briefGaps, firstStepWithError } from './posting-wizard.ts';

test('the wizard has the ten steps of the spec, ending with review', () => {
  assert.equal(POSTING_STEPS.length, 10);
  assert.equal(POSTING_STEPS[0].key, 'describe');
  assert.equal(POSTING_STEPS[9].key, 'review');
});

test('a server error opens the earliest step that holds a failing field', () => {
  assert.equal(firstStepWithError({ deadline: 'x', title: 'y' }), 2);
  assert.equal(firstStepWithError({ 'milestones.0.title': 'x' }), 4);
  assert.equal(firstStepWithError({ visibility: 'x' }), 8);
  assert.equal(firstStepWithError({ unknown: 'x' }), null);
});

test('review lists what still blocks publication, matching the server rules', () => {
  const full = { outcome: 'Customers order cakes online for pickup.', deliverables: 'Order form', skills: 'Next.js', acceptance: 'Orders arrive', budget_max: '40000', deadline: '2030-01-01' };
  assert.deepEqual(briefGaps(full), []);
  assert.equal(briefGaps({ ...full, outcome: 'short', skills: ' , ', budget_max: '' }).length, 3);
});
