import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modeForPath, sideOfHref } from './mode.ts';

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
  assert.equal(modeForPath('/calendar'), null);
  // The older freelancer tools (a freelancer's own clients, invoices, job sources) never open on the client side.
  for (const p of ['/clients', '/client-insights', '/opportunity-intelligence', '/marketplaces', '/delivery', '/agent-workflows', '/payments', '/analytics/planning', '/coach']) assert.equal(modeForPath(p), 'freelancer', p);
  assert.equal(modeForPath('/analytics'), null);
});

test('links belong to the side of the page they open', () => {
  assert.equal(sideOfHref('/client/projects#L1'), 'client');
  assert.equal(sideOfHref('/projects?view=external'), 'freelancer');
  assert.equal(sideOfHref('/contracts#K1'), null);
  assert.equal(sideOfHref('https://x.dev'), null);
  assert.equal(sideOfHref(undefined), null);
});
