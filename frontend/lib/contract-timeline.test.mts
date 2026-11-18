import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, taskProgress } from './contract-timeline.ts';

test('timeline orders past events and due dates, marking overdue and done', () => {
  const t = buildTimeline(
    [{ index: 0, title: 'Design', due_date: '2026-11-10', state: 'approved' }, { index: 1, title: 'Build', due_date: '2026-11-15', state: 'pending' }, { index: 2, title: 'Launch', due_date: null, state: 'pending' }],
    [{ id: 'T1', title: 'Staging', due_date: '2026-11-25', status: 'todo', owner_party: 'freelancer', milestone_index: 1 }, { id: 'T2', title: 'No date', due_date: null, status: 'todo', owner_party: 'client', milestone_index: null }],
    [{ type: 'contract.activated', created_at: '2026-11-01T10:00:00Z', details: {} }, { type: 'unknown.event', created_at: '2026-11-02T10:00:00Z', details: {} }],
    '2026-11-18',
  );
  assert.deepEqual(t.map((e) => `${e.date} ${e.kind} ${e.text}`), [
    '2026-11-01 past Contract became active',
    '2026-11-10 done Milestone 1 due: Design',
    '2026-11-15 overdue Milestone 2 due: Build',
    '2026-11-25 due Task (freelancer): Staging',
  ]);
});

test('task progress', () => {
  assert.equal(taskProgress([]), null);
  assert.deepEqual(taskProgress([{ id: 'a', title: 'a', due_date: null, status: 'done', owner_party: 'client', milestone_index: null }, { id: 'b', title: 'b', due_date: null, status: 'todo', owner_party: 'client', milestone_index: null }]), { done: 1, total: 2 });
});
