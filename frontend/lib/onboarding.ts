/**
 * Profile completeness shown live on the profile forms (U31, founder decision D-31).
 * Same rules as the Edge API's onboarding.ts, so a form says "complete" exactly when the
 * overview does. Warn only: nothing here blocks saving or sending. Pure.
 */
export type Gap = { key: string; label: string };

export function freelancerGaps(p: { full_name: string; headline: string; skills: string; bio: string; hourly_rate: string }): Gap[] {
  const gaps: Gap[] = [];
  if (p.full_name.trim().length < 2) gaps.push({ key: 'full_name', label: 'Your name' });
  if (p.headline.trim().length < 10) gaps.push({ key: 'headline', label: 'A one-line headline (10+ characters)' });
  if (p.skills.split(',').filter((s) => s.trim()).length < 3) gaps.push({ key: 'skills', label: 'At least 3 skills' });
  if (p.bio.trim().length < 50) gaps.push({ key: 'bio', label: 'A short bio (50+ characters)' });
  if (!(Number(p.hourly_rate) > 0)) gaps.push({ key: 'hourly_rate', label: 'Your hourly rate' });
  return gaps;
}

export function clientGaps(o: { kind: string; name: string; country: string; industry: string }): Gap[] {
  const gaps: Gap[] = [];
  if (!['individual', 'company'].includes(o.kind)) gaps.push({ key: 'kind', label: 'Account type' });
  if (o.name.trim().length < 2) gaps.push({ key: 'name', label: 'Name' });
  if (!/^[A-Za-z]{2}$/.test(o.country.trim())) gaps.push({ key: 'country', label: 'Country' });
  if (o.industry.trim().length < 2) gaps.push({ key: 'industry', label: 'Industry' });
  return gaps;
}

export function billingGaps(o: { billing_name: string; billing_email: string }): Gap[] {
  const gaps: Gap[] = [];
  if (o.billing_name.trim().length < 2) gaps.push({ key: 'billing_name', label: 'Billing name' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.billing_email.trim())) gaps.push({ key: 'billing_email', label: 'Billing email' });
  return gaps;
}
