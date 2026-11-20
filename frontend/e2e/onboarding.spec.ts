import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * U31 onboarding (founder decision D-31): "Get started" on each overview, ★ on required
 * fields, "Next" checks the step, warnings that never block, and only the clicked button
 * shows that it is working. The Edge API is mocked; runs in bearer and cookie modes.
 */

const ok = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });

async function signIn(page: Page, mode: 'client' | 'freelancer'): Promise<void> {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
  await page.addInitScript((m) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('fia_mode', m); sessionStorage.setItem('seeded', '1'); } }, mode);
}

const clientSteps = [
  { key: 'profile', label: 'Complete your client profile', why: 'Freelancers trust complete profiles and reply sooner.', href: '/client/profile', done: false },
  { key: 'post', label: 'Post your first project', why: 'Four short steps.', href: '/client/projects', done: false },
  { key: 'proposals', label: 'Get proposals or invite freelancers', why: '', href: '/client/projects', done: false },
  { key: 'hire', label: 'Hire: send an offer the freelancer accepts', why: '', href: '/client/projects', done: false },
  { key: 'billing', label: 'Add billing name and email', why: '', href: '/client/profile', done: false },
  { key: 'fund', label: 'Fund the first milestone', why: '', href: '/contracts', done: false },
  { key: 'approve', label: 'Approve a delivery and pay', why: '', href: '/contracts', done: false },
];
const clientOnboarding = {
  applies: true, side: 'client', steps: clientSteps, next: 'profile', done: 0, total: 7, complete: false,
  profile_gaps: [{ key: 'industry', label: 'Industry' }], billing_gaps: [{ key: 'billing_name', label: 'Billing name' }, { key: 'billing_email', label: 'Billing email' }],
};
const freelancerOnboarding = {
  applies: true, side: 'freelancer', next: 'proposal', done: 2, total: 6, complete: false, profile_gaps: [], billing_gaps: [],
  steps: [
    { key: 'profile', label: 'Complete your profile', why: '', href: '/profile', done: true },
    { key: 'visible', label: 'Show your profile to clients', why: '', href: '/projects', done: true },
    { key: 'proposal', label: 'Send your first proposal', why: 'Start with “Projects for you”.', href: '/projects', done: false },
    { key: 'contract', label: 'Win a contract', why: '', href: '/contracts', done: false },
    { key: 'deliver', label: 'Deliver your first milestone', why: '', href: '/contracts', done: false },
    { key: 'paid', label: 'Get paid', why: '', href: '/earnings', done: false },
  ],
};

const CATEGORY = { slug: 'website_development', name: 'Website development', description: '', template: { stages: ['Build'], acceptance: [], default_revisions: 2 } };
const brief = (title: string) => ({ title, category_slug: 'website_development', outcome: 'Customers order cakes online and pick a time.', description: '', deliverables: ['Order form'], skills: ['Next.js'], experience_level: 'any', budget_model: 'fixed', budget_min_minor: null, budget_max_minor: 4_000_000, currency: 'INR', deadline: '2030-01-31', milestones: [], acceptance_criteria: ['Works on mobile'], revision_rounds: 2, languages: ['en'], timezone: '', confidentiality: 'standard', ownership_notes: '', assumptions: [] });

async function mockApi(page: Page, opts: { submitDelay?: Promise<void> } = {}): Promise<{ sides: string[] }> {
  const seen = { sides: [] as string[] };
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/\/+$/, '');
    const json = (payload: string) => route.fulfill({ status: 200, contentType: 'application/json', body: payload });
    if (path === '/api/v1/me') return json(ok({ id: 'u1', roles: ['client', 'freelancer'] }));
    if (path === '/api/v1/me/onboarding') {
      const side = url.searchParams.get('side') ?? '';
      seen.sides.push(side);
      return json(ok(side === 'client' ? clientOnboarding : freelancerOnboarding));
    }
    if (path === '/api/v1/me/identity') return json(ok({ roles: ['client', 'freelancer'], client_side_enabled: true, organizations: [{ id: 'o1', name: 'Meera Shah', membership_role: 'owner', kind: 'individual', country: 'IN' }] }));
    if (path === '/api/v1/project-categories') return json(ok([CATEGORY]));
    if (path === '/api/v1/organizations/o1/listings') {
      return json(ok([
        { id: 'L1', status: 'draft', visibility: 'public', moderation_status: 'not_screened', current_version: 1, published_at: null, closes_at: null, brief: brief('Bakery ordering website') },
        { id: 'L2', status: 'draft', visibility: 'public', moderation_status: 'not_screened', current_version: 1, published_at: null, closes_at: null, brief: brief('Menu page refresh') },
      ]));
    }
    if (path === '/api/v1/listings/L1/transition') {
      await opts.submitDelay;
      return json(ok({ id: 'L1', status: 'published' }, 'Published'));
    }
    return json(JSON.stringify([]));
  });
  return seen;
}

