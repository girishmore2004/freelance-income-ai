import { test, expect, type Page, type Route } from '@playwright/test';

/** U6: analytics surfaces and staff tools (users, audit log, system health). The Edge API is mocked. */

const ok = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });
const rate = (value: number | null, numerator: number, denominator: number) => ({ value, numerator, denominator, small_sample: denominator < 5 });
const months = (values: number[]) => values.map((v, i) => ({ period: `2026-${String(6 + i).padStart(2, '0')}`, total: v }));

async function signIn(page: Page): Promise<void> {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
}

const FREELANCER = {
  proposals: {
    by_month: months([0, 0, 1, 2, 0, 3]).map((m) => ({ period: m.period, sent: m.total, won: m.total ? 1 : 0 })),
    total: 6, success_rate: rate(0.667, 2, 3), shortlist_rate: rate(0.5, 3, 6),
    pricing_performance: [{ band: 'within', proposals: 4, success: rate(0.5, 1, 2) }, { band: 'above', proposals: 2, success: rate(0, 0, 1) }],
    by_source: { open_marketplace: { proposals: 5, success: rate(0.5, 1, 2) }, invitations: { proposals: 1, success: rate(1, 1, 1) } },
  },
  earnings: { released_by_month: { sandbox: months([0, 0, 0, 0, 975_000, 0]) } },
  contracts: { count: 2, average_value_minor: 3_000_000, average_value_small_sample: true, repeat_client_rate: rate(1, 1, 1), pipeline_minor: 2_025_000, active: 1 },
  delivery: { revision_rate: rate(0.25, 1, 4) },
  external: { available: true, by_source: [{ source: 'remotive', found: 12, applied: 3, won: 1 }] },
  definitions: { proposal_success_rate: 'Proposals that led to an offer or a hire ÷ proposals the client decided on.' },
};

test('a freelancer sees their business numbers with samples, test-money labels and definitions', async ({ page }) => {
  await signIn(page);
  await page.route('**/api/v1/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'f1', roles: ['freelancer'] }));
    if (path === '/api/v1/me/identity') return reply(ok({ roles: ['freelancer'], organizations: [] }));
    if (path === '/api/v1/analytics/freelancer') return reply(ok(FREELANCER));
    return reply(JSON.stringify([]));
  });
  await page.goto('/analytics');
  await expect(page.getByText('67% (2 of 3)')).toBeVisible();
  await expect(page.getByText('Small sample (3): treat as an early signal, not a trend.')).toBeVisible();
  await expect(page.getByText('Earnings released to you — Test mode (not real money)')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Hiring and spend' })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'External · remotive' })).toBeVisible();
  // Every chart has a table view with exact values.
  const chart = page.locator('figure', { hasText: 'Earnings released to you' });
  await chart.getByRole('button', { name: 'Show table' }).click();
  await expect(chart.getByRole('cell', { name: '₹9,750' })).toBeVisible();
  await page.getByText('How these numbers are defined').click();
  await expect(page.getByText('Proposals that led to an offer or a hire ÷ proposals the client decided on.')).toBeVisible();
});

test('an admin finds a user, opens their history, and reads the audit log and system health', async ({ page }) => {
  await signIn(page);
  const searches: string[] = [];
  await page.route('**/api/v1/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'a1', roles: ['admin'] }));
    if (path === '/api/v1/admin/overview') return reply(ok({ is_admin: true, counts: { users: 2 }, flags: [] }));
    if (path === '/api/v1/admin/moderation/listings' || path === '/api/v1/admin/reports') return reply(ok([]));
    if (path === '/api/v1/admin/users') {
      searches.push(url.searchParams.get('q') ?? '');
      return reply(ok({ items: [{ id: 'u1', email: 'asha@example.com', created_at: '2026-11-01T00:00:00Z', email_verified: true, mfa_enabled: true, suspended: false, roles: ['freelancer'] }], next_before: null }));
    }
    if (path === '/api/v1/admin/users/u1') {
      return reply(ok({
        user: { id: 'u1', email: 'asha@example.com', created_at: '2026-11-01T00:00:00Z', email_verified: true, mfa_enabled: true, suspended: false, roles: ['freelancer'] },
        profile: { full_name: 'Asha Rao', headline: 'Web developer' }, organizations: [],
        counts: { proposals: 4, contracts_as_freelancer: 1, listings_created: 0, reports_against: 1, reports_made: 0, disputes_opened: 0 },
        suspensions: [{ id: 'S1', reason: 'Off-platform payment request', status: 'lifted', created_at: '2026-11-05T00:00:00Z', lifted_at: '2026-11-06T00:00:00Z', appeal_status: 'overturned' }],
        staff_actions: [],
      }));
    }
    if (path === '/api/v1/admin/audit-log') {
      return reply(ok({ items: [{ id: 'A1', actor_user_id: 'a1', actor_email: 'admin@example.com', target_type: 'flag', target_id: 'marketplace.client_side', action: 'flag.enabled', note: '', created_at: '2026-11-17T09:00:00Z' }], next_before: null, target_types: ['flag'] }));
    }
    if (path === '/api/v1/admin/health') {
      return reply(ok({
        version: '5.71.0', environment: 'production', database: { ok: true, latency_ms: 12 },
        migration: { current: '0066_business_coach_partial', expected: '0067_proposal_studio', ok: false, readable: true },
        configuration: [{ key: 'files_bucket', ok: false, detail: 'R2 bucket FILES is not bound: file uploads are off (K-26).' }],
        ai_today: { calls: 3, cost_usd: 0.01 }, queues: { reports_open: 0 },
      }));
    }
    return reply(JSON.stringify([]));
  });
  await page.goto('/admin');
  const users = page.getByRole('region', { name: 'Users' });
  await users.getByLabel('Email or user ID').fill('asha');
  await users.getByRole('button', { name: 'Search' }).click();
  await expect.poll(() => searches.includes('asha')).toBe(true);
  await users.getByRole('button', { name: 'View' }).click();
  const detail = page.getByLabel('User details');
  await expect(detail.getByText('Asha Rao')).toBeVisible();
  await expect(detail.getByText(/Off-platform payment request — lifted/)).toBeVisible();
  await expect(page.getByRole('cell', { name: 'flag.enabled' })).toBeVisible();
  await expect(page.getByText('Database is at 0066_business_coach_partial; this release expects 0067_proposal_studio. Run the Neon migration workflow.')).toBeVisible();
  await expect(page.getByText('R2 bucket FILES is not bound: file uploads are off (K-26).')).toBeVisible();
});
