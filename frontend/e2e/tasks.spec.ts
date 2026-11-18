import { test, expect, type Route } from '@playwright/test';

/** U11: contract tasks from the category's stages, the timeline and the handover with client confirmation. */

const ok = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });
const fail = (code: string, message: string, details: unknown[] = []) => JSON.stringify({ success: false, message, data: null, error: { code, message, details } });

async function signIn(page: import('@playwright/test').Page): Promise<void> {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
}

const TERMS = { version: 1, title: 'Cafe website', scope: '', deliverables: [], milestones: [{ title: 'Design', amount_minor: 1_000_000, due_date: '2030-01-10' }], total_minor: 1_000_000, currency: 'INR', revision_rounds: 2, acceptance_criteria: [], ownership_terms: '', content_hash: 'h', proposed_by: 'client', created_at: '2026-11-17T00:00:00Z', client_accepted_at: '2026-11-17T00:00:00Z', freelancer_accepted_at: '2026-11-17T00:00:00Z' };

function contractRoutes(party: 'freelancer' | 'client', status: string) {
  return (path: string) => {
    if (path === '/api/v1/me') return ok({ id: party === 'freelancer' ? 'f1' : 'c1', roles: [party] });
    if (path === '/api/v1/contracts') return ok([{ id: 'K1', status, party, client_name: 'Acme', current_version: 1, activated_at: null, terms: TERMS }]);
    if (path === '/api/v1/contracts/K1') return ok({ id: 'K1', status, party, can_manage: true, client_name: 'Acme', project_title: 'Cafe website', current_version: 1, agreed_version: 1, pending_change: false, agreed_terms: null, activated_at: null, terms: TERMS, versions: [TERMS], allowed_actions: [], funding: { available: false, message: '' } });
    if (path === '/api/v1/contracts/K1/workspace') {
      return ok({ contract_id: 'K1', status, party, can_manage: true, revision_rounds: 2, currency: 'INR', approved_minor: 0, total_minor: 1_000_000, funding_note: '', messages: [],
        activity: [{ actor: 'client', type: 'contract.activated', details: {}, created_at: '2026-11-17T09:00:00Z' }],
        milestones: [{ index: 0, title: 'Design', amount_minor: 1_000_000, due_date: '2030-01-10', state: 'pending', revisions_used: 0, submissions: [] }] });
    }
    return null;
  };
}

test('a freelancer adds the standard task plan, finishes a task and sees the timeline', async ({ page }) => {
  await signIn(page);
  let tasks: Array<Record<string, unknown>> = [];
  const base = contractRoutes('freelancer', 'active');
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string, status = 200) => route.fulfill({ status, contentType: 'application/json', body });
    const known = base(path);
    if (known) return reply(known);
    if (path === '/api/v1/contracts/K1/tasks/plan') {
      tasks = [
        { id: 'T1', title: 'Discovery and sitemap', owner_party: 'freelancer', milestone_index: 0, due_date: '2030-01-10', status: 'todo', source: 'category_plan', position: 0 },
        { id: 'T2', title: 'Design approval', owner_party: 'client', milestone_index: 0, due_date: '2030-01-10', status: 'todo', source: 'category_plan', position: 1 },
      ];
      return reply(ok({ created: 2 }, 'Added 2 tasks'), 201);
    }
    if (path === '/api/v1/contract-tasks/T1') { tasks = tasks.map((t) => (t.id === 'T1' ? { ...t, status: 'done' } : t)); return reply(ok(tasks[0])); }
    if (path === '/api/v1/contracts/K1/tasks') {
      return reply(ok({ available: true, tasks, can_edit: true, stages: ['Discovery and sitemap', 'Design approval'], milestones: [{ index: 0, title: 'Design', due_date: '2030-01-10' }] }));
    }
    return reply(JSON.stringify([]));
  });
  await page.goto('/contracts');
  await page.getByRole('button', { name: 'Open' }).click();
  await page.getByRole('tab', { name: 'Tasks' }).click();
  await page.getByRole('button', { name: 'Add tasks from the standard stages' }).click();
  const list = page.getByRole('list', { name: 'Task list' });
  await expect(list).toContainText('Design approval');
  await expect(list).toContainText('Client');
  await page.getByLabel('Status of Discovery and sitemap').selectOption('done');
  await expect(page.getByText('1 of 2 tasks done')).toBeVisible();
  await page.getByRole('tab', { name: 'Timeline' }).click();
  const timeline = page.getByRole('list', { name: 'Timeline entries' });
  await expect(timeline).toContainText('Contract became active');
  await expect(timeline).toContainText('Milestone 1 due: Design');
  await expect(timeline).toContainText('Task (client): Design approval');
});

test('handover refuses a password and the client confirms receipt', async ({ page }) => {
  await signIn(page);
  const items: Array<Record<string, unknown>> = [];
  let party: 'freelancer' | 'client' = 'freelancer';
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string, status = 200) => route.fulfill({ status, contentType: 'application/json', body });
    const known = contractRoutes(party, 'completed')(path);
    if (known) return reply(known);
    if (path === '/api/v1/contracts/K1/handover' && request.method() === 'POST') {
      const body = JSON.parse(request.postData() as string) as Record<string, string>;
      if (/password/i.test(body.note)) return reply(fail('INVALID_HANDOVER', 'Check the highlighted fields.', [{ note: "Never paste passwords or keys. Invite the client through the service's own sharing or team feature instead." }]), 422);
      items.push({ id: 'H1', kind: body.kind, title: body.title, link: body.link, note: body.note, status: 'pending', created_at: '2026-11-18T00:00:00Z', confirmed_at: null });
      return reply(ok(items[0], 'Added to the handover'), 201);
    }
    if (path === '/api/v1/handover-items/H1/confirm') { items[0] = { ...items[0], status: 'confirmed' }; return reply(ok(items[0], 'Receipt confirmed')); }
    if (path === '/api/v1/contracts/K1/handover') return reply(ok({ available: true, items, can_add: party === 'freelancer', can_confirm: party === 'client' }));
    return reply(JSON.stringify([]));
  });
  await page.goto('/contracts');
  await page.getByRole('button', { name: 'Open' }).click();
  await page.getByRole('tab', { name: 'Handover' }).click();
  await page.getByLabel('Item', { exact: true }).fill('Hosting account');
  await page.getByLabel(/^Note/).fill('password: hunter2');
  await page.getByRole('button', { name: 'Add to handover' }).click();
  await expect(page.getByRole('region', { name: 'Handover' }).getByRole('alert')).toContainText('Never paste passwords');
  await page.getByLabel(/^Note/).fill('Invited Acme as owner from the hosting dashboard.');
  await page.getByRole('button', { name: 'Add to handover' }).click();
  await expect(page.getByRole('list', { name: 'Handover items' })).toContainText('Waiting for the client');

  party = 'client';
  await page.reload();
  await page.getByRole('button', { name: 'Open' }).click();
  await page.getByRole('tab', { name: 'Handover' }).click();
  await page.getByRole('button', { name: 'Confirm receipt' }).click();
  await expect(page.getByText('1 of 1 items confirmed by the client')).toBeVisible();
});
