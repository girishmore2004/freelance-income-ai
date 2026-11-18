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
  await expect(nav.getByRole('link', { name: 'Find work', exact: true })).toBeVisible();
  // Staff get a third workspace on the top-bar switch instead of admin links in the sidebar.
  const switcher = page.getByRole('group', { name: 'Workspace' });
  await expect(switcher.getByRole('button', { name: 'Admin' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Admin overview' })).toHaveCount(0);
  await expect(page.getByText('AI today 4/20')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Notifications, 3 unread' })).toBeVisible();
  await switcher.getByRole('button', { name: 'Client' }).click();
  await expect(nav.getByRole('link', { name: 'Projects and proposals' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Find work', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Profile menu' }).click();
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
  await page.getByLabel('AI command').fill('earnings');
  await page.getByLabel('AI command').press('Enter');
  await expect(page).toHaveURL(/\/earnings$/);
});

test('Find work shows native and external opportunities in one place, clearly labelled', async ({ page }) => {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
  const drafted: unknown[] = [];
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'f1', email: 'f1@example.test', roles: ['freelancer'] }));
    if (path === '/api/v1/marketplace/listings') {
      return reply(ok({ next_before: null, items: [{ id: 'L1', published_at: '2026-11-17T00:00:00Z', client_name: 'Acme', title: 'Cafe website', category_slug: 'website_development', outcome: 'Menu online.', description: '', deliverables: [], skills: ['React'], experience_level: 'any', budget_model: 'fixed', budget_min_minor: 1_000_000, budget_max_minor: 2_000_000, currency: 'INR', deadline: null, milestones: [], acceptance_criteria: [], revision_rounds: 2, confidential: false }] }));
    }
    if (path === '/api/v1/opportunities') {
      return reply(ok([{ id: 'O1', title: 'React dashboard contract', description: 'Build a reporting dashboard in React for a logistics team.', client_name: 'Remote Co', source: 'remotive', source_url: 'https://remotive.example/jobs/1', status: 'new', match_score: 82, currency: 'USD', created_at: new Date().toISOString(), score_breakdown: { notes: { matched_skills: ['React'], missing_skills: ['D3'] } } }]));
    }
    if (path === '/api/v1/proposals/generate') { drafted.push(JSON.parse(request.postData() as string)); return reply(ok({ id: 'P1' })); }
    return reply(JSON.stringify([]));
  });
  await page.goto('/projects');
  await expect(page.getByText('Native project', { exact: true })).toBeVisible();
  await expect(page.getByText('External · Remotive')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open original post ↗' })).toHaveAttribute('href', 'https://remotive.example/jobs/1');
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'External opportunities' }).click();
  await expect(page.getByText('Cafe website')).toHaveCount(0);
  await page.getByRole('button', { name: 'Draft proposal' }).click();
  await expect(page.getByText(/Draft created/)).toBeVisible();
  expect(drafted).toEqual([{ opportunity_id: 'O1', currency: 'USD' }]);
});

test('visitors browse freelancers and open a public profile with real reviews', async ({ page }) => {
  await page.route('**/api/v1/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/\/+$/, '');
    const reply = (body: string, status = 200) => route.fulfill({ status, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(JSON.stringify({ detail: 'Authentication required' }), 401);
    const card = { user_id: 'f2', display_name: 'Ravi', headline: 'SEO specialist', skills: ['SEO'], services: [], hourly_rate: 900, currency: 'INR', weekly_hours: 20, timezone: 'Asia/Kolkata', newcomer: false, rating: { average: 5, count: 1 }, completed_contracts: 3 };
    if (path === '/api/v1/public/freelancers') return reply(ok({ open: true, more: false, items: [card] }));
    if (path === '/api/v1/public/freelancers/f2') return reply(ok({ ...card, reviews: [{ rating: 5, comment: 'Clear and on time', created_at: '2026-11-01T00:00:00Z' }] }));
    return reply(JSON.stringify([]));
  });
  await page.goto('/freelancers');
  await expect(page.getByText('3 completed here')).toBeVisible();
  await page.getByRole('button', { name: 'View profile' }).click();
  await expect(page.getByRole('heading', { name: 'Ravi' })).toBeVisible();
  await expect(page.getByText('Clear and on time')).toBeVisible();
  await expect(page).toHaveURL(/\/freelancers\?id=f2$/);
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();
});
