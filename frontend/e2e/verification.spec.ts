import { test, expect, type Page, type Route } from '@playwright/test';

/** U10: account review requests, the staff verification queue, source management and project reference files. */

const ok = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });
const MEANING = "Staff reviewed this account's public work evidence and history. This is not an identity check.";

async function signIn(page: Page): Promise<void> {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
}

test('a freelancer asks for a review and staff approve it with the evidence beside the record', async ({ page }) => {
  await signIn(page);
  let requested: Record<string, unknown> | null = null;
  let approved = false;
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string, status = 200) => route.fulfill({ status, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'f1', email: 'f1@example.test', roles: ['freelancer'] }));
    if (path === '/api/v1/me/identity') return reply(ok({ roles: ['freelancer'], client_side_enabled: true, organizations: [], user_id: 'f1' }));
    if (path === '/api/v1/me/verification' && request.method() === 'POST') {
      requested = JSON.parse(request.postData() as string);
      return reply(ok({ id: 'V1', status: 'pending' }, 'Sent for review'), 201);
    }
    if (path === '/api/v1/me/verification') {
      return reply(ok({ available: true, meaning: MEANING, organizations: [], freelancer: { verified_at: null, latest: requested ? { id: 'V1', status: 'pending', decision_note: '', created_at: '2026-11-18T06:00:00Z', decided_at: null } : null } }));
    }
    return reply(JSON.stringify([]));
  });
  await page.goto('/account');
  await expect(page.getByText(MEANING)).toBeVisible();
  await page.getByRole('button', { name: 'Ask for a review' }).click();
  await page.getByLabel(/Links to your work/).fill('https://github.com/f1\nhttps://f1.dev');
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByText('Waiting for staff review')).toBeVisible();
  expect(requested).toEqual({ subject: 'freelancer', links: ['https://github.com/f1', 'https://f1.dev'], note: '', registration_number: '' });

  // Staff side
  await page.unrouteAll();
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string, status = 200) => route.fulfill({ status, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'm1', roles: ['moderator'] }));
    if (path === '/api/v1/admin/overview') return reply(ok({ is_admin: false, counts: { users: 2, listings_in_review: 0, reports_open: 0, oldest_review_seconds: null }, flags: [] }));
    if (path === '/api/v1/admin/verifications/V1' && request.method() === 'POST') { approved = true; return reply(ok({ id: 'V1', status: 'approved' }, 'Request approved')); }
    if (path === '/api/v1/admin/verifications') {
      const status = new URL(request.url()).searchParams.get('status');
      const items = status === 'pending' && !approved ? [{
        id: 'V1', subject_type: 'freelancer', subject_id: 'f1', status: 'pending', own_request: false, created_at: '2026-11-18T06:00:00Z', decision_note: '',
        evidence: { links: ['https://github.com/f1'], note: '', registration_number: '' },
        facts: { name: 'Ravi', completed_contracts: 2, reports: 0, email_verified: true },
      }] : [];
      return reply(ok({ items, meaning: MEANING }));
    }
    if (path === '/api/v1/admin/sources') {
      return reply(ok({ available: true, can_manage: false, other_sources: [], items: [{ code: 'remotive', label: 'Remotive', kind: 'job_board', access: 'Public API', enabled: true, switch_enabled: true, off_by_worker_setting: false, note: '', health: 'partly_failing', runs_7d: 4, failures_7d: 1, fetched_7d: 30, stored_7d: 6, last_success_at: '2026-11-18T05:00:00Z', last_error: 'HTTP 503', freshness: { open: 6, under_3_days: 4, days_3_to_14: 2, over_14_days: 0, unknown: 0 } }] }));
    }
    return reply(JSON.stringify([]));
  });
  await page.goto('/admin');
  const queue = page.getByRole('list', { name: 'Verification requests' });
  await expect(queue).toContainText('Freelancer: Ravi');
  await expect(queue).toContainText('Completed contracts');
  await expect(page.getByRole('link', { name: 'https://github.com/f1' })).toHaveAttribute('rel', /noopener/);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('No pending requests.')).toBeVisible();
  expect(approved).toBe(true);
  // Moderators see source health but cannot switch sources.
  await expect(page.getByRole('table').filter({ hasText: 'Remotive' })).toContainText('Some failures');
  await expect(page.getByRole('button', { name: /Switch Remotive/ })).toHaveCount(0);
});

