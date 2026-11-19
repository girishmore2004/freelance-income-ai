import { test, expect, type Route } from '@playwright/test';

/** Client profile (every client has one, no setup step) and the Security page on the real API reply shape. */

const ok = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });

async function signIn(page: import('@playwright/test').Page): Promise<void> {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
}

const ORG = { id: 'o1', name: 'Priya Sharma', kind: 'individual', industry: '', website: '', country: 'IN', preferred_language: 'en', status: 'active', membership_role: 'owner', billing: { name: '', email: '', address: '', tax_id: '' } };

test('a client edits their client profile from the Client sidebar and Projects opens without a setup step', async ({ page }) => {
  await signIn(page);
  const patches: unknown[] = [];
  let org = { ...ORG };
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string, status = 200) => route.fulfill({ status, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'c1', roles: ['client'] }));
    if (path === '/api/v1/me/identity') return reply(ok({ user_id: 'c1', roles: ['client'], organizations: [org], client_side_enabled: true }));
    if (path === '/api/v1/organizations/o1' && request.method() === 'PATCH') {
      const body = JSON.parse(request.postData() as string);
      patches.push(body);
      if (!String(body.website).startsWith('https://') && body.website) return reply(JSON.stringify({ success: false, message: 'Check the highlighted fields.', data: null, error: { code: 'INVALID_ORGANIZATION', details: [{ website: 'Use a full https:// address.' }] } }), 422);
      org = { ...org, name: body.name, kind: body.kind, website: body.website, billing: { name: body.billing_name, email: body.billing_email, address: body.billing_address, tax_id: body.tax_id } };
      return reply(ok(org, 'Organisation updated'));
    }
    return reply(JSON.stringify([]));
  });

  await page.goto('/client/projects');
  await expect(page.getByText(/client account on the Account page first/)).toHaveCount(0);

  const sidebar = page.getByRole('complementary', { name: 'Workspace navigation' });
  await sidebar.getByRole('link', { name: 'Client profile' }).click();
  await expect(page).toHaveURL(/\/client\/profile$/);
  await expect(page.getByRole('heading', { name: 'Client profile' })).toBeVisible();
  await expect(page.getByLabel(/Your name/)).toHaveValue('Priya Sharma');

  await page.getByLabel('Account type').selectOption('company');
  await page.getByLabel(/Company name/).fill('Sharma Bakery');
  await page.getByLabel('Website (https://…)').fill('bakery.example');
  await page.getByRole('button', { name: 'Save client profile' }).click();
  await expect(page.getByText('Use a full https:// address.')).toBeVisible();
  await page.getByLabel('Website (https://…)').fill('https://bakery.example');
  await page.getByLabel('Billing email').fill('accounts@bakery.example');
  await page.getByRole('button', { name: 'Save client profile' }).click();
  await expect(page.getByText('Client profile saved.')).toBeVisible();
  await expect(page.getByLabel(/Company name/)).toHaveValue('Sharma Bakery');
  expect(patches[1]).toMatchObject({ name: 'Sharma Bakery', kind: 'company', website: 'https://bakery.example', billing_email: 'accounts@bakery.example' });
});

test('the Security page opens with the sessions and two-factor status from the API', async ({ page }) => {
  await signIn(page);
  await page.route('**/api/v1/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'f1', roles: ['freelancer'] }));
    if (path === '/api/v1/auth/sessions') {
      return reply(ok([
        { id: 'S1', created_at: '2026-11-19T10:00:00Z', expires_at: '2026-12-19T10:00:00Z', revoked: false, current: true },
        { id: 'S2', created_at: '2026-11-10T10:00:00Z', expires_at: '2026-12-10T10:00:00Z', revoked: true, current: false },
      ], 'Sessions'));
    }
    if (path === '/api/v1/auth/mfa/status') return reply(ok({ enabled: false, recovery_codes_remaining: 0 }, 'MFA status'));
    return reply(JSON.stringify([]));
  });
  await page.goto('/security');
  await expect(page.getByRole('heading', { name: 'Sign-in sessions' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Two-factor authentication' })).toBeVisible();
  await expect(page.getByText('Active session')).toBeVisible();
  await expect(page.getByText('Revoked', { exact: true })).toBeVisible();
  await expect(page.getByText("This page couldn't load")).toHaveCount(0);
});
