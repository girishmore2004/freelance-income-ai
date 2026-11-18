import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultTab, nextStep, tabsFor } from './contract-tabs.ts';

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

test('hourly contracts show Hours instead of milestones', () => {
  const keys = tabsFor('active', true).map((t) => t.key);
  assert.ok(keys.includes('hours'));
  assert.ok(!keys.includes('delivery'));
  assert.ok(!tabsFor('active').map((t) => t.key).includes('hours'));
  assert.equal(defaultTab('active', true), 'hours');
  assert.equal(defaultTab('completed', true), 'reviews');
});

test('the next step points at the tab that needs attention', () => {
  assert.equal(nextStep('offered', 'freelancer', false, ['accept', 'decline'])?.tab, 'agreement');
  assert.match(nextStep('offered', 'client', false, ['withdraw'])?.text ?? '', /Waiting/);
  assert.equal(nextStep('active', 'freelancer', false, ['propose_changes'])?.tab, 'delivery');
  assert.equal(nextStep('active', 'client', false, ['propose_changes'])?.tab, 'payments');
  assert.equal(nextStep('active', 'client', false, [], false)?.tab, 'delivery');
  assert.equal(nextStep('active', 'freelancer', true, [])?.tab, 'hours');
  assert.equal(nextStep('active', 'client', false, ['accept'])?.tab, 'agreement');
  assert.equal(nextStep('completed', 'client', false, [])?.tab, 'reviews');
  assert.equal(nextStep('declined', 'client', false, []), null);
});