test('a new client sees step-by-step setup on the overview, starting with the client profile', async ({ page }) => {
  await signIn(page, 'client');
  const seen = await mockApi(page);
  await page.goto('/workspace');
  const card = page.getByRole('region', { name: 'Get started' });
  await expect(card).toBeVisible();
  await expect(card.getByText('0 of 7 done')).toBeVisible();
  await expect(card.getByText('Missing: Industry')).toBeVisible();
  await expect(card.getByText('Missing: Billing name, Billing email')).toBeVisible();
  await expect(card.getByRole('link', { name: 'Start' })).toHaveAttribute('href', '/client/profile');
  expect(seen.sides).toContain('client');
  expect(seen.sides).not.toContain('freelancer');
});

test('a freelancer sees their own next step on the overview', async ({ page }) => {
  await signIn(page, 'freelancer');
  await mockApi(page);
  await page.goto('/workspace');
  const card = page.getByRole('region', { name: 'Get started' });
  await expect(card.getByText('2 of 6 done')).toBeVisible();
  await expect(card.getByRole('link', { name: 'Start' })).toHaveAttribute('href', '/projects');
  await expect(card.getByText('Complete your client profile')).toHaveCount(0);
});

test('posting marks required fields with ★, checks each step on Next and warns about the profile without blocking', async ({ page }) => {
  await signIn(page, 'client');
  await mockApi(page);
  await page.goto('/client/projects');
  await page.getByRole('button', { name: 'Post a new project' }).click();
  await expect(page.getByTestId('setup-warning-profile')).toContainText('Missing: Industry');
  await expect(page.getByLabel('Work category (required)')).toBeVisible();

  const next = page.getByRole('button', { name: 'Next', exact: true });
  await next.click();
  await expect(page.getByText('Step 2 of 4')).toBeVisible();
  await next.click();
  // Stays on step 2 and says what is missing under each field.
  await expect(page.getByText('Step 2 of 4')).toBeVisible();
  await expect(page.getByText('Enter a title of 5 to 160 characters.')).toBeVisible();
  await expect(page.getByText('Describe the business outcome in at least 20 characters.')).toBeVisible();
  await expect(page.getByLabel('Project title (required)')).toHaveAttribute('aria-invalid', 'true');

  await page.getByLabel('Project title (required)').fill('Bakery ordering website');
  await expect(page.getByText('Enter a title of 5 to 160 characters.')).toHaveCount(0);
  await page.getByLabel(/Business outcome/).fill('Customers order cakes online and pick a pickup time.');
  await page.getByLabel(/Deliverables/).fill('Order form');
  await page.getByLabel(/Skills/).fill('Next.js');
  await page.getByLabel(/Acceptance criteria/).fill('Works on mobile');
  await next.click();
  await expect(page.getByText('Step 3 of 4')).toBeVisible();
  // Jumping ahead with the step buttons is checked too.
  await page.getByRole('button', { name: '4. Review and publish' }).click();
  await expect(page.getByText('Step 3 of 4')).toBeVisible();
  await expect(page.getByText('Set a maximum budget (the platform never invents one).')).toBeVisible();
  await expect(page.getByText('Set a deadline.')).toBeVisible();
});

test('only the clicked button says it is working; the rest keep their look', async ({ page }) => {
  await signIn(page, 'client');
  let release: () => void = () => undefined;
  const submitDelay = new Promise<void>((resolve) => { release = resolve; });
  await mockApi(page, { submitDelay });
  await page.goto('/client/projects');
  const first = page.locator('.card.item').filter({ hasText: 'Bakery ordering website' });
  const second = page.locator('.card.item').filter({ hasText: 'Menu page refresh' });
  await first.getByRole('button', { name: 'Submit for publishing' }).click();
  await expect(first.getByRole('button', { name: 'Submitting…' })).toBeVisible();
  // Other buttons ignore clicks while it runs but are not shown as pressed or greyed out.
  const other = second.getByRole('button', { name: 'Submit for publishing' });
  await expect(other).toBeDisabled();
  await expect(other).toHaveCSS('opacity', '1');
  await expect(first.getByRole('button', { name: 'Edit' })).toHaveText('Edit');
  release();
  await expect(page.locator('p.success')).toHaveText('Published');
  await expect(first.getByRole('button', { name: 'Submitting…' })).toHaveCount(0);
});
