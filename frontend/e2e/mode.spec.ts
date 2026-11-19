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
  const switcher = page.getByRole('group', { name: 'Workspace' });
  await expect(switcher.getByRole('button', { name: 'Client' })).toHaveAttribute('aria-pressed', 'true');
  await expect(sidebar.getByRole('link', { name: 'Buy a service' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Find work' })).toHaveCount(0);
  await expect(sidebar.getByRole('link', { name: 'My profile and resume' })).toHaveCount(0);

  // Switching to Freelancer leaves the client page for the freelancer home.
  await switcher.getByRole('button', { name: 'Freelancer' }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(switcher.getByRole('button', { name: 'Freelancer' })).toHaveAttribute('aria-pressed', 'true');
  await expect(sidebar.getByRole('link', { name: 'Find work' }).first()).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Buy a service' })).toHaveCount(0);

  // Shared pages show only the active side.
  await page.goto('/contracts');
  await expect(page.getByText('Logo for Acme')).toBeVisible();
  await expect(page.getByText('Website for my shop')).toHaveCount(0);
  await expect(page.getByText('1 contract where you are the client')).toBeVisible();
  await switcher.getByRole('button', { name: 'Client' }).click();
  await expect(page).toHaveURL(/\/contracts$/);
  await expect(page.getByText('Website for my shop')).toBeVisible();
  await expect(page.getByText('Logo for Acme')).toHaveCount(0);
});

test('staff open the Admin workspace from the switch, and the theme toggle switches to dark mode', async ({ page }) => {
  await signIn(page);
  await page.route('**/api/v1/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'a1', roles: ['freelancer', 'admin'] }));
    return reply(JSON.stringify([]));
  });
  await page.goto('/workspace');
  await expect(page.getByRole('heading', { name: 'Freelancer dashboard' }).or(page.getByText('Freelancer dashboard'))).toBeVisible();
  const switcher = page.getByRole('group', { name: 'Workspace' });
  await switcher.getByRole('button', { name: 'Admin' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(switcher.getByRole('button', { name: 'Admin' })).toHaveAttribute('aria-pressed', 'true');
  const sidebar = page.getByRole('complementary', { name: 'Workspace navigation' });
  await expect(sidebar.getByRole('link', { name: 'Disputes' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Find work' })).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-side', 'admin');

  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

// Changed on purpose (founder decision 2026-11-19): the switch shows only the sides the account has; another side is turned on from Account.
test('an owner account with admin and client roles sees only Client and Admin, turns Freelancer on from Account, and the calendar stays on the chosen side', async ({ page }) => {
  await signIn(page);
  let roles = ['admin', 'client'];
  const activated: unknown[] = [];
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'o1', email: 'owner@example.test', roles }));
    if (path === '/api/v1/me/identity') return reply(ok({ user_id: 'o1', roles, organizations: [], client_side_enabled: true }));
    if (path === '/api/v1/me/roles' && request.method() === 'POST') {
      activated.push(JSON.parse(request.postData() as string));
      roles = ['admin', 'client', 'freelancer'];
      return reply(ok({ roles }));
    }
    if (path === '/api/v1/me/calendar') {
      return reply(ok({ from: '2026-11-18', to: '2026-12-18', today: '2026-11-18', events: [
        { type: 'milestone_due', date: '2026-11-20', title: 'Deliver logo', detail: 'Acme', href: '/contracts#K1', side: 'freelancer', overdue: false },
        { type: 'milestone_due', date: '2026-11-21', title: 'Review website', detail: 'My shop', href: '/contracts#K2', side: 'client', overdue: false },
      ] }));
    }
    return reply(JSON.stringify([]));
  });

  await page.goto('/workspace');
  const switcher = page.getByRole('group', { name: 'Workspace' });
  await expect(switcher.getByRole('button', { name: 'Client' })).toHaveAttribute('aria-pressed', 'true');
  await expect(switcher.getByRole('button', { name: 'Admin' })).toBeVisible();
  await expect(switcher.getByRole('button', { name: 'Freelancer' })).toHaveCount(0);
  // The client dashboard links only to client pages.
  await expect(page.getByRole('link', { name: 'AI coach' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Post a project' }).first()).toBeVisible();

  // Freelancer is turned on from Account → Your roles, then appears in the switch as the active side.
  await page.goto('/account');
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(switcher.getByRole('button', { name: 'Freelancer' })).toHaveAttribute('aria-pressed', 'true');
  expect(activated).toEqual([{ role: 'freelancer' }]);
  await page.goto('/workspace');
  await expect(page.getByText('Freelancer dashboard')).toBeVisible();
  await expect(switcher.getByRole('button', { name: 'Client' })).toBeVisible();

  // The calendar from the freelancer sidebar opens on the freelancer side with freelancer dates only.
  const sidebar = page.getByRole('complementary', { name: 'Workspace navigation' });
  await sidebar.getByRole('link', { name: 'Calendar' }).click();
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(switcher.getByRole('button', { name: 'Freelancer' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Deliver logo')).toBeVisible();
  await expect(page.getByText('Review website')).toHaveCount(0);
  await expect(sidebar.getByRole('link', { name: 'Find work' }).first()).toBeVisible();
});

test('a freelancer page never shows the client menu: a side that is off is offered, not mixed', async ({ page }) => {
  await signIn(page);
  await page.route('**/api/v1/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'f1', roles: ['freelancer'] }));
    return reply(JSON.stringify([]));
  });
  await page.goto('/client/projects');
  const switcher = page.getByRole('group', { name: 'Workspace' });
  await expect(switcher.getByRole('button', { name: 'Client' })).toHaveAttribute('aria-pressed', 'true');
  const sidebar = page.getByRole('complementary', { name: 'Workspace navigation' });
  await expect(sidebar.getByRole('link', { name: 'Find work' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Turn on the Client (hiring) side' })).toBeVisible();
});

test('from the Admin portal the bell and Notifications stay in Admin, and sidebar links open without a full page reload', async ({ page }) => {
  await signIn(page);
  let meCalls = 0;
  await page.route('**/api/v1/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') { meCalls += 1; return reply(ok({ id: 'a1', roles: ['freelancer', 'client', 'admin'] })); }
    if (path === '/api/v1/notifications/unread-count') return reply(ok({ unread: 3, by_side: { freelancer: 1, client: 1, both: 1 } }));
    if (path === '/api/v1/notifications') {
      return reply(ok([
        { id: 'n1', title: 'Listing waiting for review', message: 'Staff notice', kind: 'moderation', link: '', read: false, created_at: '2026-11-19T00:00:00Z', side: null },
        { id: 'n2', title: 'New proposal on Logo', message: 'Client notice', kind: 'proposal', link: '', read: false, created_at: '2026-11-19T00:00:00Z', side: 'client' },
        { id: 'n3', title: 'Invoice paid', message: 'Freelancer notice', kind: 'payment', link: '', read: false, created_at: '2026-11-19T00:00:00Z', side: 'freelancer' },
      ]));
    }
    return reply(JSON.stringify([]));
  });

  await page.goto('/admin');
  const switcher = page.getByRole('group', { name: 'Workspace' });
  const sidebar = page.getByRole('complementary', { name: 'Workspace navigation' });
  await expect(switcher.getByRole('button', { name: 'Admin' })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => { (window as unknown as { __stay: boolean }).__stay = true; });

  // The bell in the Admin portal counts staff and account notices only, and opens Notifications in Admin.
  await page.getByRole('link', { name: 'Notifications, 1 unread' }).click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(switcher.getByRole('button', { name: 'Admin' })).toHaveAttribute('aria-pressed', 'true');
  await expect(switcher.getByRole('button', { name: 'Freelancer' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('html')).toHaveAttribute('data-side', 'admin');
  await expect(sidebar.getByRole('link', { name: 'Disputes' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Find work' })).toHaveCount(0);
  await expect(page.getByText('Listing waiting for review')).toBeVisible();
  await expect(page.getByText('New proposal on Logo')).toHaveCount(0);
  await expect(page.getByText('Invoice paid')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Back to/ })).toHaveAttribute('href', '/admin');

  // Moving between pages kept the same page alive (no full reload) and asked for the account once.
  expect(await page.evaluate(() => (window as unknown as { __stay?: boolean }).__stay)).toBe(true);
  expect(meCalls).toBeLessThanOrEqual(2);

  // Choosing a side from the switch leaves Admin, and the account pages follow that side again.
  await switcher.getByRole('button', { name: 'Client' }).click();
  await expect(switcher.getByRole('button', { name: 'Client' })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/notifications');
  await expect(switcher.getByRole('button', { name: 'Client' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('New proposal on Logo')).toBeVisible();
  await expect(page.getByText('Invoice paid')).toHaveCount(0);
});

test('the Client portal shows only client items: dashboard, next actions, analytics, AI agents and account', async ({ page }) => {
  await signIn(page);
  // Start on the Client side once (later page loads keep whatever side the test switches to).
  await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('fia_mode', 'client'); } });
  const ORG = { id: 'o1', name: 'Acme Studio', kind: 'company', industry: '', website: '', country: 'IN', preferred_language: 'en', status: 'active', membership_role: 'owner', billing: { name: '', email: '', address: '', tax_id: '' } };
  await page.route('**/api/v1/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'u1', roles: ['freelancer', 'client'] }));
    if (path === '/api/v1/me/identity') return reply(ok({ user_id: 'u1', roles: ['freelancer', 'client'], organizations: [ORG], client_side_enabled: true }));
    if (path === '/api/v1/workspace/overview') {
      return reply(ok({
        as_of: '2026-11-19', metrics: { active_contracts_as_freelancer: 1, active_contracts_as_client: 1 }, goals: { monthly_income_target: 0, weekly_hours_target: 10, monthly_proposals_target: 4, monthly_outreach_target: 10, currency: 'INR' },
        alerts: [
          { id: 'a1', severity: 'high', title: 'Answer the offer: Logo for Acme', action: 'Accept or decline.', href: '/contracts#K1', side: 'freelancer' },
          { id: 'a2', severity: 'high', title: 'Review delivery: Website, milestone 1', action: 'Approve or ask for a revision.', href: '/contracts#K2', side: 'client' },
        ],
        recommendations: [
          { priority: 'medium', title: 'Behind your proposal target', reason: 'r', action: 'a', evidence: [], side: 'freelancer' },
          { priority: 'high', title: 'Unblock your freelancers', reason: 'r', action: 'a', evidence: [], side: 'client' },
        ],
        deadlines: [], pending_release: [], apply_next: { invitations: [], external: [] }, data_policy: 'Your records only.',
      }));
    }
    if (path === '/api/v1/agent/action-plan') {
      return reply(ok({ actions: [
        { priority: 1, category: 'pipeline', title: 'Answer the offer: Logo for Acme', reason: 'r', evidence: { type: 'contract', id: 'K1' }, suggested_action: 's', due_date: null, requires_human_approval: true, href: '/contracts#K1', side: 'freelancer' },
        { priority: 1, category: 'delivery', title: 'Review delivery: Website, milestone 1', reason: 'r', evidence: { type: 'contract', id: 'K2' }, suggested_action: 's', due_date: null, requires_human_approval: true, href: '/contracts#K2', side: 'client' },
      ] }));
    }
    if (path === '/api/v1/me/agent-usage') return reply(ok({ agents: {}, pending_approvals: 3 }));
    if (path === '/api/v1/me/blocks') {
      return reply(ok([
        { id: 'B1', side: 'freelancer', name: 'Spammy Client', for_account: null, reason: '', created_at: '2026-11-18T00:00:00Z' },
        { id: 'B2', side: 'client', name: 'Ravi K', for_account: 'Acme Studio', reason: '', created_at: '2026-11-18T00:00:00Z' },
      ]));
    }
    return reply(JSON.stringify([]));
  });
  const switcher = page.getByRole('group', { name: 'Workspace' });

  await page.goto('/workspace');
  await expect(page.getByText('Client dashboard')).toBeVisible();
  await expect(page.getByText('Review delivery: Website, milestone 1')).toBeVisible();
  await expect(page.getByText('Answer the offer: Logo for Acme')).toHaveCount(0);
  await expect(page.getByText('Unblock your freelancers')).toBeVisible();
  await expect(page.getByText('Behind your proposal target')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Business goals' })).toHaveCount(0);

  await page.goto('/agent');
  await expect(page.getByText('Review delivery: Website, milestone 1')).toBeVisible();
  await expect(page.getByText('Answer the offer: Logo for Acme')).toHaveCount(0);

  // Client analytics → no freelancer planning tools to fall into.
  await page.goto('/analytics');
  await expect(switcher.getByRole('button', { name: 'Client' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Planning tools' })).toHaveCount(0);

  await page.goto('/ai-agents');
  await expect(page.getByText('My agent runs')).toBeVisible();
  await expect(page.getByText('Drafts waiting for my approval')).toHaveCount(0);

  // Account: the client account and the client side's blocks only.
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Client accounts' })).toBeVisible();
  const blocked = page.getByRole('region', { name: 'Blocked' });
  await expect(blocked.getByText('Ravi K', { exact: true })).toBeVisible();
  await expect(blocked.getByText('Spammy Client')).toHaveCount(0);

  // The same pages on the Freelancer side show the freelancer items instead.
  await switcher.getByRole('button', { name: 'Freelancer' }).click();
  await expect(switcher.getByRole('button', { name: 'Freelancer' })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/analytics');
  await expect(page.getByRole('link', { name: 'Planning tools' })).toBeVisible();
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Client accounts' })).toHaveCount(0);
  await expect(page.getByText('Your client accounts and team are on the Client side')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Blocked' }).getByText('Spammy Client', { exact: true })).toBeVisible();
});

test('the switch shows only the sides chosen at sign-up: Find work → Freelancer, Hire → Client, both → both', async ({ page }) => {
  await signIn(page);
  let roles: string[] = ['freelancer'];
  await page.route('**/api/v1/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'u1', roles }));
    return reply(JSON.stringify([]));
  });
  const switcher = page.getByRole('group', { name: 'Workspace' });

  await page.goto('/workspace');
  await expect(switcher.getByRole('button', { name: 'Freelancer' })).toHaveAttribute('aria-pressed', 'true');
  await expect(switcher.getByRole('button', { name: 'Client' })).toHaveCount(0);
  await expect(page.getByText('Freelancer dashboard')).toBeVisible();

  roles = ['client'];
  await page.evaluate(() => { localStorage.removeItem('fia_roles_hint'); localStorage.removeItem('fia_mode'); });
  await page.goto('/workspace');
  await expect(switcher.getByRole('button', { name: 'Client' })).toHaveAttribute('aria-pressed', 'true');
  await expect(switcher.getByRole('button', { name: 'Freelancer' })).toHaveCount(0);
  await expect(page.getByText('Client dashboard')).toBeVisible();
  const sidebar = page.getByRole('complementary', { name: 'Workspace navigation' });
  await expect(sidebar.getByRole('link', { name: 'Find work' })).toHaveCount(0);

  roles = ['client', 'freelancer'];
  await page.evaluate(() => { localStorage.removeItem('fia_roles_hint'); });
  await page.goto('/workspace');
  await expect(switcher.getByRole('button', { name: 'Client' })).toBeVisible();
  await expect(switcher.getByRole('button', { name: 'Freelancer' })).toBeVisible();
});
