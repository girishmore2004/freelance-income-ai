import { test, expect, type Route } from '@playwright/test';

/** Phase 4 batch 1: staff finance page (fee schedules in basis points; no money moves). */

const ok = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });

test('finance staff save a draft fee schedule as basis points', async ({ page }) => {
  const posts: Array<Record<string, unknown>> = [];
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (status: number, body: string) => route.fulfill({ status, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(200, ok({ id: 'fin1', roles: ['finance'] }));
    if (path === '/api/v1/finance/fee-schedules' && request.method() === 'POST') {
      posts.push(JSON.parse(request.postData() as string) as Record<string, unknown>);
      return reply(201, ok({ id: 'F1', status: 'draft' }, 'Draft saved'));
    }
    if (path === '/api/v1/finance/fee-schedules') return reply(200, ok([]));
    if (path === '/api/v1/finance/trial-balance') return reply(200, ok({ mode: 'sandbox', rows: [], totals: {} }));
    return reply(200, JSON.stringify([]));
  });
  await page.goto('/finance');
  await expect(page.getByText('No fee schedule yet. Fees are founder decision D-5.')).toBeVisible();
  await page.getByLabel('Name').fill('Launch fees');
  await page.getByLabel('Client fee (%)').fill('3.5');
  await page.getByLabel('Freelancer fee (%)').fill('2.5');
  await page.getByLabel('Minimum fee (₹)').fill('50');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/Draft saved/)).toBeVisible();
  expect(posts[0]).toEqual({ name: 'Launch fees', currency: 'INR', client_fee_bps: 350, freelancer_fee_bps: 250, min_fee_minor: 5000 });
});

test('the finance page is closed to non-staff', async ({ page }) => {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
  await page.route('**/api/v1/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/\/+$/, '');
    if (path === '/api/v1/me') return route.fulfill({ status: 200, contentType: 'application/json', body: ok({ id: 'u1', roles: ['freelancer'] }) });
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Not found', data: null, error: { code: 'NOT_FOUND' } }) });
  });
  await page.goto('/finance');
  await expect(page.getByText('This page is for finance staff.')).toBeVisible();
});
