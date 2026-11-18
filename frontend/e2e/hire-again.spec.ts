import { test, expect, type Route } from '@playwright/test';

/** U14: weekly progress on the timeline and "Hire again" from a completed contract. */

const ok = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });

async function signIn(page: import('@playwright/test').Page): Promise<void> {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
}

const TERMS = { version: 1, title: 'Cafe website', scope: '', deliverables: [], milestones: [{ title: 'Design', amount_minor: 1_000_000, due_date: null }], total_minor: 1_000_000, currency: 'INR', revision_rounds: 2, acceptance_criteria: [], ownership_terms: '', content_hash: 'h', proposed_by: 'client', created_at: '2026-11-17T00:00:00Z', client_accepted_at: '2026-11-17T00:00:00Z', freelancer_accepted_at: '2026-11-17T00:00:00Z' };

function routes(status: string, extra: (path: string, request: import('@playwright/test').Request) => string | null) {
  return async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'c1', roles: ['client'] }));
    if (path === '/api/v1/contracts') return reply(ok([{ id: 'K1', status, party: 'client', client_name: 'Acme', current_version: 1, activated_at: null, terms: TERMS }]));
    if (path === '/api/v1/contracts/K1') return reply(ok({ id: 'K1', status, party: 'client', can_manage: true, organization_id: 'o1', freelancer_user_id: 'f1', client_name: 'Acme', project_title: 'Cafe website', current_version: 1, agreed_version: 1, pending_change: false, agreed_terms: null, activated_at: null, terms: TERMS, versions: [TERMS], allowed_actions: [], funding: { available: false, message: '' } }));
    const body = extra(path, request);
    if (body) return reply(body, request.method() === 'POST' ? 201 : 200);
    return reply(JSON.stringify([]));
  };
}

test('the timeline opens with this week in plain sentences', async ({ page }) => {
  await signIn(page);
  await page.route('**/api/v1/**', routes('active', (path) => {
    if (path === '/api/v1/contracts/K1/progress') return ok({ period_days: 7, lines: ['Milestones: 0 of 1 approved.', 'Done this week: Wireframes.', 'Overdue: Content from client.'] });
    if (path === '/api/v1/contracts/K1/workspace') return ok({ milestones: [], activity: [] });
    return null;
  }));
  await page.goto('/contracts');
  await page.getByRole('button', { name: 'Open' }).click();
  await page.getByRole('tab', { name: 'Timeline' }).click();
  const week = page.getByRole('region', { name: 'This week' });
  await expect(week).toContainText('Done this week: Wireframes.');
  await expect(week).toContainText('Overdue: Content from client.');
});

test('a client invites the freelancer from a completed contract to a new project', async ({ page }) => {
  await signIn(page);
  let invited: unknown = null;
  await page.route('**/api/v1/**', routes('completed', (path, request) => {
    if (path === '/api/v1/organizations/o1/listings') return ok([{ id: 'L2', status: 'published', brief: { title: 'Cafe mobile app' } }, { id: 'L3', status: 'draft', brief: { title: 'Draft idea' } }]);
    if (path === '/api/v1/listings/L2/invitations' && request.method() === 'POST') { invited = JSON.parse(request.postData() as string); return ok({ id: 'I9' }, 'Invitation sent'); }
    return null;
  }));
  await page.goto('/contracts');
  await page.getByRole('button', { name: 'Open' }).click();
  const hire = page.getByRole('region', { name: 'Hire again' });
  await expect(hire.getByLabel('Invite to project')).toContainText('Cafe mobile app');
  await expect(hire.getByLabel('Invite to project')).not.toContainText('Draft idea');
  await hire.getByLabel('Message (optional)').fill('Loved working together. Want to build the app too?');
  await hire.getByRole('button', { name: 'Send invitation' }).click();
  await expect(hire).toContainText('Invitation sent.');
  expect(invited).toEqual({ freelancer_user_id: 'f1', message: 'Loved working together. Want to build the app too?' });
});
