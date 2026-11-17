import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * Account & roles page (Phase 1). The Edge API is mocked; the page must render
 * only what the API returns. Runs in both auth modes: bearer (token seeded in
 * localStorage) and cookie (session detected through GET /api/v1/me).
 */

type Org = { id: string; name: string; kind: string; industry: string; website: string; country: string; preferred_language: string; status: string; membership_role: string; billing?: Record<string, string> };

interface MockState {
  roles: string[];
  organizations: Org[];
  clientSideEnabled: boolean;
  requests: { method: string; path: string; body: unknown }[];
}

const envelope = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });

async function mockApi(page: Page, state: MockState): Promise<void> {
  if (process.env.E2E_AUTH_MODE !== 'cookie') {
    await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
  }
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const body = request.postData() ? JSON.parse(request.postData() as string) : null;
    state.requests.push({ method: request.method(), path, body });

    if (path === '/api/v1/me') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: envelope({ id: 'u1', email: 'e2e@example.test', roles: state.roles }) });
      return;
    }
    if (path === '/api/v1/me/identity') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: envelope({ roles: state.roles, organizations: state.organizations, client_side_enabled: state.clientSideEnabled }) });
      return;
    }
    if (path === '/api/v1/me/roles' && request.method() === 'POST') {
      if (!state.clientSideEnabled) {
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Hiring features are not open yet.', data: null, error: { code: 'FEATURE_DISABLED', details: [] } }) });
        return;
      }
      state.roles = Array.from(new Set([...state.roles, (body as { role: string }).role])).sort();
      await route.fulfill({ status: 200, contentType: 'application/json', body: envelope({ roles: state.roles }, 'The client role is active.') });
      return;
    }
    if (path === '/api/v1/organizations' && request.method() === 'POST') {
      const input = body as { name: string; kind: string; website: string };
      if (input.website && !input.website.startsWith('https://')) {
        await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Check the highlighted fields.', data: null, error: { code: 'INVALID_ORGANIZATION', details: [{ website: 'Use a full https:// address.' }] } }) });
        return;
      }
      const org: Org = { id: 'o1', name: input.name, kind: input.kind, industry: '', website: input.website, country: 'IN', preferred_language: 'en', status: 'active', membership_role: 'owner', billing: { name: '', email: '', address: '', tax_id: '' } };
      state.organizations = [org];
      await route.fulfill({ status: 201, contentType: 'application/json', body: envelope(org, 'Client account created') });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
}

test('shows roles from the API and keeps hiring closed while the flag is off', async ({ page }) => {
  const state: MockState = { roles: ['freelancer'], organizations: [], clientSideEnabled: false, requests: [] };
  await mockApi(page, state);
  await page.goto('/account');

  await expect(page.getByRole('heading', { name: 'Your roles' })).toBeVisible();
  await expect(page.getByText('Hiring opens when the client marketplace launches.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn on' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Client accounts' })).toHaveCount(0);
});

test('turns on hiring, shows a field error from the API, then creates a client account', async ({ page }) => {
  const state: MockState = { roles: ['freelancer'], organizations: [], clientSideEnabled: true, requests: [] };
  await mockApi(page, state);
  await page.goto('/account');

  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByText('The client role is active.')).toBeVisible();
  await expect(page.getByText('You have no client accounts yet. Create one below.')).toBeVisible();

  await page.getByLabel('Account type').selectOption('company');
  await page.getByLabel(/Company name/).fill('Acme Studio');
  await page.getByLabel('Website (https://…)').fill('http://acme.example');
  await page.getByRole('button', { name: 'Create client account' }).click();
  await expect(page.getByText('Use a full https:// address.')).toBeVisible();
  await expect(page.getByLabel('Website (https://…)')).toHaveAttribute('aria-invalid', 'true');

  await page.getByLabel('Website (https://…)').fill('https://acme.example');
  await page.getByRole('button', { name: 'Create client account' }).click();
  await expect(page.getByText('Client account created.')).toBeVisible();
  await expect(page.getByText('Acme Studio')).toBeVisible();

  const create = state.requests.filter((r) => r.method === 'POST' && r.path === '/api/v1/organizations');
  expect(create).toHaveLength(2);
  expect(create[1].body).toMatchObject({ name: 'Acme Studio', kind: 'company', website: 'https://acme.example' });
});
