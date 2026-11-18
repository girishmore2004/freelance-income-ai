import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * U23 fair proposals and blocking (Master Plan B12, Step 6): the weekly proposal
 * limit and proposal ranges for freelancers, the client's proposal cap, and
 * blocks from both sides with Unblock on the account page. Edge API mocked.
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
    const result = handler(path, request.method(), body);
    return route.fulfill({ status: 200, contentType: 'application/json', body: result ?? JSON.stringify([]) });
  });
}

const PROJECT = {
  id: 'L1', published_at: '2026-11-17T00:00:00Z', client_name: 'Acme Studio', title: 'Bakery ordering website', category_slug: 'website_development',
  outcome: 'Customers order cakes online.', description: '', deliverables: ['Order form'], skills: ['Next.js'], experience_level: 'any',
  budget_model: 'fixed', budget_min_minor: 2_000_000, budget_max_minor: 4_000_000, currency: 'INR', deadline: null, milestones: [],
  acceptance_criteria: ['Orders arrive'], revision_rounds: 2, confidential: false, accepting_proposals: true, proposals: '5 to 10',
};

test('freelancers see the competition and their weekly limit, closed projects take no proposals, and a client can be blocked', async ({ page }) => {
  const captured: Captured[] = [];
  await signIn(page);
  await mock(page, captured, (path, method) => {
    if (path === '/api/v1/me') return ok({ id: 'f1', roles: ['freelancer'] });
    if (path === '/api/v1/project-categories') return ok([{ slug: 'website_development', name: 'Website development' }]);
    if (path === '/api/v1/marketplace/listings') {
      return ok({ items: [PROJECT, { ...PROJECT, id: 'L2', title: 'Closed cafe site', accepting_proposals: false, proposals: '20 to 50' }], next_before: null });
    }
    if (path === '/api/v1/me/proposal-quota') return ok({ limit: 10, used: 3, remaining: 7, hire_rate: null, explanation: 'Up to 10 proposals a week. The limit rises as clients hire you (after 5 proposals).' });
    if (path === '/api/v1/blocks' && method === 'POST') return ok({ id: 'B1', side: 'freelancer', proposals_closed: 0, invitations_withdrawn: 0 }, 'Blocked.');
    return undefined;
  });
  await page.goto('/projects');
  const bakery = page.getByRole('article').filter({ hasText: 'Bakery ordering website' });
  const cafe = page.getByRole('article').filter({ hasText: 'Closed cafe site' });
  await expect(bakery.getByText(/Proposals: 5 to 10/)).toBeVisible();
  await expect(cafe.getByText('Not taking new proposals')).toBeVisible();

  await cafe.getByRole('button', { name: 'Show details' }).click();
  await expect(cafe.getByText('The client has stopped taking new proposals for this project.')).toBeVisible();
  await expect(cafe.getByRole('button', { name: 'Send a proposal' })).toHaveCount(0);

  await bakery.getByRole('button', { name: 'Show details' }).click();
  await bakery.getByRole('button', { name: 'Send a proposal' }).click();
  await expect(bakery.getByText(/Proposals this week: 3 of 10/)).toBeVisible();

  await bakery.getByRole('button', { name: 'Block this client' }).click();
  await bakery.getByLabel(/Reason/).fill('Asked to pay outside');
  await bakery.getByRole('button', { name: 'Confirm block' }).click();
  await expect(bakery.getByText(/Blocked\. You can unblock on Account and team/)).toBeVisible();
  await expect.poll(() => captured.find((c) => c.method === 'POST' && c.path === '/api/v1/blocks')?.body).toEqual({ listing_id: 'L1', reason: 'Asked to pay outside' });
});

