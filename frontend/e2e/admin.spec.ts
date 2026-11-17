import { test, expect, type Route } from '@playwright/test';

/** Phase 7: reports from users; staff moderation queue, reports and flags (payments locked). */

const ok = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });

async function signIn(page: import('@playwright/test').Page): Promise<void> {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
}

test('a freelancer reports a project to staff', async ({ page }) => {
  const reports: unknown[] = [];
  await signIn(page);
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string, status = 200) => route.fulfill({ status, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'f1', roles: ['freelancer'] }));
    if (path === '/api/v1/marketplace/listings') {
      return reply(ok({ next_before: null, items: [{ id: 'L1', published_at: '2026-11-17T00:00:00Z', client_name: 'Acme', title: 'Suspicious job', category_slug: 'website_development', outcome: 'Pay first.', description: '', deliverables: [], skills: [], experience_level: 'any', budget_model: 'fixed', budget_min_minor: null, budget_max_minor: null, currency: 'INR', deadline: null, milestones: [], acceptance_criteria: [], revision_rounds: 2, confidential: false }] }));
    }
    if (path === '/api/v1/reports' && request.method() === 'POST') {
      reports.push(JSON.parse(request.postData() as string));
      return reply(ok({ id: 'R1', status: 'open' }, 'Thank you. Staff will review your report.'), 201);
    }
    return reply(JSON.stringify([]));
  });
  await page.goto('/projects');
  await page.getByRole('button', { name: 'Show details' }).click();
  await page.getByRole('button', { name: 'Report' }).click();
  await page.getByLabel('Reason').selectOption('off_platform');
  await page.getByLabel(/Details/).fill('Asked me to pay on WhatsApp');
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByText('Thank you. Staff will review your report.')).toBeVisible();
  expect(reports).toEqual([{ target_type: 'listing', target_id: 'L1', reason: 'off_platform', details: 'Asked me to pay on WhatsApp' }]);
});

test('staff approve a held listing and see payments locked', async ({ page }) => {
  const decisions: unknown[] = [];
  let heldCount = 1;
  await signIn(page);
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'a1', roles: ['admin'] }));
    if (path === '/api/v1/admin/overview') {
      return reply(ok({ is_admin: true, counts: { users: 12, listings_in_review: heldCount, reports_open: 0, oldest_review_seconds: 7200 }, flags: [
        { key: 'marketplace.client_side', enabled: false, description: 'Client side', locked: false },
        { key: 'payments.live', enabled: false, description: 'Real money movement', locked: true },
      ] }));
    }
    if (path === '/api/v1/admin/moderation/listings') {
      return reply(ok(heldCount ? [{ id: 'L9', organization_name: 'Acme', findings: ['upfront_fee'], waiting_since: '2026-11-17T08:00:00Z', brief: { title: 'Data entry job', outcome: 'Pay a joining fee.', description: '', budget_min_minor: null, budget_max_minor: null, currency: 'INR', budget_model: 'fixed' } }] : []));
    }
    if (path === '/api/v1/admin/reports') return reply(ok([]));
    if (path === '/api/v1/admin/moderation/listings/L9') {
      decisions.push(JSON.parse(request.postData() as string));
      heldCount = 0;
      return reply(ok({ id: 'L9', decision: 'approve' }, 'Listing approved and published'));
    }
    return reply(JSON.stringify([]));
  });
  await page.goto('/admin');
  await expect(page.getByText('Upfront fee')).toBeVisible();
  await expect(page.getByText('locked (needs D-1/D-2)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn on' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Approve and publish' }).click();
  await expect(page.getByText('Listing approved and published')).toBeVisible();
  await expect(page.getByText('No listings waiting for review.')).toBeVisible();
  expect(decisions).toEqual([{ decision: 'approve', note: '' }]);
});
