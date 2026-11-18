import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultTab, tabsFor } from './contract-tabs.ts';

test('each status shows only the tabs that apply', () => {
  assert.deepEqual(tabsFor('offered').map((t) => t.key), ['agreement', 'delivery', 'files', 'messages', 'activity']);
  assert.deepEqual(tabsFor('completed').map((t) => t.key), ['agreement', 'delivery', 'tasks', 'timeline', 'files', 'messages', 'payments', 'disputes', 'handover', 'reviews', 'activity']);
  assert.deepEqual(tabsFor('active').filter((t) => ['tasks', 'timeline', 'handover'].includes(t.key)).length, 3);
  assert.deepEqual(tabsFor('declined').map((t) => t.key), ['agreement']);
  assert.ok(tabsFor('cancelled').some((t) => t.key === 'disputes'));
});

test('a contract opens on the tab that needs attention', () => {
  assert.equal(defaultTab('offered'), 'agreement');
  assert.equal(defaultTab('active'), 'delivery');
  assert.equal(defaultTab('completed'), 'reviews');
  assert.equal(defaultTab('withdrawn'), 'agreement');
});
