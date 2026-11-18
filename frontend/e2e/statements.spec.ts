import { test, expect, type Route } from '@playwright/test';

/** U13: take-home shown while pricing a proposal; monthly statement with test mode labelled and CSV download. */

const ok = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });

async function signIn(page: import('@playwright/test').Page): Promise<void> {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
}

const PROJECT = { id: 'L1', published_at: '2026-11-18T00:00:00Z', closes_at: null, client_name: 'Acme', title: 'Cafe website', category_slug: 'website_development', outcome: 'Online orders', description: 'x', deliverables: [], skills: [], experience_level: 'any', budget_model: 'fixed', budget_min_minor: null, budget_max_minor: null, currency: 'INR', deadline: null, milestones: [], acceptance_criteria: [], revision_rounds: 2, languages: ['en'], timezone: '', confidential: false, visibility: 'public' };

test('a freelancer sees the take-home amount while pricing a proposal', async ({ page }) => {
  await signIn(page);
  const quoted: string[] = [];
  await page.route('**/api/v1/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/\/+$/, '');
    const reply = (body: string, status = 200) => route.fulfill({ status, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'f1', roles: ['freelancer'] }));
    if (path === '/api/v1/marketplace/listings') return reply(ok({ items: [PROJECT], next_before: null }));
    if (path === '/api/v1/finance/fee-quote') {
      const amount = Number(url.searchParams.get('amount_minor'));
      quoted.push(String(amount));
      return reply(ok({ client_fee_minor: amount * 0.035, freelancer_fee_minor: amount * 0.025, client_pays_minor: amount * 1.035, freelancer_receives_minor: amount * 0.975, platform_fee_minor: amount * 0.06, currency: 'INR' }));
    }
    return reply(JSON.stringify([]));
  });
  await page.goto('/projects');
  await page.getByRole('button', { name: 'Show details' }).click();
  await page.getByRole('button', { name: 'Send a proposal' }).click();
  await page.getByLabel(/Your price/).fill('10000');
  await expect(page.getByTestId('fee-estimate')).toContainText('You would receive');
  await expect(page.getByTestId('fee-estimate')).toContainText('9,750');
  expect(quoted).toEqual(['1000000']); // debounced: one quote for the final amount
});

test('a freelancer reads a monthly statement and downloads it as CSV', async ({ page }) => {
  await signIn(page);
  let csvRequested = false;
  await page.route('**/api/v1/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/\/+$/, '');
    const reply = (body: string, status = 200) => route.fulfill({ status, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'f1', roles: ['freelancer'] }));
    if (path === '/api/v1/me/earnings') return reply(ok({ payments_enabled: true, mode: 'sandbox', note: 'Test mode', available_minor: 0, in_escrow_minor: 0, releases: [], payouts: [] }));
    if (path === '/api/v1/me/identity') return reply(ok({ roles: ['freelancer'], organizations: [] }));
    if (path === '/api/v1/me/statements' && url.searchParams.get('format') === 'csv') {
      csvRequested = true;
      return route.fulfill({ status: 200, contentType: 'text/csv', body: '"date","type"\r\n' });
    }
    if (path === '/api/v1/me/statements') {
      return reply(ok({ month: url.searchParams.get('month'), side: 'freelancer', note: 'Built from payment records. Test-mode amounts are not real money. This is not a tax invoice.',
        totals: [{ mode: 'sandbox', currency: 'INR', gross_minor: 1_000_000, fee_minor: 25_000, net_minor: 975_000, payouts_minor: 975_000, refunds_minor: 0 }],
        lines: [{ date: '2026-11-17', kind: 'release', mode: 'sandbox', contract: 'Cafe website', milestone: 0, gross_minor: 1_000_000, fee_minor: 25_000, net_minor: 975_000, currency: 'INR' }] }));
    }
    return reply(JSON.stringify([]));
  });
  await page.goto('/earnings');
  const statement = page.getByRole('region', { name: 'Monthly statement' });
  await expect(statement).toContainText('TEST MODE');
  await expect(statement).toContainText('Released to you (test)');
  await expect(statement).toContainText('not a tax invoice');
  await statement.getByRole('button', { name: 'Download CSV' }).click();
  await expect.poll(() => csvRequested).toBe(true);
});
