import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRate, modeLabel, periodLabel, rupees, sampleNote } from './analytics-format.ts';

test('rates show their sample and warn when it is small', () => {
  assert.equal(formatRate({ value: 0.667, numerator: 2, denominator: 3, small_sample: true }), '67% (2 of 3)');
  assert.equal(formatRate({ value: null, numerator: 0, denominator: 0, small_sample: true }), 'No data yet');
  assert.match(sampleNote({ value: 0.5, numerator: 1, denominator: 2, small_sample: true }), /Small sample \(2\)/);
  assert.equal(sampleNote({ value: 0.5, numerator: 5, denominator: 10, small_sample: false }), '');
});

test('labels for money modes, amounts and periods', () => {
  assert.equal(modeLabel('sandbox'), 'Test mode (not real money)');
  assert.equal(rupees(1_234_500), '₹12,345');
  assert.equal(rupees(null), '—');
  assert.equal(periodLabel('2026-11'), 'Nov 26');
  assert.equal(periodLabel('2026-11-16'), '16 Nov');
});
