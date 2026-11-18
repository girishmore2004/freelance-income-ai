import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeHref } from './safe-url.ts';

test('only absolute http(s) links survive', () => {
  assert.equal(safeHref('https://remotive.com/jobs/1'), 'https://remotive.com/jobs/1');
  assert.equal(safeHref('javascript:alert(1)'), '#');
  assert.equal(safeHref('data:text/html,x'), '#');
  assert.equal(safeHref('/x'), '#');
  assert.equal(safeHref(undefined), '#');
});
