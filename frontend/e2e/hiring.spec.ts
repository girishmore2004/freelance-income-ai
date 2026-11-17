import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * Phase 3 hiring loop: proposal → offer → two-party acceptance.
 * The Edge API is mocked; runs in bearer and cookie modes.
 */

type Captured = { method: string; path: string; body: Record<string, unknown> | null };

const ok = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });

async function signIn(page: Page): Promise<void> {
  if (process.env.E2E_AUTH_MODE !== 'cookie') {
    await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
  }
}

async function mock(page: Page, captured: Captured[], handler: (path: string, method: string, body: Record<string, unknown> | null) => unknown | undefined): Promise<void> {
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const body = request.postData() ? (JSON.parse(request.postData() as string) as Record<string, unknown>) : null;
    captured.push({ method: request.method(), path, body });
    const result = handler(path, request.method(), body);
    if (result === undefined) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: result as string });
  });
}

const PROJECT = {
  id: 'L1', published_at: '2026-11-17T00:00:00Z', client_name: 'Acme Studio', title: 'Bakery ordering website', category_slug: 'website_development',
  outcome: 'Customers order cakes online.', description: '', deliverables: ['Order form'], skills: ['Next.js'], experience_level: 'any',
  budget_model: 'fixed', budget_min_minor: 2_000_000, budget_max_minor: 4_000_000, currency: 'INR', deadline: null, milestones: [],
  acceptance_criteria: ['Orders arrive'], revision_rounds: 2, confidential: false,
};

const VERSION = {
  version: 1, title: 'Bakery ordering website', scope: '', deliverables: ['Order form'],
  milestones: [{ title: 'Complete project', amount_minor: 3_000_000, due_date: null }], total_minor: 3_000_000, currency: 'INR',
  revision_rounds: 2, acceptance_criteria: ['Orders arrive'], ownership_terms: '', content_hash: 'h', proposed_by: 'client',
  created_at: '2026-11-17T00:00:00Z', client_accepted_at: '2026-11-17T00:00:00Z', freelancer_accepted_at: null as string | null,
};

test('freelancer sends a proposal with their own price', async ({ page }) => {
  const captured: Captured[] = [];
  await signIn(page);
  await mock(page, captured, (path, method) => {
    if (path === '/api/v1/me') return ok({ id: 'f1', roles: ['freelancer'] });
    if (path === '/api/v1/project-categories') return ok([{ slug: 'website_development', name: 'Website development' }]);
    if (path === '/api/v1/marketplace/listings') return ok({ items: [PROJECT], next_before: null });
    if (path === '/api/v1/marketplace/listings/L1/proposals' && method === 'POST') return ok({ id: 'P1', status: 'submitted' }, 'Proposal sent');
    return undefined;
  });
  await page.goto('/projects');
  await page.getByRole('button', { name: 'Show details' }).click();
  await page.getByRole('button', { name: 'Send a proposal' }).click();
  await page.getByLabel(/How you would do the work/).fill('I have built three bakery ordering sites with Next.js and can deliver in three weeks.');
  await page.getByLabel(/Your price/).fill('30000');
  await page.getByLabel(/Estimated days/).fill('21');
  await page.getByRole('button', { name: 'Send proposal', exact: true }).click();
  await expect(page.getByText('Proposal sent')).toBeVisible();
  await expect.poll(() => captured.find((c) => c.method === 'POST' && c.path === '/api/v1/marketplace/listings/L1/proposals')?.body).toEqual({
    cover_letter: 'I have built three bakery ordering sites with Next.js and can deliver in three weeks.', price_minor: 3_000_000, estimated_days: 21,
  });
});

