import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeCommand } from './command-route.ts';

test('short commands jump to the right page; questions go to the coach, pre-filled', () => {
  assert.equal(routeCommand('earnings'), '/earnings');
  assert.equal(routeCommand('post a project'), '/client/projects');
  assert.equal(routeCommand('my contracts'), '/contracts');
  assert.equal(routeCommand('find projects'), '/projects');
  assert.equal(routeCommand('what next'), '/agent');
  assert.equal(routeCommand(''), '/agent');
  assert.equal(routeCommand('Which of my contracts needs attention first and why?'), '/coach?ask=Which%20of%20my%20contracts%20needs%20attention%20first%20and%20why%3F');
});

test('the command bar stays in the active portal', () => {
  assert.equal(routeCommand('find freelancers', 'client'), '/freelancers');
  assert.equal(routeCommand('search projects', 'client'), '/freelancers');
  assert.equal(routeCommand('my spend', 'client'), '/earnings?view=client');
  assert.equal(routeCommand('Which of my contracts needs attention first and why?', 'client'), '/agent');
  assert.equal(routeCommand('post a new project', 'client'), '/client/projects');
  assert.equal(routeCommand('find a user', 'admin'), '/admin');
  assert.equal(routeCommand('platform earnings', 'admin'), '/finance');
  assert.equal(routeCommand('', 'admin'), '/admin');
  assert.equal(routeCommand('how do I grow my revenue next quarter please', 'admin'), '/admin');
  assert.equal(routeCommand('notifications', 'admin'), '/notifications');
  assert.equal(routeCommand('my spend', 'freelancer'), '/earnings');
});
