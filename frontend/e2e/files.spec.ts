import { test, expect, type Route } from '@playwright/test';

/** Contract files: a freelancer uploads a file and delivers a milestone with it attached. */

const ok = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });

async function signIn(page: import('@playwright/test').Page): Promise<void> {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
}

const TERMS = { version: 1, title: 'Cafe website', scope: '', deliverables: [], milestones: [{ title: 'Design', amount_minor: 1_000_000, due_date: null }], total_minor: 1_000_000, currency: 'INR', revision_rounds: 2, acceptance_criteria: [], ownership_terms: '', content_hash: 'h', proposed_by: 'client', created_at: '2026-11-17T00:00:00Z', client_accepted_at: '2026-11-17T00:00:00Z', freelancer_accepted_at: '2026-11-17T00:00:00Z' };

test('a freelancer uploads a file and attaches it to a delivery', async ({ page }) => {
  let files: Array<Record<string, unknown>> = [];
  let delivered: Record<string, unknown> | null = null;
  let uploadContentType = '';
  await signIn(page);
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string, status = 200) => route.fulfill({ status, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'f1', roles: ['freelancer'] }));
    if (path === '/api/v1/contracts') return reply(ok([{ id: 'K1', status: 'active', party: 'freelancer', client_name: 'Acme', current_version: 1, activated_at: null, terms: TERMS }]));
    if (path === '/api/v1/contracts/K1') return reply(ok({ id: 'K1', status: 'active', party: 'freelancer', can_manage: true, client_name: 'Acme', project_title: 'Cafe website', current_version: 1, agreed_version: 1, pending_change: false, agreed_terms: null, activated_at: null, terms: TERMS, versions: [TERMS], allowed_actions: [], funding: { available: false, message: '' } }));
    if (path === '/api/v1/contracts/K1/workspace') {
      return reply(ok({ contract_id: 'K1', status: 'active', party: 'freelancer', can_manage: true, revision_rounds: 2, currency: 'INR', approved_minor: 0, total_minor: 1_000_000, funding_note: '', messages: [], activity: [],
        milestones: [{ index: 0, title: 'Design', amount_minor: 1_000_000, due_date: null, state: delivered ? 'submitted' : 'pending', revisions_used: 0,
          submissions: delivered ? [{ id: 'S1', status: 'submitted', note: String(delivered.note), links: [], submitted_at: '2026-11-18T00:00:00Z', reviewed_at: null, review_note: '', files: [{ id: 'F1', filename: 'design.pdf', size_bytes: 9 }] }] : [] }] }));
    }
    if (path === '/api/v1/contracts/K1/files' && request.method() === 'GET') return reply(ok({ files, uploads_enabled: true, max_bytes: 10 * 1024 * 1024, allowed: ['pdf', 'png'] }));
    if (path === '/api/v1/contracts/K1/files') {
      uploadContentType = request.headers()['content-type'] ?? '';
      files = [{ id: 'F1', filename: 'design.pdf', content_type: 'application/pdf', size_bytes: 9, party: 'freelancer', attached: false, mine: true, created_at: '2026-11-18T00:00:00Z' }];
      return reply(ok(files[0], 'File uploaded'), 201);
    }
    if (path === '/api/v1/contracts/K1/milestones/0/submit') {
      delivered = JSON.parse(request.postData() as string);
      files = files.map((f) => ({ ...f, attached: true }));
      return reply(ok({ milestone: 0, state: 'submitted' }, 'Delivered. The client will review it.'), 201);
    }
    return reply(JSON.stringify([]));
  });
  await page.goto('/contracts');
  await page.getByRole('button', { name: 'Open' }).click();
  await page.getByLabel(/Add a file/).setInputFiles({ name: 'design.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n') });
  await expect(page.getByText('design.pdf uploaded')).toBeVisible();
  expect(uploadContentType).toContain('multipart/form-data');
  await page.getByRole('button', { name: 'Deliver work' }).click();
  await page.getByLabel('What are you delivering?').fill('Homepage and menu designs, see the PDF.');
  await page.getByRole('checkbox', { name: 'design.pdf' }).check();
  await page.getByRole('button', { name: 'Deliver', exact: true }).click();
  await expect(page.getByText('Delivered. The client will review it.')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Delivered files' })).toContainText('design.pdf (9 B)');
  expect(delivered).toEqual({ note: 'Homepage and menu designs, see the PDF.', links: [], file_ids: ['F1'] });
});
