import { test, expect, type Route } from '@playwright/test';

/** One account, two sides: the Freelancer / Client switch shows one side at a time and never mixes them. */

const ok = (data: unknown) => JSON.stringify({ success: true, message: 'ok', data, error: null });

async function signIn(page: import('@playwright/test').Page): Promise<void> {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
}

const TERMS = { version: 1, title: '', scope: '', deliverables: [], milestones: [{ title: 'All', amount_minor: 100000, due_date: null }], total_minor: 100000, currency: 'INR', revision_rounds: 1, acceptance_criteria: [], ownership_terms: '', content_hash: 'h', proposed_by: 'client', created_at: '2026-11-18T00:00:00Z', client_accepted_at: null, freelancer_accepted_at: null };

test('switching sides changes the sidebar, leaves the other side’s page and filters shared lists', async ({ page }) => {
  await signIn(page);
  await page.route('**/api/v1/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'u1', roles: ['freelancer', 'client'] }));
    if (path === '/api/v1/contracts') {
      return reply(ok([
        { id: 'K1', status: 'active', party: 'freelancer', client_name: 'Acme', current_version: 1, activated_at: null, terms: { ...TERMS, title: 'Logo for Acme' } },
        { id: 'K2', status: 'active', party: 'client', client_name: 'My shop', current_version: 1, activated_at: null, terms: { ...TERMS, title: 'Website for my shop' } },
      ]));
    }
    return reply(JSON.stringify([]));
  });

  // A client page puts the account in Client mode.
  await page.goto('/client/projects');
  const sidebar = page.getByRole('complementary', { name: 'Workspace navigation' });
  await expect(sidebar.getByRole('button', { name: 'Client' })).toHaveAttribute('aria-pressed', 'true');
  await expect(sidebar.getByRole('link', { name: 'Buy a service' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Find work' })).toHaveCount(0);
  await expect(sidebar.getByRole('link', { name: 'My profile and resume' })).toHaveCount(0);

  // Switching to Freelancer leaves the client page for the freelancer home.
  await sidebar.getByRole('button', { name: 'Freelancer' }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(sidebar.getByRole('button', { name: 'Freelancer' })).toHaveAttribute('aria-pressed', 'true');
  await expect(sidebar.getByRole('link', { name: 'Find work' }).first()).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Buy a service' })).toHaveCount(0);

  // Shared pages show only the active side.
  await page.goto('/contracts');
  await expect(page.getByText('Logo for Acme')).toBeVisible();
  await expect(page.getByText('Website for my shop')).toHaveCount(0);
  await expect(page.getByText('1 contract where you are the client')).toBeVisible();
  await sidebar.getByRole('button', { name: 'Client' }).click();
  await expect(page).toHaveURL(/\/contracts$/);
  await expect(page.getByText('Website for my shop')).toBeVisible();
  await expect(page.getByText('Logo for Acme')).toHaveCount(0);
});
