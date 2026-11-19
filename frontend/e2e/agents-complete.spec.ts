import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * U24: the completed agents on their pages, per side.
 * Freelancer: F3 profile review, F7 capacity, F9 inbox triage, P9 settings.
 * Client: C7 spend forecast. Admin: P1 risk signals, P7 balance, P5 terms and takedowns, P8 evaluations.
 * The Edge API is mocked; runs in bearer and cookie modes.
 */

type Captured = { method: string; path: string; body: Record<string, unknown> | null };
const ok = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });

async function signIn(page: Page): Promise<void> {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
}

async function mock(page: Page, captured: Captured[], handler: (path: string, method: string, body: Record<string, unknown> | null) => string | undefined): Promise<void> {
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const body = request.postData() ? (JSON.parse(request.postData() as string) as Record<string, unknown>) : null;
    captured.push({ method: request.method(), path, body });
    return route.fulfill({ status: 200, contentType: 'application/json', body: handler(path, request.method(), body) ?? JSON.stringify([]) });
  });
}

test('a freelancer reviews the profile, sees capacity, gets a reply starter and mutes a notification group', async ({ page }) => {
  const captured: Captured[] = [];
  await signIn(page);
  let proposalsOn = true;
  await mock(page, captured, (path, method, body) => {
    if (path === '/api/v1/me') return ok({ id: 'f1', roles: ['freelancer'] });
    if (path === '/api/v1/profile') return ok({ full_name: 'Asha Rao', headline: 'World-class expert web developer', bio: '', skills: ['Next.js'], services: [], portfolio_links: [], hourly_rate: 1500, weekly_hours: 20, timezone: 'Asia/Kolkata' });
    if (path === '/api/v1/me/portfolio-projects') return ok({ available: true, items: [{ title: 'Bakery ordering site', description: 'Online ordering.', skills: ['Next.js'], link: '', year: '2026' }] });
    if (path === '/api/v1/me/suggested-projects') return ok({ native: [], external: [], note: 'No matches yet.' });
    if (path === '/api/v1/me/profile-review') {
      return ok({ score: 56, note: 'Advice from rules only. Nothing on your profile was changed.', skills_without_evidence: ['Kubernetes'],
        items: [{ severity: 'warn', field: 'headline', message: '"expert" is a strong claim with no completed contracts or reviews yet.' }],
        projects: [{ index: 0, title: 'Bakery ordering site', issues: ['Add a link to the live work or a case study.'] }] });
    }
    if (path === '/api/v1/me/capacity') {
      return ok({ available_hours: 20, booked_hours: 25, free_hours: -5, status: 'over', hourly: [], overdue: [], note: 'Booked hours count the weekly limits of your active hourly contracts.',
        weeks: [{ week_start: '2026-11-16', deadlines: 1, items: [] }, { week_start: '2026-11-23', deadlines: 0, items: [] }, { week_start: '2026-11-30', deadlines: 0, items: [] }, { week_start: '2026-12-07', deadlines: 0, items: [] }],
        warnings: ['Hourly contracts allow up to 25 hours a week, more than the 20 you are available.'] });
    }
    if (path === '/api/v1/inbox') {
      return ok([{ kind: 'proposal', id: 'P1', title: 'Bakery ordering website', last_message: 'Please add a pickup time picker.', last_at: '2026-11-19T10:00:00Z', from_other_side: true, side: 'freelancer', href: '/inbox?proposal=P1',
        triage: { kind: 'change_request', label: 'Asks for a change', reply: 'Understood. To confirm the change: ' } }]);
    }
    if (path === '/api/v1/listing-proposals/P1/discussion') return ok({ party: 'freelancer', can_message: true, can_schedule: true, proposal_status: 'submitted', messages: [], interviews: [], note: '' });
    if (path === '/api/v1/me/notification-settings') {
      if (method === 'PUT') proposalsOn = (body?.groups as Record<string, boolean>).proposals;
      return ok({ available: true, email: { available: false, note: 'Email notifications start once the email sender is set up (decision D-15).' }, groups: [
        { key: 'proposals', label: 'Proposals, invitations and offers', mutable: true, in_app: proposalsOn },
        { key: 'account', label: 'Account, safety and disputes (always on)', mutable: false, in_app: true },
      ] });
    }
    return undefined;
  });

  await page.goto('/profile');
  const review = page.getByRole('region', { name: 'Profile review' });
  await review.getByRole('button', { name: 'Review my profile' }).click();
  await expect(review.getByText('Profile strength: 56 / 100')).toBeVisible();
  await expect(review.getByText(/strong claim/)).toBeVisible();
  await expect(review.getByText(/Add a link to the live work/)).toBeVisible();

  await page.goto('/workspace');
  const capacity = page.getByRole('region', { name: 'My capacity' });
  await expect(capacity.getByText('Over-booked')).toBeVisible();
  await expect(capacity.getByText(/25 of 20 hours a week booked/)).toBeVisible();

  await page.goto('/inbox');
  const thread = page.getByRole('list', { name: 'Conversations' }).getByRole('listitem').first();
  await expect(thread.getByText('Asks for a change')).toBeVisible();
  await thread.getByRole('button', { name: 'Open conversation' }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Understood. To confirm the change: ');

  await page.goto('/notifications');
  const settings = page.getByRole('region', { name: 'Notification settings' });
  await expect(settings.getByText('Always on', { exact: true })).toBeVisible();
  await settings.getByRole('checkbox', { name: 'Proposals, invitations and offers' }).click();
  await expect(settings.getByRole('checkbox', { name: 'Proposals, invitations and offers' })).not.toBeChecked();
  expect(captured.find((c) => c.method === 'PUT' && c.path === '/api/v1/me/notification-settings')?.body).toEqual({ groups: { proposals: false } });
});

test('a client sees the spend still to come on active contracts', async ({ page }) => {
  const captured: Captured[] = [];
  await signIn(page);
  await page.addInitScript(() => localStorage.setItem('fia_mode', 'client'));
  await mock(page, captured, (path) => {
    if (path === '/api/v1/me') return ok({ id: 'c1', roles: ['client'] });
    if (path === '/api/v1/me/identity') return ok({ roles: ['client'], client_side_enabled: true, organizations: [{ id: 'o1', name: 'Acme Bakery', membership_role: 'owner', kind: 'company' }] });
    if (path === '/api/v1/analytics/client/forecast') {
      const zero = { amount_minor: 0, fee_minor: 0, milestones: 0 };
      return ok({ organization_id: 'o1', fee_known: true, note: 'Amounts are the agreed milestone prices plus the client fee.',
        months: [{ month: '2026-11', amount_minor: 1_000_000, fee_minor: 50_000, milestones: 1 }, { month: '2026-12', amount_minor: 2_000_000, fee_minor: 100_000, milestones: 1 }],
        overdue: zero, undated: zero, later: zero, held_minor: 500_000, remaining_fixed_minor: 3_000_000, remaining_fixed_fee_minor: 150_000,
        hourly_weekly_max_minor: 600_000, hourly_weekly_max_fee_minor: 30_000, hourly: [{ contract_id: 'h', title: 'Website support', hourly_rate_minor: 120_000, weekly_limit_hours: 5 }], milestones: [] });
    }
    return undefined;
  });
  await page.goto('/analytics');
  const forecast = page.getByRole('region', { name: 'Spend still to come' });
  await expect(forecast.getByRole('cell', { name: 'Nov 2026' })).toBeVisible();
  await expect(forecast.getByRole('cell', { name: '₹10,500' })).toBeVisible();
  await expect(forecast.getByText('₹31,500')).toBeVisible();
  await expect(forecast.getByText(/Website support: ₹1,200 an hour, up to 5 hours a week/)).toBeVisible();
});

test('an admin reviews risk signals and balance, records source terms, takes down a listing and sees evaluations', async ({ page }) => {
  const captured: Captured[] = [];
  await signIn(page);
  await mock(page, captured, (path, method) => {
    if (path === '/api/v1/me') return ok({ id: 'a1', roles: ['freelancer', 'admin'] });
    if (path === '/api/v1/admin/overview') return ok({ is_admin: true, counts: { users: 3, listings_in_review: 0, reports_open: 0, oldest_review_seconds: null }, flags: [] });
    if (path === '/api/v1/admin/risk-signals') {
      return ok({ available: true, note: 'Patterns to review, not verdicts.', findings: [{ kind: 'repeated_off_platform', severity: 'medium', summary: 'Tried 4 times in 30 days to share contact details (3) or move payment off the platform (1).', user_ids: ['c9'], organization_id: null, evidence: ['last attempt 2026-11-19'], people: [{ id: 'c9', name: 'Ravi' }] }] });
    }
    if (path === '/api/v1/admin/balance-alerts') {
      return ok({ visible_freelancers: 4, note: 'Alerts are refreshed on every visit.', alerts: [{ kind: 'waiting_projects', severity: 'medium', category: 'website_development', message: '2 projects in Website development have no proposal after 3 days.' }],
        categories: [{ slug: 'website_development', name: 'Website development', open_projects: 3, waiting_projects: 2, proposals_30d: 5, freelancers_90d: 2, services_live: 1 }] });
    }
    if (path === '/api/v1/admin/sources') {
      return ok({ available: true, can_manage: true, other_sources: [], items: [{ code: 'remotive', label: 'Remotive', kind: 'job_board', access: 'api', enabled: true, health: 'healthy', runs_7d: 1, failures_7d: 0, fetched_7d: 5, stored_7d: 2, last_success_at: null, last_error: null, freshness: { open: 0, under_3_days: 0, days_3_to_14: 0, over_14_days: 0, unknown: 0 }, terms: { terms_url: '', permitted_fields: '', reviewed_at: null, review_due: true } }] });
    }
    if (path === '/api/v1/admin/sources/remotive/terms') return ok({ code: 'remotive' }, 'Source terms saved');
    if (path === '/api/v1/admin/source-takedowns') return method === 'POST' ? ok({ id: 'T1', removed: 1 }, 'Taken down.') : ok([]);
    if (path === '/api/v1/admin/agents/health') {
      return ok({ ai_provider: { configured: true, model: 'm', calls_7d: 0, live_check: null }, passed: 12, total: 12, note: '', evaluation: { cases: 54, passed: 54, agents: 21 },
        items: [{ code: 'F9', name: 'Inbox Agent', status: 'live', enabled: true, runs_7d: 0, failed_7d: 0, last_run_at: null, self_test: null, evaluation: { cases: 5, passed: 5, failed: [] }, verdict: 'working' }] });
    }
    return undefined;
  });
  await page.goto('/admin');
  const risk = page.getByRole('region', { name: 'Risk signals (P1)' });
  await expect(risk.getByText('Repeated off-platform attempts')).toBeVisible();
  await expect(risk.getByText(/Tried 4 times/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Marketplace balance (P7)' }).getByText(/no proposal after 3 days/)).toBeVisible();

  const compliance = page.getByRole('region', { name: 'Source terms and takedowns (P5)' });
  await expect(compliance.getByText(/Terms review due for: Remotive/)).toBeVisible();
  await compliance.getByLabel('Source', { exact: true }).first().selectOption('remotive');
  await compliance.getByLabel('Terms page').fill('https://remotive.com/terms');
  await compliance.getByLabel('Fields we may show').fill('title, company, link');
  await compliance.getByRole('button', { name: 'Save terms and mark reviewed' }).click();
  await expect(compliance.getByText('Terms recorded and marked reviewed.')).toBeVisible();
  const takedown = compliance.getByRole('form', { name: 'Take down a listing' });
  await takedown.getByLabel('Source').selectOption('remotive');
  await takedown.getByLabel('Listing link').fill('https://remotive.com/job/1');
  await takedown.getByLabel('Who asked and why').fill('The employer asked by email to remove the listing.');
  await takedown.getByRole('button', { name: 'Take down' }).click();
  await expect(compliance.getByText(/Listing taken down/)).toBeVisible();
  expect(captured.find((c) => c.method === 'POST' && c.path === '/api/v1/admin/sources/remotive/terms')?.body).toEqual({ terms_url: 'https://remotive.com/terms', permitted_fields: 'title, company, link', reviewed: true });
  expect(captured.find((c) => c.method === 'POST' && c.path === '/api/v1/admin/source-takedowns')?.body).toEqual({ source_code: 'remotive', source_url: 'https://remotive.com/job/1', reason: 'The employer asked by email to remove the listing.' });

  await page.goto('/ai-agents?view=admin');
  const health = page.getByRole('region', { name: 'Agent health' });
  await expect(health).toContainText('Evaluation cases passed: 54/54');
  await expect(health.getByRole('cell', { name: '5/5' })).toBeVisible();
});