test('clients cap proposals, stop taking them, block a freelancer and unblock from the account page', async ({ page }) => {
  const captured: Captured[] = [];
  await signIn(page);
  let intake = { max_proposals: null as number | null, closed: false, received: 2, can_edit: true };
  let blocks = [{ id: 'B9', side: 'client', name: 'Ravi K', for_account: 'Acme Studio', reason: 'Spam', created_at: '2026-11-18T00:00:00Z' }];
  const proposal = { id: 'P1', status: 'submitted', cover_letter: 'Proposal from Asha', price_minor: 3_000_000, currency: 'INR', budget_model: 'fixed', estimated_days: 20, invited: false, created_at: '2026-11-17T00:00:00Z', contract_id: null, contract_status: null, freelancer: { user_id: 'f9', display_name: 'Asha Rao', headline: '', skills: [], services: [], hourly_rate: null, currency: 'INR', weekly_hours: 20, timezone: '', newcomer: false } };
  await mock(page, captured, (path, method, body) => {
    if (path === '/api/v1/me') return ok({ id: 'c1', roles: ['client'] });
    if (path === '/api/v1/me/identity') return ok({ user_id: 'c1', roles: ['client'], client_side_enabled: true, organizations: [{ id: 'o1', name: 'Acme Studio', membership_role: 'owner', kind: 'company' }] });
    if (path === '/api/v1/project-categories') return ok([{ slug: 'website_development', name: 'Website development', description: '', template: { stages: [], acceptance: [], default_revisions: 2 } }]);
    if (path === '/api/v1/organizations/o1/listings') {
      return ok([{ id: 'L1', status: 'published', visibility: 'public', moderation_status: 'passed', current_version: 1, published_at: '2026-11-17T00:00:00Z', closes_at: null, brief: { ...PROJECT, milestones: [], languages: ['en'], timezone: '', confidentiality: 'standard', ownership_notes: '', assumptions: [] } }]);
    }
    if (path === '/api/v1/listings/L1/proposals') return ok([proposal]);
    if (path === '/api/v1/listings/L1/intake') {
      if (method === 'POST') intake = { ...intake, max_proposals: (body?.max_proposals as number | null) ?? null, closed: body?.accepting === false };
      return ok(intake);
    }
    if (path === '/api/v1/blocks' && method === 'POST') return ok({ id: 'B1', side: 'client', proposals_closed: 1, invitations_withdrawn: 0 }, 'Blocked.');
    if (path === '/api/v1/me/blocks') return ok(blocks);
    if (path === '/api/v1/blocks/B9/remove') { blocks = []; return ok({ id: 'B9' }, 'Unblocked.'); }
    return undefined;
  });
  await page.goto('/client/projects');
  await page.getByRole('button', { name: 'Proposals', exact: true }).click();
  const limit = page.getByLabel('Proposal limit');
  await expect(limit.getByText('Taking proposals', { exact: true })).toBeVisible();
  await limit.getByLabel(/Stop after this many proposals/).fill('25');
  await limit.getByRole('button', { name: 'Save limit' }).click();
  await expect(limit.getByText(/of up to 25/)).toBeVisible();
  await limit.getByRole('button', { name: 'Stop taking proposals' }).click();
  await expect(limit.getByText('Not taking new proposals', { exact: true })).toBeVisible();
  await expect(limit.getByRole('button', { name: 'Take proposals again' })).toBeVisible();
  expect(captured.filter((c) => c.method === 'POST' && c.path === '/api/v1/listings/L1/intake').map((c) => c.body)).toEqual([
    { max_proposals: 25, accepting: true }, { max_proposals: 25, accepting: false },
  ]);

  await page.getByRole('button', { name: 'Block this freelancer' }).click();
  await page.getByRole('button', { name: 'Confirm block' }).click();
  await expect.poll(() => captured.find((c) => c.method === 'POST' && c.path === '/api/v1/blocks')?.body).toEqual({ proposal_id: 'P1', reason: '' });

  await page.goto('/account');
  const blocked = page.getByRole('region', { name: 'Blocked' });
  await expect(blocked.getByText('Ravi K', { exact: true })).toBeVisible();
  await blocked.getByRole('button', { name: 'Unblock Ravi K' }).click();
  await expect(blocked.getByText('Unblocked Ravi K.')).toBeVisible();
  await expect(blocked.getByText(/You have not blocked anyone/)).toBeVisible();
});
