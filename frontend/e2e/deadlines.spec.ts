import { test, expect, type Route } from '@playwright/test';

/**
 * U29 deadlines (founder decisions 2026-11-20): service deliveries complete automatically
 * (the client can extend), late orders, the dispute reply window for staff, and the name
 * asked at sign-up. The Edge API is mocked; runs in bearer and cookie modes.
 */

const ok = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });

async function signIn(page: import('@playwright/test').Page): Promise<void> {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
}

const TERMS = {
  version: 1, title: 'Landing page (Basic)', scope: '', deliverables: ['One page'], milestones: [{ title: 'Landing page', amount_minor: 800_000, due_date: '2026-11-25' }],
  total_minor: 800_000, currency: 'INR', revision_rounds: 1, acceptance_criteria: ['Works on mobile'], ownership_terms: '', content_hash: 'h', proposed_by: 'client',
  created_at: '2026-11-17T00:00:00Z', client_accepted_at: '2026-11-17T00:00:00Z', freelancer_accepted_at: '2026-11-17T00:00:00Z',
};

test('a client sees when a service delivery completes automatically, extends the review, and sees a late order', async ({ page }) => {
  await signIn(page);
  await page.addInitScript(() => localStorage.setItem('fia_mode', 'client'));
  let extended = 0;
  const posts: string[] = [];
  const workspace = () => ({
    contract_id: 'K1', status: 'active', party: 'client', can_manage: true, revision_rounds: 1, currency: 'INR', service_order: true, late_cancel_allowed: true,
    milestones: [
      { index: 0, title: 'Landing page', amount_minor: 800_000, due_date: '2026-11-25', state: 'submitted', revisions_used: 0, late: false,
        auto_complete_at: extended ? '2026-12-01T10:00:00Z' : '2026-11-26T10:00:00Z', review_extensions_left: 2 - extended,
        submissions: [{ id: 's1', status: 'submitted', note: 'Page is live on staging', links: ['https://staging.example.com/'], submitted_at: '2026-11-23T10:00:00Z', reviewed_at: null, review_note: '' }] },
      { index: 1, title: 'Extra page', amount_minor: 200_000, due_date: '2026-11-15', state: 'pending', revisions_used: 0, late: true, auto_complete_at: null, review_extensions_left: 0, submissions: [] },
    ],
    approved_minor: 0, total_minor: 1_000_000, messages: [], activity: [], funding_note: 'Approving a funded milestone releases its payment to the freelancer.',
  });
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (request.method() === 'POST') posts.push(path);
    if (path === '/api/v1/me') return reply(ok({ id: 'c1', roles: ['client'] }));
    if (path === '/api/v1/contracts') return reply(ok([{ id: 'K1', status: 'active', party: 'client', client_name: 'Acme', current_version: 1, activated_at: '2026-11-17T01:00:00Z', terms: TERMS }]));
    if (path === '/api/v1/contracts/K1') return reply(ok({ id: 'K1', status: 'active', party: 'client', client_name: 'Acme', project_title: 'Landing page', current_version: 1, activated_at: '2026-11-17T01:00:00Z', terms: TERMS, versions: [TERMS], allowed_actions: [], funding: { available: false, message: '' } }));
    if (path === '/api/v1/contracts/K1/workspace') return reply(ok(workspace(), 'Workspace'));
    if (path === '/api/v1/contracts/K1/milestones/0/extend-review') {
      extended += 1;
      return reply(ok({ milestone: 0, auto_complete_at: '2026-12-01T10:00:00Z', review_extensions_left: 1 }, 'Review extended by 5 days. It completes automatically on 2026-12-01 if you do nothing.'));
    }
    return reply(JSON.stringify([]));
  });

  await page.goto('/contracts');
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByText(/If you do nothing, this delivery is approved automatically on/)).toBeVisible();
  await expect(page.getByText('Late', { exact: true })).toBeVisible();
  await expect(page.getByText(/This order is late by more than a day/)).toBeVisible();
  await page.getByRole('button', { name: 'Review delivery' }).click();
  await page.getByRole('button', { name: 'Extend review by 5 days' }).click();
  await expect(page.getByText(/Review extended by 5 days/)).toBeVisible();
  expect(posts).toContain('/api/v1/contracts/K1/milestones/0/extend-review');
});

test('staff cannot decide a dispute before the other side answers or 7 days pass', async ({ page }) => {
  await signIn(page);
  let decided = false;
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'a1', roles: ['admin'] }));
    if (path === '/api/v1/admin/overview') return reply(ok({ is_admin: true, counts: { users: 3 }, flags: [] }));
    if (path === '/api/v1/admin/disputes') {
      return reply(ok([{ id: 'D1', contract_id: 'K1', opened_by: 'client', reason: 'non_delivery', description: 'The page was never delivered and the freelancer stopped replying.', desired_outcome: 'Refund', status: 'open', resolution: null, created_at: '2026-11-19T00:00:00Z', contract_title: 'Landing page', freelancer_name: 'Ravi', organization_name: 'Acme', funded_unreleased_minor: 840_000 }]));
    }
    if (path === '/api/v1/admin/disputes/D1') {
      return reply(ok({ can_move_money: true, dispute: { statements: [], respond_by: '2026-11-26T00:00:00Z', replied: false, ready_for_decision: false }, evidence: {
        contract: { status: 'active' }, agreed_terms: TERMS, submissions: [], messages: [], events: [],
        payments: [{ id: 'I1', milestone_index: 0, amount_minor: 800_000, currency: 'INR', status: 'funded', mode: 'sandbox' }], previous_disputes: [],
        summary: { milestones: 1, milestones_approved: 0, funded_unreleased_minor: 840_000, funded_unreleased_count: 1, submissions: 0, messages: 0 },
      } }));
    }
    if (path === '/api/v1/admin/disputes/D1/resolve') { decided = true; return reply(ok({ id: 'D1' }, 'Decision recorded')); }
    return reply(JSON.stringify([]));
  });
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Open evidence pack' }).click();
  await expect(page.getByText(/Waiting for the other side's answer until/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'No money moves' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Refund funded to client' })).toBeDisabled();
  expect(decided).toBe(false);
});

test('creating an account asks for the person\'s name and sends it', async ({ page }) => {
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    if (path === '/api/v1/me') return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Authentication required', data: null, error: { code: 'AUTHENTICATION_REQUIRED', details: [] } }) });
    if (path === '/api/v1/auth/register') {
      bodies.push(JSON.parse(request.postData() as string));
      return route.fulfill({ status: 200, contentType: 'application/json', body: ok({ status: 'verification_required', message: 'Check your email to verify your account.' }, 'Request received') });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
  await page.goto('/');
  await page.locator('input[autocomplete="email"]').fill('meera@example.test');
  await page.locator('input[autocomplete="current-password"]').fill('Correct-horse-42!');
  await page.getByRole('radio', { name: 'Hire' }).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Enter your name (at least 2 letters) to create an account.')).toBeVisible();
  expect(bodies).toEqual([]);
  await page.getByLabel(/Your name/).fill('Meera Shah');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).toMatchObject({ email: 'meera@example.test', intent: 'client', full_name: 'Meera Shah' });
});
