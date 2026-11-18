import { test, expect, type Route } from '@playwright/test';

/** Money loop in test mode: fund a milestone with the sandbox, see the invoice; freelancer withdraws. */

const ok = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });

async function signIn(page: import('@playwright/test').Page): Promise<void> {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
}

const TERMS = { version: 1, title: 'Cafe website', scope: '', deliverables: [], milestones: [{ title: 'Design', amount_minor: 1_000_000, due_date: null }], total_minor: 1_000_000, currency: 'INR', revision_rounds: 2, acceptance_criteria: [], ownership_terms: '', content_hash: 'h', proposed_by: 'client', created_at: '2026-11-17T00:00:00Z', client_accepted_at: '2026-11-17T00:00:00Z', freelancer_accepted_at: '2026-11-17T00:00:00Z' };

test('client funds a milestone with a test payment and opens the test invoice', async ({ page }) => {
  let status: string | null = null;
  const posts: string[] = [];
  await signIn(page);
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (request.method() === 'POST') posts.push(path);
    const payment = status ? { id: 'I1', status, amount_minor: 1_000_000, client_fee_minor: 35_000, freelancer_fee_minor: 25_000, total_minor: 1_035_000, currency: 'INR', mode: 'sandbox' } : null;
    if (path === '/api/v1/me') return reply(ok({ id: 'c1', roles: ['client'] }));
    if (path === '/api/v1/contracts') return reply(ok([{ id: 'K1', status: 'active', party: 'client', client_name: 'Acme', current_version: 1, activated_at: null, terms: TERMS }]));
    if (path === '/api/v1/contracts/K1') return reply(ok({ id: 'K1', status: 'active', party: 'client', can_manage: true, client_name: 'Acme', project_title: 'Cafe website', current_version: 1, agreed_version: 1, pending_change: false, agreed_terms: null, activated_at: null, terms: TERMS, versions: [TERMS], allowed_actions: ['propose_changes'], funding: { available: false, message: '' } }));
    if (path === '/api/v1/contracts/K1/payments') {
      return reply(ok({ enabled: true, mode: 'sandbox', notice: 'Test payments: no real money moves.', fees_configured: true, require_funding: false, can_fund: true,
        milestones: [{ index: 0, title: 'Design', amount_minor: 1_000_000, payment }],
        invoices: status === 'funded' ? [{ id: 'INV1', number: 'FIA-TEST-20261117-ABCD1234', milestone_title: 'Design', total_minor: 1_035_000, status: 'paid', mode: 'sandbox' }] : [],
        cancellation: null }));
    }
    if (path === '/api/v1/contracts/K1/milestones/0/fund') { status = 'created'; return reply(ok({ payment, checkout: { provider: 'sandbox' } }, 'Test checkout created. Complete it to fund the milestone (no real money).')); }
    if (path === '/api/v1/payments/sandbox/I1/complete') { status = 'funded'; return reply(ok({ status }, 'Test payment completed: milestone funded (no real money)')); }
    if (path === '/api/v1/billing/invoices/INV1') {
      return reply(ok({ number: 'FIA-TEST-20261117-ABCD1234', milestone_title: 'Design', amount_minor: 1_000_000, client_fee_minor: 35_000, total_minor: 1_035_000, currency: 'INR', issued_to: 'Acme', created_at: '2026-11-17T00:00:00Z', status: 'paid', notice: 'TEST DOCUMENT — not a tax invoice. No money was paid.' }));
    }
    return reply(JSON.stringify([]));
  });
  await page.goto('/contracts');
  await page.getByRole('button', { name: 'Open' }).click();
  await page.getByRole('tab', { name: 'Payments' }).click();
  await expect(page.getByText('TEST MODE — no real money moves')).toBeVisible();
  await page.getByRole('button', { name: 'Fund milestone' }).click();
  await page.getByRole('button', { name: 'Complete test payment' }).click();
  await expect(page.getByText('Test payment completed: milestone funded (no real money)')).toBeVisible();
  await expect(page.getByText(/You pay ₹10,350 incl. fee ₹350/)).toBeVisible();
  await page.getByRole('button', { name: 'FIA-TEST-20261117-ABCD1234' }).click();
  await expect(page.getByText('TEST DOCUMENT — not a tax invoice. No money was paid.')).toBeVisible();
  expect(posts).toEqual(['/api/v1/contracts/K1/milestones/0/fund', '/api/v1/payments/sandbox/I1/complete']);
});

test('freelancer withdraws released earnings in test mode', async ({ page }) => {
  let available = 975_000;
  const payouts: Array<Record<string, unknown>> = [];
  await signIn(page);
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'f1', roles: ['freelancer'] }));
    if (path === '/api/v1/me/earnings') return reply(ok({ payments_enabled: true, mode: 'sandbox', note: 'Test mode: no real money moves.', available_minor: available, in_escrow_minor: 0, releases: [{ id: 'I1', contract_id: 'K1', milestone_index: 0, status: 'released', net_minor: 975_000, released_at: '2026-11-17T00:00:00Z', funded_at: null }], payouts: [] }));
    if (path === '/api/v1/me/payouts') {
      payouts.push(JSON.parse(request.postData() as string) as Record<string, unknown>);
      available = 0;
      return reply(ok({ id: 'PO1', status: 'paid' }, 'Test payout completed (no real money)'));
    }
    return reply(JSON.stringify([]));
  });
  await page.goto('/earnings');
  await expect(page.getByText('₹9,750', { exact: true })).toBeVisible();
  await page.getByLabel('Withdraw (₹)').fill('9750');
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await expect(page.getByText('Test payout completed (no real money)')).toBeVisible();
  expect(payouts[0]).toMatchObject({ amount_minor: 975_000 });
  expect(typeof payouts[0].idempotency_key).toBe('string');
});
