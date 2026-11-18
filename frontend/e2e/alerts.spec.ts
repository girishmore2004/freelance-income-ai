import { test, expect, type Route } from '@playwright/test';

/** U12: profile checklist, saved searches with alerts, opening a project from an alert, invitation already answered. */

const ok = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });

async function signIn(page: import('@playwright/test').Page): Promise<void> {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
}

const PROJECT = { id: 'L9', published_at: '2026-11-18T00:00:00Z', closes_at: null, client_name: 'Acme', client_verified: true, title: 'Bakery landing page', category_slug: 'website_development', outcome: 'More online orders', description: 'One page', deliverables: [], skills: ['SEO'], experience_level: 'any', budget_model: 'fixed', budget_min_minor: null, budget_max_minor: 200000, currency: 'INR', deadline: null, milestones: [], acceptance_criteria: [], revision_rounds: 2, languages: ['en'], timezone: '', confidential: false, visibility: 'public' };

test('a freelancer saves a search, sees what is new and opens the project from it', async ({ page }) => {
  await signIn(page);
  const searches: Array<Record<string, unknown>> = [];
  let posted: Record<string, unknown> | null = null;
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string, status = 200) => route.fulfill({ status, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'f1', roles: ['freelancer'] }));
    if (path === '/api/v1/me/profile-checklist') {
      return reply(ok({ applies: true, score: 60, items: [
        { key: 'name', label: 'Add your name', done: true, why: '', href: '/profile' },
        { key: 'portfolio', label: 'Add a link to your work', done: false, why: 'Proposals can only cite work from your profile.', href: '/profile' },
        { key: 'visible', label: 'Show your profile to clients', done: false, why: 'Clients can only invite freelancers who opted in.', href: '/projects' },
      ] }));
    }
    if (path === '/api/v1/marketplace/listings') return reply(ok({ items: [], next_before: null }));
    if (path === '/api/v1/marketplace/listings/L9') return reply(ok(PROJECT));
    if (path === '/api/v1/me/saved-searches' && request.method() === 'POST') {
      posted = JSON.parse(request.postData() as string);
      searches.push({ id: 'S1', name: posted!.name, query: posted!.query, category_slug: '', min_budget_minor: posted!.min_budget_minor, skills: [], alerts: true, new_count: 1, new_projects: [{ id: 'L9', title: 'Bakery landing page' }] });
      return reply(ok({ id: 'S1' }, 'Search saved'), 201);
    }
    if (path === '/api/v1/me/saved-searches') return reply(ok({ available: true, items: searches, max: 10 }));
    if (path === '/api/v1/saved-searches/S1/seen') { searches[0] = { ...searches[0], new_count: 0, new_projects: [] }; return reply(ok({ id: 'S1' })); }
    return reply(JSON.stringify([]));
  });
  await page.goto('/projects');
  const checklist = page.getByRole('region', { name: 'Profile checklist' });
  await expect(checklist).toContainText('60% complete');
  await expect(checklist.getByRole('link', { name: 'Add a link to your work' })).toHaveAttribute('href', '/profile');

  await page.locator('#q').fill('bakery');
  await page.locator('#q').press('Enter');
  await page.getByRole('button', { name: 'Save this search' }).click();
  await page.getByLabel('Minimum budget (₹, optional)').fill('1500');
  await page.getByRole('button', { name: 'Save and alert me' }).click();
  expect(posted).toMatchObject({ name: 'bakery', query: 'bakery', min_budget_minor: 150000, alerts: true });
  const list = page.getByRole('list', { name: 'Your saved searches' });
  await expect(list).toContainText('1 new');
  await list.getByRole('button', { name: 'Bakery landing page' }).click();
  await expect(page.getByText('Reviewed client').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hide details' })).toBeVisible();
});

test('an alert link opens the project directly', async ({ page }) => {
  await signIn(page);
  await page.route('**/api/v1/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'f1', roles: ['freelancer'] }));
    if (path === '/api/v1/marketplace/listings') return reply(ok({ items: [], next_before: null }));
    if (path === '/api/v1/marketplace/listings/L9') return reply(ok(PROJECT));
    if (path === '/api/v1/me/invitations') {
      return reply(ok([{ id: 'I1', listing_id: 'L9', status: 'accepted', message: '', created_at: '2026-11-18T00:00:00Z', listing_status: 'published', my_proposal_id: 'P1', project: PROJECT }]));
    }
    return reply(JSON.stringify([]));
  });
  await page.goto('/projects?project=L9');
  await expect(page.getByRole('button', { name: 'Hide details' })).toBeVisible();
  await expect(page.getByText('You have sent a proposal for this project.')).toBeVisible();
});
