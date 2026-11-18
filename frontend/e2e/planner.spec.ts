import { test, expect, type Page, type Route } from '@playwright/test';

/** U7: saved projects, calendar, contact form and staff support queue. The Edge API is mocked. */

const ok = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });

async function signIn(page: Page): Promise<void> {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
}

const PROJECT = {
  id: 'L1', published_at: '2026-11-17T00:00:00Z', closes_at: '2026-11-30T00:00:00Z', client_name: 'Acme Studio', title: 'Bakery ordering website',
  category_slug: 'website_development', outcome: 'Customers order cakes online.', description: '', deliverables: ['Order form'], skills: ['Next.js'],
  experience_level: 'any', budget_model: 'fixed', budget_min_minor: 2_000_000, budget_max_minor: 4_000_000, currency: 'INR', deadline: '2027-01-15',
  milestones: [], acceptance_criteria: [], revision_rounds: 2, confidential: false,
};

test('a freelancer saves a project and finds it under Saved', async ({ page }) => {
  await signIn(page);
  let saved: unknown[] = [];
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'f1', roles: ['freelancer'] }));
    if (path === '/api/v1/marketplace/listings') return reply(ok({ items: [PROJECT], next_before: null }));
    if (path === '/api/v1/me/saved-listings') return reply(ok(saved));
    if (path === '/api/v1/marketplace/listings/L1/save' && request.method() === 'POST') {
      saved = [{ ...PROJECT, status: 'published', open: true, note: '', saved_at: '2026-11-18T00:00:00Z' }];
      return reply(ok({ listing_id: 'L1', saved: true }, 'Saved'));
    }
    if (path === '/api/v1/marketplace/listings/L1/save' && request.method() === 'DELETE') {
      saved = [];
      return reply(ok({ listing_id: 'L1', saved: false }));
    }
    return reply(JSON.stringify([]));
  });
  await page.goto('/projects');
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await save.click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Saved (1)' }).click();
  const list = page.getByRole('region', { name: 'Saved projects' });
  await expect(list.getByText('Taking proposals')).toBeVisible();
  await expect(list.getByText(/closes 2026-11-30/)).toBeVisible();
  await list.getByRole('button', { name: 'Remove' }).click();
  await expect(list.getByText(/Nothing saved yet/)).toBeVisible();
});

test('the calendar lists overdue items first and filters by side', async ({ page }) => {
  await signIn(page);
  await page.route('**/api/v1/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'f1', roles: ['freelancer', 'client'] }));
    if (path === '/api/v1/me/calendar') {
      return reply(ok({ from: '2026-11-18', to: '2026-12-29', today: '2026-11-18', events: [
        { date: '2026-11-10', type: 'milestone_due', title: 'Cafe site: Design', detail: 'Deliver this milestone', href: '/contracts', overdue: true, side: 'freelancer' },
        { date: '2026-11-18', type: 'saved_closes', title: 'Bakery ordering website', detail: 'Saved project stops taking proposals', href: '/projects?view=saved', overdue: false, side: 'freelancer' },
        { date: '2026-12-10', type: 'listing_deadline', title: 'Menu app', detail: "Your project's deadline", href: '/client/projects', overdue: false, side: 'client' },
      ] }));
    }
    return reply(JSON.stringify([]));
  });
  await page.goto('/calendar');
  await expect(page.getByRole('region', { name: 'Overdue' }).getByRole('link', { name: 'Cafe site: Design' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Today' }).getByText('Saved project closes')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Menu app' })).toBeVisible();
  await page.getByRole('group', { name: 'Show dates for' }).getByRole('button', { name: 'My work' }).click();
  await expect(page.getByRole('link', { name: 'Menu app' })).toHaveCount(0);
});

test('a visitor sends a message from the contact page', async ({ page }) => {
  const posts: Record<string, unknown>[] = [];
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    if (path === '/api/v1/me') return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'Authentication required' }) });
    if (path === '/api/v1/support/tickets') {
      const body = JSON.parse(request.postData() as string) as Record<string, unknown>;
      posts.push(body);
      if (!body.email) return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Check the highlighted fields.', data: null, error: { code: 'INVALID_TICKET', details: [{ email: 'Enter the email address we should reply to.' }] } }) });
      return route.fulfill({ status: 201, contentType: 'application/json', body: ok({ received: true }, 'Thank you.') });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
  await page.goto('/contact');
  await page.getByLabel('What is it about?').selectOption('payments');
  await page.getByLabel('Subject').fill('Refund timing');
  await page.getByLabel(/Message/).fill('How long does a refund take after a contract is cancelled?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Enter the email address we should reply to.')).toBeVisible();
  await page.getByLabel(/Your email/).fill('visitor@example.com');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Thank you. Staff will reply as soon as they can.')).toBeVisible();
  expect(posts[1]).toMatchObject({ topic: 'payments', subject: 'Refund timing', email: 'visitor@example.com', website: '' });
});

test('staff answer a support ticket from the admin page', async ({ page }) => {
  await signIn(page);
  let open = true;
  const resolutions: unknown[] = [];
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'm1', roles: ['moderator'] }));
    if (path === '/api/v1/admin/overview') return reply(ok({ is_admin: false, counts: { users: 2 }, flags: [] }));
    if (path === '/api/v1/admin/moderation/listings' || path === '/api/v1/admin/reports') return reply(ok([]));
    if (path === '/api/v1/admin/support/tickets') {
      const items = url.searchParams.get('status') === 'open' && open
        ? [{ id: 'T1', topic: 'account', subject: 'Lost my phone', body: 'I cannot complete MFA.', status: 'open', resolution_note: '', created_at: '2026-11-18T05:00:00Z', resolved_at: null, email: 'f2@x.test', name: '', signed_in: true }]
        : [];
      return reply(ok(items));
    }
    if (path === '/api/v1/admin/support/tickets/T1/resolve') {
      resolutions.push(JSON.parse(request.postData() as string));
      open = false;
      return reply(ok({ id: 'T1', status: 'resolved' }, 'Resolved. The person sees your answer in their notifications.'));
    }
    return reply(JSON.stringify([]));
  });
  await page.goto('/admin');
  const support = page.getByRole('region', { name: 'Support tickets' });
  await expect(support.getByText('Lost my phone')).toBeVisible();
  const resolve = support.getByRole('button', { name: 'Resolve' });
  await expect(resolve).toBeDisabled();
  await support.getByLabel(/Answer \(sent to their notifications\)/).fill('Use a recovery code from Security.');
  await resolve.click();
  await expect(page.getByText('Resolved. The person sees your answer in their notifications.')).toBeVisible();
  await expect(support.getByText('No open tickets.')).toBeVisible();
  expect(resolutions).toEqual([{ note: 'Use a recovery code from Security.' }]);
});