test('an admin switches a source off with a reason', async ({ page }) => {
  await signIn(page);
  const posts: unknown[] = [];
  let enabled = true;
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string, status = 200) => route.fulfill({ status, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'a1', roles: ['admin'] }));
    if (path === '/api/v1/admin/overview') return reply(ok({ is_admin: true, counts: { users: 2, listings_in_review: 0, reports_open: 0, oldest_review_seconds: null }, flags: [] }));
    if (path === '/api/v1/admin/sources/reddit') { posts.push(JSON.parse(request.postData() as string)); enabled = false; return reply(ok({ code: 'reddit', enabled: false })); }
    if (path === '/api/v1/admin/sources') {
      return reply(ok({ available: true, can_manage: true, other_sources: [], items: [{ code: 'reddit', label: 'Reddit r/forhire', kind: 'project', access: 'Public JSON feed', enabled, switch_enabled: enabled, off_by_worker_setting: false, note: enabled ? '' : 'Too many off-topic posts', health: enabled ? 'healthy' : 'off', runs_7d: 3, failures_7d: 0, fetched_7d: 20, stored_7d: 2, last_success_at: null, last_error: null, freshness: { open: 2, under_3_days: 1, days_3_to_14: 1, over_14_days: 0, unknown: 0 } }] }));
    }
    if (path === '/api/v1/admin/verifications') return reply(ok({ items: [], meaning: MEANING }));
    return reply(JSON.stringify([]));
  });
  await page.goto('/admin');
  await page.getByLabel('Reason for switching Reddit r/forhire off').fill('Too many off-topic posts');
  await page.getByRole('button', { name: 'Switch Reddit r/forhire off' }).click();
  await expect(page.getByRole('button', { name: 'Switch Reddit r/forhire on' })).toBeVisible();
  expect(posts).toEqual([{ enabled: false, note: 'Too many off-topic posts' }]);
});

test('a client adds a reference file to a project brief', async ({ page }) => {
  await signIn(page);
  const files: Array<{ id: string; filename: string; content_type: string; size_bytes: number; mine: boolean; created_at: string }> = [];
  let uploadType = '';
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string, status = 200) => route.fulfill({ status, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'c1', roles: ['client'] }));
    if (path === '/api/v1/me/identity') return reply(ok({ roles: ['client', 'freelancer'], client_side_enabled: true, organizations: [{ id: 'o1', name: 'Acme Studio', membership_role: 'owner', kind: 'company' }] }));
    if (path === '/api/v1/project-categories') return reply(ok([]));
    if (path === '/api/v1/organizations/o1/listings') {
      return reply(ok([{ id: 'L1', status: 'published', visibility: 'public', moderation_status: 'approved', current_version: 1, published_at: '2026-11-18T00:00:00Z', closes_at: null,
        brief: { title: 'Candle shop website', category_slug: 'website_development', outcome: 'Sell candles', description: '', deliverables: [], skills: [], experience_level: 'any', budget_model: 'fixed', budget_min_minor: null, budget_max_minor: null, currency: 'INR', deadline: null, milestones: [], acceptance_criteria: [], revision_rounds: 2, languages: ['en'], timezone: '', confidentiality: 'standard', ownership_notes: '', assumptions: [], visibility: 'public' } }]));
    }
    if (path === '/api/v1/listings/L1/files' && request.method() === 'POST') {
      uploadType = request.headers()['content-type'] ?? '';
      files.push({ id: 'F1', filename: 'moodboard.pdf', content_type: 'application/pdf', size_bytes: 2048, mine: true, created_at: '2026-11-18T06:00:00Z' });
      return reply(ok(files[0], 'File added to the project'), 201);
    }
    if (path === '/api/v1/listings/L1/files') return reply(ok({ files, uploads_enabled: true, can_manage: true, max_bytes: 10485760, allowed: ['pdf', 'png'] }));
    return reply(JSON.stringify([]));
  });
  await page.goto('/client/projects');
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.getByText('No reference files.')).toBeVisible();
  await page.getByLabel(/Add a reference file/).setInputFiles({ name: 'moodboard.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  await expect(page.getByRole('button', { name: 'moodboard.pdf (2 KB)' })).toBeVisible();
  expect(uploadType).toContain('multipart/form-data');
});
