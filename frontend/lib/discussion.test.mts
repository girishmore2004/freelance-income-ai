import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTERVIEW_LABELS, inboxThreads, isDiscussion, localInputToIso, needsReplyCount } from './discussion.ts';

test('every interview status has a label', () => {
  for (const s of ['proposed', 'accepted', 'declined', 'cancelled', 'completed']) assert.ok(INTERVIEW_LABELS[s]);
});

test('shape guards reject unexpected payloads', () => {
  assert.equal(isDiscussion([]), false);
  assert.equal(isDiscussion({ party: 'client', messages: [], interviews: [] }), true);
  assert.deepEqual(inboxThreads({}), []);
  const t = { kind: 'proposal', id: 'p', title: 'x', last_message: '', last_at: '', from_other_side: true, href: '/' };
  assert.deepEqual(inboxThreads([t, { kind: 'other', id: 'q', title: 'y' }, null]), [t]);
  assert.equal(needsReplyCount([t, { ...t, from_other_side: false }]), 1);
});

test('local date-time input converts to an instant', () => {
  assert.equal(localInputToIso(''), null);
  assert.equal(localInputToIso('tomorrow'), null);
  assert.equal(typeof localInputToIso('2026-11-20T10:30'), 'string');
});
