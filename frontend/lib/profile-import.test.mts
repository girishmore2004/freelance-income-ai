import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPicks, defaultPicks, mergeUnique, scoreLabel, splitList } from './profile-import.ts';

const s = {
  headline: 'Next.js developer', summary: 'Builds ordering sites.', skills: ['Next.js', 'Stripe'], services: ['Online stores'],
  projects: [{ title: 'Bakery site', description: 'Ordering', skills: ['Next.js'], link: 'https://b.dev/', year: '2024' }, { title: 'Dashboard', description: '', skills: [], link: '', year: '' }],
  links: ['https://b.dev/'],
};

test('lists split and merge without duplicates', () => {
  assert.deepEqual(splitList(' a, b ,,c\n d'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(mergeUnique(['NextJS', 'React'], ['next.js', 'Stripe', ' ']), ['NextJS', 'React', 'Stripe']);
});

test('ticked suggestions fill empty fields and merge lists', () => {
  const form = { headline: '', bio: 'My own bio', skills: 'React, nextjs', services: '', links: '' };
  const picks = { ...defaultPicks(s), projects: [0] };
  const r = applyPicks(form, [], s, picks);
  assert.equal(r.form.headline, 'Next.js developer');
  assert.equal(r.form.bio, 'My own bio');
  assert.equal(r.form.skills, 'React, nextjs, Stripe');
  assert.equal(r.form.services, 'Online stores');
  assert.equal(r.form.links, 'https://b.dev/');
  assert.deepEqual(r.projects.map((p) => p.title), ['Bakery site']);
  assert.equal(r.added, 5);
  assert.equal(applyPicks(form, [], s, picks, true).form.bio, 'Builds ordering sites.');
  assert.equal(applyPicks(form, r.projects, s, picks).projects.length, 1);
});

test('unticked items are left out', () => {
  const r = applyPicks({ headline: '', bio: '', skills: '', services: '', links: '' }, [], s, { headline: false, summary: false, skills: ['Stripe'], services: [], projects: [], links: [] });
  assert.equal(r.form.headline, '');
  assert.equal(r.form.skills, 'Stripe');
  assert.equal(r.added, 1);
});

test('score labels', () => {
  assert.equal(scoreLabel(85), 'Strong match');
  assert.equal(scoreLabel(60), 'Good match');
  assert.equal(scoreLabel(45), 'Possible match');
  assert.equal(scoreLabel(10), 'Weak match');
});
