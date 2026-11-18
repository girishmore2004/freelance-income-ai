import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modeForPath } from './mode.ts';

test('pages belong to one side or are shared', () => {
  assert.equal(modeForPath('/client/projects'), 'client');
  assert.equal(modeForPath('/freelancers'), 'client');
  assert.equal(modeForPath('/services'), 'client');
  assert.equal(modeForPath('/services', '?view=mine'), 'freelancer');
  assert.equal(modeForPath('/earnings'), 'freelancer');
  assert.equal(modeForPath('/earnings', '?view=client'), 'client');
  assert.equal(modeForPath('/projects/'), 'freelancer');
  assert.equal(modeForPath('/profile'), 'freelancer');
  assert.equal(modeForPath('/'), 'freelancer');
  assert.equal(modeForPath('/contracts'), null);
  assert.equal(modeForPath('/inbox'), null);
  assert.equal(modeForPath('/workspace'), null);
});
