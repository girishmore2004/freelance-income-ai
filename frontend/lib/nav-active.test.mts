import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isActive } from './nav-active.ts';

const FIND = ['/projects', '/projects?view=saved', '/projects?view=proposals', '/'];

test('one sidebar link is lit: a view link matches its view, the plain link only when no view link matches', () => {
  assert.equal(isActive('/projects', '/projects', '', FIND), true);
  assert.equal(isActive('/projects', '/projects', '?view=saved', FIND), false);
  assert.equal(isActive('/projects', '/projects?view=saved', '?view=saved', FIND), true);
  assert.equal(isActive('/projects', '/projects?view=proposals', '?view=saved', FIND), false);
  assert.equal(isActive('/projects', '/projects', '?q=logo', FIND), true);
  assert.equal(isActive('/', '/', '', FIND), true);
  assert.equal(isActive('/projects', '/', '', FIND), false);
  assert.equal(isActive('/client/projects/new', '/client/projects', '', []), true);
  assert.equal(isActive('/earnings', '/earnings?view=client', '?view=client', []), true);
  assert.equal(isActive('/earnings', '/earnings?view=client', '', []), false);
});