test('client turns a proposal into an offer with edited milestones', async ({ page }) => {
  const captured: Captured[] = [];
  await signIn(page);
  await mock(page, captured, (path, method) => {
    if (path === '/api/v1/me') return ok({ id: 'c1', roles: ['client'] });
    if (path === '/api/v1/me/identity') return ok({ roles: ['client'], client_side_enabled: true, organizations: [{ id: 'o1', name: 'Acme Studio', membership_role: 'owner', kind: 'company' }] });
    if (path === '/api/v1/project-categories') return ok([{ slug: 'website_development', name: 'Website development', description: '', template: { stages: [], acceptance: [], default_revisions: 2 } }]);
    if (path === '/api/v1/organizations/o1/listings') {
      return ok([{ id: 'L1', status: 'published', visibility: 'public', moderation_status: 'passed', current_version: 1, published_at: '2026-11-17T00:00:00Z', closes_at: null, brief: { ...PROJECT, milestones: [], languages: ['en'], timezone: '', confidentiality: 'standard', ownership_notes: 'Client owns the code', assumptions: [] } }]);
    }
    if (path === '/api/v1/listings/L1/proposals') {
      return ok([{ id: 'P1', status: 'submitted', cover_letter: 'Three bakery sites built.', price_minor: 3_000_000, currency: 'INR', budget_model: 'fixed', estimated_days: 21, invited: false, created_at: '2026-11-17T00:00:00Z', contract_id: null, contract_status: null, freelancer: { user_id: 'f1', display_name: 'Asha Rao', headline: 'Next.js developer', skills: [], services: [], hourly_rate: null, currency: 'INR', weekly_hours: 20, timezone: '', newcomer: false } }]);
    }
    if (path === '/api/v1/listing-proposals/P1/offer' && method === 'POST') return ok({ id: 'K1', status: 'offered' }, 'Offer sent');
    return undefined;
  });
  await page.goto('/client/projects');
  await page.getByRole('button', { name: 'Proposals' }).click();
  await expect(page.getByText('Three bakery sites built.')).toBeVisible();
  await page.getByRole('button', { name: 'Make an offer' }).click();
  await expect(page.getByLabel('Amount (₹)')).toHaveValue('30000');
  await page.getByLabel('Milestone 1').fill('Design');
  await page.getByLabel('Amount (₹)').fill('12000');
  await page.getByRole('button', { name: 'Add milestone' }).click();
  await page.getByLabel('Milestone 2').fill('Build and launch');
  await page.getByLabel('Amount (₹)').nth(1).fill('20000');
  await expect(page.getByText('Total: ₹32,000')).toBeVisible();
  await page.getByRole('button', { name: 'Send offer' }).click();
  await expect(page.getByText(/Offer sent to Asha Rao/)).toBeVisible();
  const offer = captured.find((c) => c.method === 'POST' && c.path === '/api/v1/listing-proposals/P1/offer');
  expect(offer?.body).toMatchObject({
    terms: {
      title: 'Bakery ordering website', ownership_terms: 'Client owns the code', revision_rounds: 2,
      milestones: [{ title: 'Design', amount_minor: 1_200_000, due_date: null }, { title: 'Build and launch', amount_minor: 2_000_000, due_date: null }],
    },
  });
});

