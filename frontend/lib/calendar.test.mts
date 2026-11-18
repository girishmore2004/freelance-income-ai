import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayLabel, groupByDay, shiftDays } from './calendar.ts';

const ev = (date: string, title: string, overdue = false) => ({ date, type: 'milestone_due', title, detail: '', href: '/contracts', overdue, side: 'freelancer' as const });

test('groups by day with overdue first and friendly labels', () => {
  const groups = groupByDay([ev('2026-11-20', 'B'), ev('2026-11-18', 'A'), ev('2026-11-10', 'Late', true), ev('2026-11-20', 'C')], '2026-11-18');
  assert.deepEqual(groups.map((g) => [g.label, g.events.map((e) => e.title)]), [
    ['Overdue', ['Late']], ['Today', ['A']], [dayLabel('2026-11-20', '2026-11-18'), ['B', 'C']],
  ]);
  assert.equal(dayLabel('2026-11-19', '2026-11-18'), 'Tomorrow');
  assert.equal(shiftDays('2026-12-31', 1), '2027-01-01');
  assert.deepEqual(groupByDay([], '2026-11-18'), []);
});
