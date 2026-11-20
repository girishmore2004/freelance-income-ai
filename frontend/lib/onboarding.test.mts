import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billingGaps, clientGaps, freelancerGaps } from './onboarding.ts';

test('freelancer profile: name, headline, 3 skills, 50-character bio and an hourly rate (same as the server)', () => {
  const full = { full_name: 'Asha Rao', headline: 'Next.js developer for shops', skills: 'Next.js, React, SEO', bio: 'I build fast websites for local shops and cafes, with ordering and SEO.', hourly_rate: '1500' };
  assert.deepEqual(freelancerGaps(full), []);
  assert.deepEqual(freelancerGaps({ ...full, skills: 'React, , SEO' }).map((g) => g.key), ['skills']);
  assert.deepEqual(freelancerGaps({ full_name: '', headline: '', skills: '', bio: '', hourly_rate: '' }).map((g) => g.key), ['full_name', 'headline', 'skills', 'bio', 'hourly_rate']);
});

test('client profile: type, name, country, industry; billing separately', () => {
  assert.deepEqual(clientGaps({ kind: 'individual', name: 'Meera', country: 'IN', industry: '' }).map((g) => g.key), ['industry']);
  assert.deepEqual(clientGaps({ kind: 'company', name: 'Acme', country: 'India', industry: 'Food' }).map((g) => g.key), ['country']);
  assert.deepEqual(billingGaps({ billing_name: 'Acme LLP', billing_email: 'a@b.co' }), []);
  assert.deepEqual(billingGaps({ billing_name: '', billing_email: 'nope' }).map((g) => g.key), ['billing_name', 'billing_email']);
});
