import { test, expect, type Route } from '@playwright/test';

/** Phase 7 batch 2: a party raises a dispute; staff read the evidence pack and decide; a suspended person appeals. */

const ok = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });

async function signIn(page: import('@playwright/test').Page): Promise<void> {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
}

const TERMS = { version: 1, title: 'Cafe website', scope: '', deliverables: [], milestones: [{ title: 'Design', amount_minor: 1_000_000, due_date: null }], total_minor: 1_000_000, currency: 'INR', revision_rounds: 2, acceptance_criteria: [], ownership_terms: '', content_hash: 'h', proposed_by: 'client', created_at: '2026-11-17T00:00:00Z', client_accepted_at: '2026-11-17T00:00:00Z', freelancer_accepted_at: '2026-11-17T00:00:00Z' };
const DESCRIPTION = 'The design was never delivered and the freelancer stopped replying for two weeks.';

test('a client raises a dispute and adds a statement', async ({ page }) => {
  let dispute: Record<string, unknown> | null = null;
  const posts: Array<{ path: string; body: unknown }> = [];
  await signIn(page);
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string, status = 200) => route.fulfill({ status, contentType: 'application/json', body });
    if (request.method() === 'POST') posts.push({ path, body: JSON.parse(request.postData() ?? '{}') });
    if (path === '/api/v1/me') return reply(ok({ id: 'c1', roles: ['client'] }));
    if (path === '/api/v1/contracts') return reply(ok([{ id: 'K1', status: 'active', party: 'client', client_name: 'Acme', current_version: 1, activated_at: null, terms: TERMS }]));
    if (path === '/api/v1/contracts/K1') return reply(ok({ id: 'K1', status: 'active', party: 'client', can_manage: true, client_name: 'Acme', project_title: 'Cafe website', current_version: 1, agreed_version: 1, pending_change: false, agreed_terms: null, activated_at: null, terms: TERMS, versions: [TERMS], allowed_actions: [], funding: { available: false, message: '' } }));
    if (path === '/api/v1/contracts/K1/dispute' && request.method() === 'GET') return reply(ok({ dispute, can_open: dispute === null }));
    if (path === '/api/v1/contracts/K1/dispute') {
      dispute = { id: 'D1', opened_by: 'client', mine: true, reason: 'non_delivery', description: DESCRIPTION, desired_outcome: 'Refund', status: 'open', resolution: null, resolution_note: '', resolved_at: null, created_at: '2026-11-17T00:00:00Z', statements: [] };
      return reply(ok(dispute, 'Dispute opened'), 201);
    }
    if (path === '/api/v1/disputes/D1/statements') {
      (dispute!.statements as unknown[]).push({ id: 'S1', party: 'client', body: 'No files in the workspace.', created_at: '2026-11-17T01:00:00Z' });
      return reply(ok({ id: 'S1' }, 'Statement added'), 201);
    }
    return reply(JSON.stringify([]));
  });
  await page.goto('/contracts');
  await page.getByRole('button', { name: 'Open' }).click();
  await page.getByRole('button', { name: 'Raise a dispute' }).click();
  await page.getByLabel('What is it about?').selectOption('non_delivery');
  await page.getByLabel(/What happened/).fill(DESCRIPTION);
  await page.getByLabel(/What outcome do you want/).fill('Refund');
  await page.getByRole('button', { name: 'Open dispute' }).click();
  await expect(page.getByText('Open: waiting for staff')).toBeVisible();
  await page.getByLabel('Add a statement or evidence note').fill('No files in the workspace.');
  await page.getByRole('button', { name: 'Add statement' }).click();
  await expect(page.getByText('No files in the workspace.')).toBeVisible();
  expect(posts.map((p) => p.path)).toEqual(['/api/v1/contracts/K1/dispute', '/api/v1/disputes/D1/statements']);
  expect(posts[0].body).toEqual({ reason: 'non_delivery', description: DESCRIPTION, desired_outcome: 'Refund' });
});

