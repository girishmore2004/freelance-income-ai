import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * Phase 2: client project posting and the freelancer project list.
 * The Edge API is mocked; runs in bearer and cookie modes.
 */

type Captured = { method: string; path: string; body: Record<string, unknown> | null };

const ok = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });

async function signIn(page: Page): Promise<void> {
  if (process.env.E2E_AUTH_MODE !== 'cookie') {
    await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
  }
}

const CATEGORY = { slug: 'website_development', name: 'Website development', description: '', template: { stages: ['Discovery', 'Build'], acceptance: ['Agreed pages exist'], default_revisions: 2 } };

async function mockClientApi(page: Page, captured: Captured[], clientSide = true): Promise<void> {
  const listings: Record<string, unknown>[] = [];
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const body = request.postData() ? (JSON.parse(request.postData() as string) as Record<string, unknown>) : null;
    captured.push({ method: request.method(), path, body });
    const json = (status: number, payload: string) => route.fulfill({ status, contentType: 'application/json', body: payload });

    if (path === '/api/v1/me') return json(200, ok({ id: 'u1', email: 'client@example.test', roles: ['client'] }));
    if (path === '/api/v1/me/identity') {
      return json(200, ok({ roles: ['client', 'freelancer'], client_side_enabled: clientSide, organizations: [{ id: 'o1', name: 'Acme Studio', membership_role: 'owner', kind: 'company' }] }));
    }
    if (path === '/api/v1/project-categories') return json(200, ok([CATEGORY]));
    if (path === '/api/v1/organizations/o1/brief-assistant') {
      return json(200, ok({
        source: 'model',
        draft: { title: 'Candle shop website', outcome: 'Customers can buy candles online.', deliverables: ['Shop pages', 'Checkout'], skills: ['Next.js'], milestones: [{ title: 'Design', description: '' }], acceptance_criteria: ['Orders can be placed'], assumptions: ['Client supplies photos'], questions: ['Which payment provider do you use?'], conflicts: [], revision_rounds: 2 },
      }, 'Draft brief ready for your review'));
    }
    if (path === '/api/v1/organizations/o1/listings' && request.method() === 'GET') return json(200, ok(listings));
    if (path === '/api/v1/organizations/o1/listings' && request.method() === 'POST') {
      const listing = { id: 'L1', status: 'draft', visibility: 'public', moderation_status: 'not_screened', current_version: 1, published_at: null, brief: { ...body, milestones: body?.milestones ?? [], languages: ['en'], timezone: '', ownership_notes: '', assumptions: [] } };
      listings.splice(0, listings.length, listing);
      return json(201, ok(listing, 'Draft saved'));
    }
    if (path === '/api/v1/listings/L1/transition') {
      (listings[0] as { status: string }).status = 'published';
      return json(200, ok(listings[0], 'Published'));
    }
    return json(200, JSON.stringify([]));
  });
}

test('client drafts a brief with AI, sets the budget in rupees and publishes', async ({ page }) => {
  const captured: Captured[] = [];
  await signIn(page);
  await mockClientApi(page, captured);
  await page.goto('/client/projects');

  await page.getByRole('button', { name: 'Post a new project' }).click();
  await page.getByLabel(/Describe the project/).fill('We sell handmade candles and need a small online shop with checkout.');
  await page.getByRole('button', { name: 'Draft the brief with AI' }).click();

  await expect(page.getByLabel('Project title (required)')).toHaveValue('Candle shop website');
  await expect(page.getByText('Which payment provider do you use?')).toBeVisible();

  await page.getByLabel('Minimum budget (₹)').fill('25000');
  await page.getByLabel('Maximum budget (₹)').fill('50000');
  await page.getByLabel('Deadline').fill('2030-01-31');
  await page.getByRole('button', { name: 'Save and submit' }).click();

  await expect(page.getByText('Published', { exact: true })).toBeVisible();
  const create = captured.find((c) => c.method === 'POST' && c.path === '/api/v1/organizations/o1/listings');
  expect(create?.body).toMatchObject({ title: 'Candle shop website', budget_min_minor: 2_500_000, budget_max_minor: 5_000_000, currency: 'INR', deadline: '2030-01-31' });
  expect(captured.some((c) => c.path === '/api/v1/listings/L1/transition' && (c.body as { action?: string })?.action === 'submit')).toBe(true);
});

test('client page explains when the client marketplace is closed', async ({ page }) => {
  await signIn(page);
  await mockClientApi(page, [], false);
  await page.goto('/client/projects');
  await expect(page.getByText('Posting projects opens when the client marketplace launches.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Post a new project' })).toHaveCount(0);
});

test('freelancers see published projects and confidential clients stay anonymous', async ({ page }) => {
  await signIn(page);
  await page.route('**/api/v1/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/\/+$/, '');
    if (path === '/api/v1/me') return route.fulfill({ status: 200, contentType: 'application/json', body: ok({ id: 'u2', roles: ['freelancer'] }) });
    if (path === '/api/v1/project-categories') return route.fulfill({ status: 200, contentType: 'application/json', body: ok([CATEGORY]) });
    if (path === '/api/v1/marketplace/listings') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: ok({
          next_before: null,
          items: [{ id: 'L1', published_at: '2026-11-17T00:00:00Z', client_name: 'Confidential client', title: 'Clinic booking site', category_slug: 'website_development', outcome: 'Patients book visits online.', description: '', deliverables: ['Booking page'], skills: ['React'], experience_level: 'any', budget_model: 'fixed', budget_min_minor: null, budget_max_minor: 4_000_000, currency: 'INR', deadline: '2030-02-01', milestones: ['Build'], acceptance_criteria: ['Bookings are saved'], revision_rounds: 2, confidential: true }],
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
  await page.goto('/projects');
  await expect(page.getByText('Clinic booking site')).toBeVisible();
  await expect(page.getByText(/Confidential client/)).toBeVisible();
  await page.getByRole('button', { name: 'Show details' }).click();
  await expect(page.getByText('Bookings are saved')).toBeVisible();
});
