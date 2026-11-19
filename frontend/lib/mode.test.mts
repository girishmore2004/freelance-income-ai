import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAdminPath, modeForPath, sideOfHref, workspaceFor } from './mode.ts';

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

test('the Admin workspace keeps staff on account pages and never leaks into the sides', () => {
  // Staff pages are always Admin.
  assert.equal(workspaceFor('/admin', '', true, false, 'freelancer'), 'admin');
  assert.equal(workspaceFor('/analytics', '?view=platform', true, false, 'client'), 'admin');
  // From Admin, notifications, account, security and help stay in Admin.
  for (const p of ['/notifications', '/account', '/security', '/contact']) assert.equal(workspaceFor(p, '', true, true, 'freelancer'), 'admin', p);
  // Without coming from Admin they follow the chosen side.
  assert.equal(workspaceFor('/notifications', '', true, false, 'client'), 'client');
  // A side page always shows its side, even right after Admin.
  assert.equal(workspaceFor('/projects', '', true, true, 'client'), 'freelancer');
  assert.equal(workspaceFor('/client/projects', '', true, true, 'freelancer'), 'client');
  // Shared work pages (contracts, inbox) leave Admin for the chosen side.
  assert.equal(workspaceFor('/contracts', '', true, true, 'client'), 'client');
  // Non-staff never get Admin, even with a stale flag.
  assert.equal(workspaceFor('/admin', '', false, true, 'freelancer'), 'freelancer');
  assert.equal(workspaceFor('/notifications', '', false, true, 'client'), 'client');
  assert.equal(isAdminPath('/finance/'), true);
  assert.equal(isAdminPath('/ai-agents', '?view=admin'), true);
  assert.equal(isAdminPath('/ai-agents'), false);
});
