import { test, expect, type Route } from '@playwright/test';

/** U1: public homepage for visitors and the shared workspace shell for signed-in pages. */

const ok = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });

test('visitors see the marketplace homepage with real categories, live agents and sign-in', async ({ page }) => {
  await page.route('**/api/v1/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/\/+$/, '');
    if (path === '/api/v1/me') return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'Authentication required' }) });
    if (path === '/api/v1/public/home') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: ok({ client_marketplace_open: true,
        categories: [{ slug: 'website_development', name: 'Website development', open: true }, { slug: 'ui_ux_design', name: 'UI/UX design', open: false }],
        agents: [{ code: 'C1', name: 'Project Brief Builder', side: 'client', purpose: 'Turns notes into a brief.', status: 'live' }],
        counts: { published_projects: 12, visible_freelancers: 0, completed_contracts: 0 } }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Find freelance work');
  await expect(page.getByText('Open for projects')).toBeVisible();
  await expect(page.getByText('Opening soon')).toBeVisible();
  await expect(page.getByText('Project Brief Builder')).toBeVisible();
  // Only counts above zero are shown.
  await expect(page.getByLabel('Marketplace numbers')).toHaveText('12 open projects');
  await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
  await page.getByLabel('Search projects and skills').fill('react');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\?q=react$/);
});

test('signed-in pages get the workspace shell with role-aware navigation, AI usage and notifications', async ({ page }) => {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
  await page.route('**/api/v1/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'u1', email: 'sam@example.test', roles: ['client', 'freelancer', 'admin'] }));
    if (path === '/api/v1/notifications/unread-count') return reply(ok({ unread: 3 }));
    if (path === '/api/v1/me/plan') return reply(ok({ usage: { today: 4, this_month: 9 }, limits: { daily: 20, monthly: 300 } }));
    if (path === '/api/v1/agent/action-plan') return reply(ok({ as_of_date: '2026-11-18', actions: [], total_actionable_records: 0, returned_actions: 0, policy: 'Recommendations only.' }));
    return reply(JSON.stringify([]));
  });
  await page.goto('/agent');
  const nav = page.getByRole('complementary', { name: 'Workspace navigation' });
  await expect(nav.getByRole('link', { name: 'Next actions' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Marketplace projects' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Admin' })).toBeVisible();
  await expect(page.getByText('AI today 4/20')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Notifications, 3 unread' })).toBeVisible();
  await nav.getByRole('button', { name: 'Client' }).click();
  await expect(nav.getByRole('link', { name: 'Projects and proposals' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Marketplace projects' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Profile menu' }).click();
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
  await page.getByLabel('AI command').fill('earnings');
  await page.getByLabel('AI command').press('Enter');
  await expect(page).toHaveURL(/\/earnings$/);
});
