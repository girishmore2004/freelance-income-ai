import { test, expect, type Route } from '@playwright/test';

/** U19: hourly contracts — the freelancer logs and submits a week, the client approves and pays it (test mode). */

const ok = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });

async function signIn(page: import('@playwright/test').Page): Promise<void> {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
}

const BILLING = { type: 'hourly', hourly_rate_minor: 80000, weekly_limit_hours: 10 };
const TERMS = { version: 1, title: 'Website upkeep', scope: '', deliverables: [], milestones: [], total_minor: 800000, currency: 'INR', revision_rounds: 1, acceptance_criteria: [], ownership_terms: '', billing: BILLING, content_hash: 'h', proposed_by: 'client', created_at: '2026-11-18T00:00:00Z', client_accepted_at: '2026-11-18T00:00:00Z', freelancer_accepted_at: '2026-11-18T00:00:00Z' };
const WEEK = (status: string, extra: Record<string, unknown> = {}) => ({
  id: 'W1', week_start: '2026-11-16', status, minutes: 150, rate_minor: 80000, amount_minor: 200000, amount_final: status !== 'open', client_note: '',
  entries: [{ id: 'E1', work_date: '2026-11-17', minutes: 150, description: 'Fixed the checkout bug' }], payment: null, ...extra,
});

function routes(party: 'freelancer' | 'client', state: { week: Record<string, unknown>; posts: Array<[string, unknown]> }) {
  return async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string, status = 200) => route.fulfill({ status, contentType: 'application/json', body });
    if (request.method() === 'POST') state.posts.push([path, request.postData() ? JSON.parse(request.postData() as string) : null]);
    if (path === '/api/v1/me') return reply(ok({ id: party === 'freelancer' ? 'f1' : 'c1', roles: [party] }));
    const contract = { id: 'K1', status: 'active', party, client_name: 'Acme', current_version: 1, activated_at: '2026-11-16T00:00:00Z', terms: TERMS };
    if (path === '/api/v1/contracts') return reply(ok([contract]));
    if (path === '/api/v1/contracts/K1') return reply(ok({ ...contract, can_manage: true, project_title: 'Upkeep', agreed_version: 1, pending_change: false, agreed_terms: null, versions: [TERMS], allowed_actions: ['propose_changes'], funding: { available: false, message: '' } }));
    if (path === '/api/v1/contracts/K1/timesheets') {
      return reply(ok({ billing: BILLING, party, can_log: party === 'freelancer', can_decide: party === 'client', can_end: true, contract_status: 'active', this_week: '2026-11-16', limit_minutes: 600, this_week_minutes: 150, weeks: [state.week], note: 'Hours are paid per approved week.' }));
    }
    if (path === '/api/v1/contracts/K1/time-entries') return reply(ok({ id: 'E2' }, 'Time logged'), 201);
    if (path === '/api/v1/timesheets/W1/submit') { state.week = WEEK('submitted'); return reply(ok({ status: 'submitted' })); }
    if (path === '/api/v1/timesheets/W1/review') { state.week = WEEK('approved'); return reply(ok({ status: 'approved' })); }
    if (path === '/api/v1/timesheets/W1/pay') { state.week = WEEK('approved', { payment: { id: 'P1', status: 'created', amount_minor: 200000, client_fee_minor: 10000, freelancer_fee_minor: 6000, total_minor: 210000, mode: 'sandbox' } }); return reply(ok({}), 201); }
    if (path === '/api/v1/payments/sandbox/P1/complete') { state.week = WEEK('paid', { payment: { id: 'P1', status: 'released', amount_minor: 200000, client_fee_minor: 10000, freelancer_fee_minor: 6000, total_minor: 210000, mode: 'sandbox' } }); return reply(ok({})); }
    return reply(JSON.stringify([]));
  };
}

test('the freelancer logs time and submits the week', async ({ page }) => {
  await signIn(page);
  const state = { week: WEEK('open'), posts: [] as Array<[string, unknown]> };
  await page.route('**/api/v1/**', routes('freelancer', state));
  await page.goto('/contracts#K1');
  await page.getByRole('tab', { name: 'Hours' }).click();
  const hours = page.getByRole('region', { name: 'Hours' });
  await expect(hours).toContainText('₹800 an hour · up to 10 hours a week');
  await expect(hours).toContainText('2 h 30 min × ₹800/h = ₹2,000');

  await page.getByLabel('Time spent').fill('1:15');
  await page.getByLabel('What you did').fill('Updated the menu page');
  await hours.getByRole('button', { name: 'Add time' }).click();
  await expect(page.getByRole('status')).toContainText('Time logged.');
  expect(state.posts.find(([p]) => p.endsWith('/time-entries'))?.[1]).toMatchObject({ minutes: 75, description: 'Updated the menu page' });

  await hours.getByRole('button', { name: 'Submit week of 2026-11-16' }).click();
  await expect(hours).toContainText('Waiting for approval');
});

test('the client approves and pays a week', async ({ page }) => {
  await signIn(page);
  const state = { week: WEEK('submitted'), posts: [] as Array<[string, unknown]> };
  await page.route('**/api/v1/**', routes('client', state));
  await page.goto('/contracts#K1');
  await page.getByRole('tab', { name: 'Hours' }).click();
  const hours = page.getByRole('region', { name: 'Hours' });
  await expect(hours.getByRole('form', { name: 'Log time' })).toHaveCount(0);
  await hours.getByRole('button', { name: 'Approve week of 2026-11-16' }).click();
  await expect(hours).toContainText('Approved — to pay');
  await hours.getByRole('button', { name: 'Pay week of 2026-11-16' }).click();
  await hours.getByRole('button', { name: 'Complete test payment of ₹2,100' }).click();
  await expect(hours).toContainText('Paid');
  await expect(hours).toContainText('freelancer received ₹1,940');
});