test('an admin reviews the evidence pack and refunds the client', async ({ page }) => {
  let open = true;
  const decisions: unknown[] = [];
  await signIn(page);
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'a1', roles: ['admin'] }));
    if (path === '/api/v1/admin/overview') return reply(ok({ is_admin: true, counts: { users: 3 }, flags: [] }));
    if (path === '/api/v1/admin/moderation/listings' || path === '/api/v1/admin/reports' || path === '/api/v1/admin/suspensions') return reply(ok([]));
    if (path === '/api/v1/admin/disputes') {
      return reply(ok(open ? [{ id: 'D1', contract_id: 'K1', opened_by: 'client', reason: 'non_delivery', description: DESCRIPTION, desired_outcome: 'Refund', status: 'open', resolution: null, created_at: '2026-11-17T00:00:00Z', contract_title: 'Cafe website', freelancer_name: 'Asha', organization_name: 'Acme', funded_unreleased_minor: 1_000_000 }] : []));
    }
    if (path === '/api/v1/admin/disputes/D1') {
      return reply(ok({ can_move_money: true, dispute: { statements: [{ id: 'S1', party: 'freelancer', body: 'I was ill for a week.', created_at: '2026-11-17T00:00:00Z' }] }, evidence: {
        contract: { status: 'active' }, agreed_terms: TERMS, submissions: [], messages: [{ party: 'client', body: 'Any update?', created_at: '2026-11-10T00:00:00Z' }], events: [],
        payments: [{ id: 'I1', milestone_index: 0, amount_minor: 1_000_000, currency: 'INR', status: 'funded', mode: 'sandbox' }], previous_disputes: [],
        summary: { milestones: 1, milestones_approved: 0, funded_unreleased_minor: 1_000_000, funded_unreleased_count: 1, submissions: 0, messages: 1 },
      } }));
    }
    if (path === '/api/v1/admin/disputes/D1/resolve') {
      decisions.push(JSON.parse(request.postData() as string));
      open = false;
      return reply(ok({ id: 'D1', refunded: 1 }, 'Decision recorded. 1 funded milestone(s) refunded to the client; contract cancelled.'));
    }
    return reply(JSON.stringify([]));
  });
  await page.goto('/admin');
  await expect(page.getByText(/funded, not released: ₹10,000/)).toBeVisible();
  await page.getByRole('button', { name: 'Open evidence pack' }).click();
  await expect(page.getByText('0 deliveries', { exact: false })).toBeVisible();
  await page.getByLabel(/Decision explanation/).fill('No delivery was recorded on the platform before the deadline.');
  await page.getByRole('button', { name: 'Refund funded to client' }).click();
  await expect(page.getByText('Decision recorded. 1 funded milestone(s) refunded to the client; contract cancelled.')).toBeVisible();
  await expect(page.getByText('No open disputes.')).toBeVisible();
  expect(decisions).toEqual([{ resolution: 'refund_funded', note: 'No delivery was recorded on the platform before the deadline.' }]);
});

test('a suspended freelancer sees the reason and appeals once', async ({ page }) => {
  let appealed = false;
  await signIn(page);
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string, status = 200) => route.fulfill({ status, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'f1', email: 'f1@example.com', roles: ['freelancer'], organizations: [] }));
    if (path === '/api/v1/me/suspension') {
      return reply(ok({ suspended: true, can_appeal: !appealed, suspension: { id: 'AS1', reason: 'Repeated requests to pay outside the platform.', status: 'active', created_at: '2026-11-17T00:00:00Z', lifted_at: null, lift_note: '', appeal_text: appealed ? 'x' : '', appeal_status: appealed ? 'pending' : 'none', appeal_at: null } }));
    }
    if (path === '/api/v1/me/suspension/appeal') { appealed = true; return reply(ok({ id: 'AS1' }, 'Appeal submitted'), 201); }
    return reply(JSON.stringify([]));
  });
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Your account is suspended' })).toBeVisible();
  await expect(page.getByText('Repeated requests to pay outside the platform.')).toBeVisible();
  await page.getByLabel(/Appeal: explain why/).fill('I only shared my portfolio link, never a payment request.');
  await page.getByRole('button', { name: 'Submit appeal' }).click();
  await expect(page.getByText('Your appeal is waiting for a staff member.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit appeal' })).toHaveCount(0);
});
