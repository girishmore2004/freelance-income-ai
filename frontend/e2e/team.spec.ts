import { test, expect, type Route } from '@playwright/test';

/** Team invitations: an owner creates a join link; the invited person joins from /join. */

const ok = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });
const TOKEN = 'k'.repeat(43);

async function signIn(page: import('@playwright/test').Page): Promise<void> {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
}

const ORG = { id: 'o1', name: 'Acme Studio', kind: 'company', industry: '', website: '', country: 'IN', preferred_language: 'en', status: 'active', membership_role: 'owner', billing: { name: '', email: '', address: '', tax_id: '' } };

test('an owner invites a teammate and gets a one-time join link', async ({ page }) => {
  const invites: unknown[] = [];
  let pending: unknown[] = [];
  await signIn(page);
  // Client accounts and teams live on the Client side of Account (one portal at a time, 2026-11-19).
  await page.addInitScript(() => localStorage.setItem('fia_mode', 'client'));
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string, status = 200) => route.fulfill({ status, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'u1', email: 'owner@example.test', roles: ['client', 'freelancer'] }));
    if (path === '/api/v1/me/identity') return reply(ok({ user_id: 'u1', roles: ['client', 'freelancer'], organizations: [ORG], client_side_enabled: true }));
    if (path === '/api/v1/organizations/o1/members') return reply(ok([{ user_id: 'u1', email: 'owner@example.test', role: 'owner', joined_at: '2026-11-01T00:00:00Z' }]));
    if (path === '/api/v1/organizations/o1/invitations' && request.method() === 'GET') return reply(ok(pending));
    if (path === '/api/v1/organizations/o1/invitations') {
      invites.push(JSON.parse(request.postData() as string));
      pending = [{ id: 'I1', email: 'sam@example.test', role: 'admin', status: 'pending', expires_at: '2026-11-25T00:00:00Z' }];
      return reply(ok({ invitation: pending[0], join_path: `/join?token=${TOKEN}` }, 'Invitation created'), 201);
    }
    return reply(JSON.stringify([]));
  });
  await page.goto('/account');
  await page.getByText('Team (1)').click();
  await page.getByLabel('Invite by email').fill('sam@example.test');
  await page.getByLabel('Role for the invited person').selectOption('admin');
  await page.getByRole('button', { name: 'Create invitation' }).click();
  await expect(page.getByLabel(/Join link/)).toHaveValue(new RegExp(`/join\\?token=${TOKEN}$`));
  await expect(page.getByRole('list', { name: 'Pending invitations' })).toContainText('sam@example.test');
  expect(invites).toEqual([{ email: 'sam@example.test', role: 'admin' }]);
});

test('the invited person joins from the link', async ({ page }) => {
  const accepted: unknown[] = [];
  await signIn(page);
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string, status = 200) => route.fulfill({ status, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'u2', email: 'sam@example.test', roles: ['freelancer'] }));
    if (path === '/api/v1/organization-invitations/preview') return reply(ok({ organization_name: 'Acme Studio', role: 'admin', email_matches: true, expires_at: '2026-11-25T00:00:00Z' }));
    if (path === '/api/v1/organization-invitations/accept') {
      accepted.push(JSON.parse(request.postData() as string));
      return reply(ok({ organization_id: 'o1', role: 'admin' }, 'You joined the organisation'));
    }
    return reply(JSON.stringify([]));
  });
  await page.goto(`/join?token=${TOKEN}`);
  await expect(page.getByText(/You are invited to join/)).toContainText('Acme Studio');
  await page.getByRole('button', { name: 'Join Acme Studio' }).click();
  await expect(page.getByText('You joined Acme Studio.')).toBeVisible();
  expect(accepted).toEqual([{ token: TOKEN }]);
});
