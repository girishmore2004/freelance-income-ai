import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMinutes, parseDuration } from './hours.ts';

test('durations', () => {
  assert.equal(parseDuration('1:30'), 90);
  assert.equal(parseDuration('1.5'), 90);
  assert.equal(parseDuration('1.5h'), 90);
  assert.equal(parseDuration('90m'), 90);
  assert.equal(parseDuration('2h 15m'), 135);
  assert.equal(parseDuration('45'), 45);
  assert.equal(parseDuration('2'), 120);
  assert.equal(parseDuration('0'), null);
  assert.equal(parseDuration('25:00'), null);
  assert.equal(parseDuration('abc'), null);
  assert.equal(parseDuration(''), null);
});

test('formatting', () => {
  assert.equal(formatMinutes(170), '2 h 50 min');
  assert.equal(formatMinutes(120), '2 h');
  assert.equal(formatMinutes(45), '45 min');
  assert.equal(formatMinutes(0), '0 min');
});
