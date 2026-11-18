import { test, expect, type Route } from '@playwright/test';

/** Business workspace, action plan and coach on the Edge API (legacy pages ported, K-01). */

const ok = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });

async function signIn(page: import('@playwright/test').Page): Promise<void> {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
}

test('workspace shows marketplace metrics and saves goals', async ({ page }) => {
  const saved: unknown[] = [];
  await signIn(page);
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'f1', roles: ['freelancer'] }));
    if (path === '/api/v1/workspace/overview') {
      return reply(ok({ as_of: '2026-11-18', goals: {}, data_policy: 'Own records only.',
        metrics: { active_contracts_as_freelancer: 3, deliveries_awaiting_client: 1, active_contracts_as_client: 0, deliveries_to_review: 0, month_proposals: 5, pending_proposal_approvals: 1, open_opportunities: null, overdue_invoices: null, overdue_tasks: null, released_this_month_minor: { sandbox: 975_000 }, paid_this_month_by_currency: {} },
        alerts: [{ id: 'a1', severity: 'high', title: 'Revise Cafe website, milestone 1', action: 'Deliver again.', href: '/contracts' }],
        recommendations: [{ priority: 'medium', title: 'Clear proposal review queue', reason: 'Drafts waiting.', action: 'Review them.', evidence: [{ type: 'pending_approvals', value: 1 }] }] }));
    }
    if (path === '/api/v1/business-goals' && request.method() === 'PUT') { saved.push(JSON.parse(request.postData() as string)); return reply(ok({ configured: true }, 'Business goals saved')); }
    if (path === '/api/v1/business-goals') return reply(ok({ monthly_income_target: 0, weekly_hours_target: 10, monthly_proposals_target: 4, monthly_outreach_target: 10, currency: 'INR', configured: false }));
    if (path === '/api/v1/workspace/events') return reply(ok([]));
    return reply(JSON.stringify([]));
  });
  await page.goto('/workspace');
  await expect(page.getByText('Revise Cafe website, milestone 1')).toBeVisible();
  await expect(page.getByText(/₹9,750 \(test mode — not real money\)/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Metrics' })).toContainText('—');
  await page.getByLabel('Monthly income target').fill('80000');
  await page.getByRole('button', { name: 'Save goals' }).click();
  await expect(page.getByText('Business goals saved.')).toBeVisible();
  expect(saved).toEqual([{ monthly_income_target: 80000, weekly_hours_target: 10, monthly_proposals_target: 4, monthly_outreach_target: 10, currency: 'INR' }]);
});

test('action plan lists evidence-linked next steps and filters by category', async ({ page }) => {
  await signIn(page);
  await page.route('**/api/v1/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'c1', roles: ['client'] }));
    if (path === '/api/v1/agent/action-plan') {
      return reply(ok({ as_of_date: '2026-11-18', total_actionable_records: 2, returned_actions: 2, policy: 'Recommendations only.', actions: [
        { priority: 1, category: 'delivery', title: 'Review delivery: Logo, milestone 1', reason: 'Waiting for you.', evidence: { type: 'contract', id: 'K1' }, suggested_action: 'Approve or request a revision.', due_date: null, requires_human_approval: true, href: '/contracts#K1' },
        { priority: 2, category: 'pipeline', title: '2 new proposals to review', reason: 'Freelancers replied.', evidence: { type: 'project_listing', id: 'L1' }, suggested_action: 'Compare proposals.', due_date: null, requires_human_approval: true, href: '/client/projects' },
      ] }));
    }
    return reply(JSON.stringify([]));
  });
  await page.goto('/agent');
  await expect(page.getByRole('heading', { name: 'Review delivery: Logo, milestone 1' })).toBeVisible();
  await page.getByLabel('Show').selectOption('pipeline');
  await expect(page.getByRole('heading', { name: 'Review delivery: Logo, milestone 1' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '2 new proposals to review' })).toBeVisible();
});

test('coach answers with the records it used', async ({ page }) => {
  await signIn(page);
  await page.route('**/api/v1/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'f1', roles: ['freelancer'] }));
    if (path === '/api/v1/coach/history') return reply(ok([]));
    if (path === '/api/v1/coach/ask') {
      return reply(ok({ id: 'Q1', question: 'What next?', answer: 'Deliver the revision on [contract:K1] first.', generation_mode: 'llm_grounded_context', created_at: '2026-11-18T06:00:00Z',
        sources: [{ id: 'contract:K1', type: 'contract', excerpt: 'Cafe website; status=active' }], citation_validation: { valid: ['contract:K1'], unknown: [] } }));
    }
    return reply(JSON.stringify([]));
  });
  await page.goto('/coach');
  await page.getByLabel('Your question').fill('What next?');
  await page.getByRole('button', { name: 'Ask the coach' }).click();
  await expect(page.getByText('Deliver the revision on [contract:K1] first.')).toBeVisible();
  await page.getByText('Records used (1)').click();
  await expect(page.getByText('Cafe website; status=active')).toBeVisible();
});
