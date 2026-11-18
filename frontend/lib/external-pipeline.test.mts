import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXTERNAL_STATUS_LABELS, transitionLabel } from './external-pipeline.ts';

test('every lifecycle status has a label and every manual move an action name', () => {
  for (const s of ['new', 'drafted', 'ready', 'applied', 'replied', 'interview', 'offer', 'won', 'lost', 'withdrawn', 'skipped']) assert.ok(EXTERNAL_STATUS_LABELS[s]);
  assert.equal(transitionLabel('applied'), 'I applied — record submission');
  assert.equal(transitionLabel('new'), 'Reopen');
  assert.equal(transitionLabel('mystery'), 'mystery');
});