test('freelancer accepts the offer and the contract becomes active', async ({ page }) => {
  const captured: Captured[] = [];
  let status = 'offered';
  await signIn(page);
  const detail = () => ({
    id: 'K1', status, party: 'freelancer', client_name: 'Acme Studio', project_title: 'Bakery ordering website', current_version: 1,
    activated_at: status === 'active' ? '2026-11-17T01:00:00Z' : null,
    terms: { ...VERSION, freelancer_accepted_at: status === 'active' ? '2026-11-17T01:00:00Z' : null }, versions: [VERSION],
    allowed_actions: status === 'offered' ? ['accept', 'propose_changes', 'decline'] : [],
    funding: { available: false, message: 'Milestone funding is not available yet.' },
  });
  await mock(page, captured, (path) => {
    if (path === '/api/v1/me') return ok({ id: 'f1', roles: ['freelancer'] });
    if (path === '/api/v1/contracts') return ok([{ id: 'K1', status, party: 'freelancer', client_name: 'Acme Studio', current_version: 1, activated_at: null, terms: VERSION }]);
    if (path === '/api/v1/contracts/K1') return ok(detail(), 'Contract');
    if (path === '/api/v1/contracts/K1/accept') { status = 'active'; return ok(detail(), 'Both parties accepted. The contract is active.'); }
    if (path === '/api/v1/contracts/K1/workspace') {
      return ok({ contract_id: 'K1', status, party: 'freelancer', can_manage: true, revision_rounds: 2, currency: 'INR', milestones: [], approved_minor: 0, total_minor: 3_000_000, messages: [], activity: [], funding_note: '' }, 'Workspace');
    }
    return undefined;
  });
  await page.goto('/contracts');
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByText('Milestone funding is not available yet.')).toBeVisible();
  await expect(page.getByRole('cell', { name: '₹30,000' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Accept version 1' }).click();
  await expect(page.getByText('Both parties accepted. The contract is active.')).toBeVisible();
  await expect.poll(() => captured.find((c) => c.path === '/api/v1/contracts/K1/accept')?.body).toEqual({ version: 1 });
  await expect(page.getByRole('button', { name: 'Accept version 1' })).toHaveCount(0);
});

test('freelancer delivers a milestone and the client approves it in the workspace', async ({ page }) => {
  const captured: Captured[] = [];
  let state = 'pending';
  let party: 'freelancer' | 'client' = 'freelancer';
  await signIn(page);
  const active = { ...VERSION, freelancer_accepted_at: '2026-11-17T01:00:00Z' };
  const workspace = () => ({
    contract_id: 'K1', status: 'active', party, can_manage: true, revision_rounds: 2, currency: 'INR',
    milestones: [{ index: 0, title: 'Complete project', amount_minor: 3_000_000, due_date: null, state, revisions_used: 0,
      submissions: state === 'pending' ? [] : [{ id: 's1', status: state, note: 'Site is live on staging', links: ['https://staging.example.com/'], submitted_at: '2026-11-18T00:00:00Z', reviewed_at: null, review_note: '' }] }],
    approved_minor: state === 'approved' ? 3_000_000 : 0, total_minor: 3_000_000, messages: [], activity: [],
    funding_note: 'Approval records that the work is accepted. No payment is released: payments are not enabled yet.',
  });
  await mock(page, captured, (path, method, body) => {
    if (path === '/api/v1/me') return ok({ id: party === 'freelancer' ? 'f1' : 'c1', roles: [party] });
    if (path === '/api/v1/contracts') return ok([{ id: 'K1', status: 'active', party, client_name: 'Acme Studio', current_version: 1, activated_at: '2026-11-17T01:00:00Z', terms: active }]);
    if (path === '/api/v1/contracts/K1') return ok({ id: 'K1', status: 'active', party, client_name: 'Acme Studio', project_title: 'Bakery ordering website', current_version: 1, activated_at: '2026-11-17T01:00:00Z', terms: active, versions: [active], allowed_actions: [], funding: { available: false, message: 'Milestone funding is not available yet.' } });
    if (path === '/api/v1/contracts/K1/workspace') return ok(workspace(), 'Workspace');
    if (path === '/api/v1/contracts/K1/milestones/0/submit' && method === 'POST') { state = 'submitted'; return ok({ milestone: 0, state }, 'Delivered. The client will review it.'); }
    if (path === '/api/v1/contracts/K1/milestones/0/review' && method === 'POST') { state = (body?.decision === 'approve') ? 'approved' : 'revision_requested'; return ok({ milestone: 0, state, contract_completed: false }, 'Milestone approved. No payment is released: payments are not enabled yet.'); }
    return undefined;
  });

  await page.goto('/contracts');
  await page.getByRole('button', { name: 'Open' }).click();
  await page.getByRole('button', { name: 'Deliver work' }).click();
  await page.getByLabel('What are you delivering?').fill('Site is live on staging');
  await page.getByLabel(/Links/).fill('https://staging.example.com/');
  await page.getByRole('button', { name: 'Deliver', exact: true }).click();
  await expect(page.getByText('Delivered. The client will review it.')).toBeVisible();
  await expect.poll(() => captured.find((c) => c.path === '/api/v1/contracts/K1/milestones/0/submit')?.body).toEqual({ note: 'Site is live on staging', links: ['https://staging.example.com/'] });

  party = 'client';
  await page.reload();
  await page.getByRole('button', { name: 'Open' }).click();
  await page.getByRole('button', { name: 'Review delivery' }).click();
  await page.getByRole('button', { name: 'Approve milestone' }).click();
  await expect(page.getByText(/Milestone approved/).first()).toBeVisible();
  await expect.poll(() => captured.find((c) => c.path === '/api/v1/contracts/K1/milestones/0/review')?.body).toEqual({ decision: 'approve', note: '' });
});

test('after completion the freelancer reviews the client without seeing the hidden review first', async ({ page }) => {
  const captured: Captured[] = [];
  let reviewed = false;
  await signIn(page);
  const done = { ...VERSION, freelancer_accepted_at: '2026-11-17T01:00:00Z' };
  await mock(page, captured, (path, method) => {
    if (path === '/api/v1/me') return ok({ id: 'f1', roles: ['freelancer'] });
    if (path === '/api/v1/contracts') return ok([{ id: 'K1', status: 'completed', party: 'freelancer', client_name: 'Acme Studio', current_version: 1, activated_at: null, terms: done }]);
    if (path === '/api/v1/contracts/K1') return ok({ id: 'K1', status: 'completed', party: 'freelancer', client_name: 'Acme Studio', project_title: 'Bakery ordering website', current_version: 1, agreed_version: 1, pending_change: false, agreed_terms: null, activated_at: null, terms: done, versions: [done], allowed_actions: [], funding: { available: false, message: '' } });
    if (path === '/api/v1/contracts/K1/workspace') return ok({ contract_id: 'K1', status: 'completed', party: 'freelancer', can_manage: true, revision_rounds: 2, currency: 'INR', milestones: [], approved_minor: 3_000_000, total_minor: 3_000_000, messages: [], activity: [], funding_note: '' });
    if (path === '/api/v1/contracts/K1/review' && method === 'POST') {
      reviewed = true;
      return ok({ party: 'freelancer', can_review: false, revealed: true, mine: { party: 'freelancer', rating: 4, comment: 'Clear brief', created_at: '2026-11-18T00:00:00Z' }, theirs: { party: 'client', rating: 5, comment: 'Great work', created_at: '2026-11-18T00:00:00Z' }, theirs_submitted: true }, 'Review published');
    }
    if (path === '/api/v1/contracts/K1/reviews') {
      return ok({ party: 'freelancer', can_review: !reviewed, revealed: false, mine: null, theirs: null, theirs_submitted: true });
    }
    return undefined;
  });
  await page.goto('/contracts');
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByText(/The client has reviewed you/)).toBeVisible();
  await expect(page.getByText('Great work')).toHaveCount(0);
  await page.getByLabel('Rating').selectOption('4');
  await page.getByLabel(/Comment/).fill('Clear brief');
  await page.getByRole('button', { name: 'Submit review' }).click();
  await expect(page.getByText('Review published')).toBeVisible();
  await expect(page.getByText('Great work')).toBeVisible();
  await expect.poll(() => captured.find((c) => c.path === '/api/v1/contracts/K1/review')?.body).toEqual({ rating: 4, comment: 'Clear brief' });
});
