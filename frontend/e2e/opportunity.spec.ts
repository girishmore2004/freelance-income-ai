import { test, expect, type Page, type Route } from '@playwright/test';

/** U8: one external opportunity as a single record — analysis, approval, submission, follow-ups, history. */

const ok = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });

async function signIn(page: Page): Promise<void> {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
}

function timeline(status: string, proposalStatus: string, approvals: unknown[], events: unknown[], applications: unknown[] = []) {
  const allowed: Record<string, string[]> = { drafted: ['skipped'], ready: ['applied', 'skipped'], applied: ['replied', 'interview', 'offer', 'won', 'lost', 'withdrawn'] };
  return {
    opportunity: { id: 'O1', title: 'Bakery ordering site', client_name: 'Acme', description: 'Build it', source: 'remotive', source_url: 'https://remotive.example/jobs/1', currency: 'INR' },
    analysis: { match_score: 78, matched_skills: ['Next.js'], missing_skills: ['Stripe'], budget: { status: 'fits', detail: 'Budget up to 40000 INR.' }, client: { payment_verified: true, rating: null, reviews: null }, risks: ['Many freelancers have already applied.'], recommendation: 'consider', reasons: ['You list 1 of the requested skills (Next.js).'], evidence: [] },
    proposals: [{ id: 'P1', version: 2, content: 'Hello, I read your post about a bakery ordering site and would build it in Next.js.', status: proposalStatus, proposed_price: null, currency: 'INR', approvals,
      versions: [{ version: 2, content: 'x', proposed_price: null, currency: 'INR', source: 'edited', created_at: '2026-11-18T05:00:00Z' }, { version: 1, content: 'y', proposed_price: null, currency: 'INR', source: 'safe_template', created_at: '2026-11-18T04:00:00Z' }] }],
    applications, events, status, allowed_transitions: allowed[status] ?? [], next_step: { action: 'x', text: status === 'ready' ? 'Apply on the original site (or send with an authorised integration), then record the submission.' : 'Edit the draft until every sentence is true, then approve the exact text.' },
    history_available: true, external_notice: 'Apply, sign the contract and get paid on the original platform. This record tracks your work on it; it never moves money.',
  };
}

test('a freelancer approves the exact text, records the submission and adds a follow-up', async ({ page }) => {
  await signIn(page);
  let state = 'drafted';
  const posts: Array<{ path: string; body: unknown }> = [];
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (request.method() === 'POST') posts.push({ path, body: request.postData() ? JSON.parse(request.postData() as string) : null });
    if (path === '/api/v1/me') return reply(ok({ id: 'f1', roles: ['freelancer'] }));
    if (path === '/api/v1/opportunities/O1/timeline') {
      if (state === 'drafted') return reply(ok(timeline('drafted', 'pending_approval', [{ id: 'A1', decision: 'pending', note: '', created_at: '2026-11-18T05:00:00Z', decided_at: null }], [])));
      if (state === 'ready') return reply(ok(timeline('ready', 'approved', [{ id: 'A1', decision: 'approved', note: '', created_at: '2026-11-18T05:00:00Z', decided_at: '2026-11-18T05:10:00Z' }], [{ id: 'E1', kind: 'status', from_status: 'drafted', to_status: 'ready', note: 'Proposal version 2 approved', due_date: null, done_at: null, created_at: '2026-11-18T05:10:00Z' }])));
      return reply(ok(timeline('applied', 'sent', [], [
        { id: 'E3', kind: 'follow_up', from_status: null, to_status: null, note: 'Ask if they read it', due_date: '2026-11-21', done_at: null, created_at: '2026-11-18T06:00:00Z' },
        { id: 'E2', kind: 'status', from_status: 'ready', to_status: 'applied', note: '', due_date: null, done_at: null, created_at: '2026-11-18T05:30:00Z' },
      ], [{ id: 'AP1', channel: 'external_site', status: 'sent', reference: 'bid-123', sent_at: '2026-11-18T05:30:00Z', replies: 0 }])));
    }
    if (path === '/api/v1/approvals/A1/decision') { state = 'ready'; return reply(ok({ id: 'A1', decision: 'approved' }, 'Proposal approved')); }
    if (path === '/api/v1/opportunities/O1/status') { state = 'applied'; return reply(ok({ opportunity: { id: 'O1' } }, 'Marked as applied')); }
    if (path === '/api/v1/opportunities/O1/events') return route.fulfill({ status: 201, contentType: 'application/json', body: ok({ id: 'E3' }, 'Added to your calendar') });
    return reply(JSON.stringify([]));
  });
  await page.goto('/opportunities?id=O1');
  await expect(page.getByText('Consider carefully')).toBeVisible();
  await expect(page.getByText('Many freelancers have already applied.')).toBeVisible();
  await expect(page.getByText(/never moves money/)).toBeVisible();
  await page.getByText('Version history (2)').click();
  await expect(page.getByText(/Version 1 · Template/)).toBeVisible();
  await page.getByRole('button', { name: 'Approve this exact text' }).click();
  await expect(page.getByText(/Approved. Apply on the original site/)).toBeVisible();
  await page.getByLabel('Where you applied').selectOption('external_site');
  await page.getByLabel(/Reference/).fill('bid-123');
  await page.getByRole('button', { name: 'I applied — record submission' }).click();
  await expect(page.getByRole('list', { name: 'Submissions' })).toContainText('external site · sent');
  expect(posts.find((p) => p.path === '/api/v1/opportunities/O1/status')?.body).toMatchObject({ status: 'applied', channel: 'external_site', reference: 'bid-123' });
  await page.getByLabel('Type').selectOption('follow_up');
  await page.getByLabel('Date').fill('2026-11-21');
  await page.getByLabel('What', { exact: true }).fill('Ask if they read it');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('list', { name: 'History' })).toContainText('Follow-up on 2026-11-21');
  await expect(page.getByRole('button', { name: 'Interview scheduled' })).toBeVisible();
});
