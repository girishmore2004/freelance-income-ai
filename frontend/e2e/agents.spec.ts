import { test, expect, type Route } from '@playwright/test';

/** Phase 6: AI agent catalogue with autonomy and human gates; admin kill switch. */

const ok = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });

test('the agent catalogue shows autonomy, human gates and honest status; an admin can switch an agent off', async ({ page }) => {
  let enabled = true;
  const toggles: unknown[] = [];
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'a1', roles: ['freelancer', 'admin'] }));
    if (path === '/api/v1/agents') {
      return reply(ok([
        { code: 'F4', name: 'Proposal Agent', side: 'freelancer', purpose: 'Drafts proposals from confirmed evidence.', autonomy_ceiling: 'A2', human_gate: 'Hash-bound approval before submission', tools: [], status: 'live', enabled },
        { code: 'P2', name: 'Payment Risk Agent', side: 'platform', purpose: 'Recommends payment tiers.', autonomy_ceiling: 'A1', human_gate: 'Finance approves policy', tools: [], status: 'blocked', enabled: true },
      ]));
    }
    if (path === '/api/v1/me/agent-runs') return reply(ok([{ id: 'r1', agent_code: 'F4', agent_name: 'proposal_agent', status: 'completed', summary: 'Generated model proposal', created_at: '2026-11-17T10:00:00Z' }]));
    if (path === '/api/v1/me/agent-usage') return reply(ok({ agents: { F4: { runs: 3, failed: 1, last_run_at: '2026-11-17T10:00:00Z', ai_calls_today: 2, ai_calls_month: 5 } }, pending_approvals: 1 }));
    if (path === '/api/v1/admin/agents/F4') {
      toggles.push(JSON.parse(request.postData() as string));
      enabled = false;
      return reply(ok({ code: 'F4', enabled: false }, 'Proposal Agent switched off'));
    }
    return reply(JSON.stringify([]));
  });
  await page.goto('/ai-agents');
  await expect(page.getByText('F4 · Proposal Agent')).toBeVisible();
  await expect(page.getByText('Autonomy: A2 (Draft for your review) · Human gate: Hash-bound approval before submission')).toBeVisible();
  // One side at a time: platform agents are listed in the Admin workspace only.
  await expect(page.getByText('Blocked (needs payments)')).toHaveCount(0);
  await expect(page.getByText('Generated model proposal')).toBeVisible();
  await expect(page.getByText('Your use: 3 runs (1 failed) · AI calls 2 today, 5 this month')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open: Draft a proposal from an opportunity' })).toHaveAttribute('href', '/projects?view=external');
  await expect(page.getByRole('region', { name: 'Agent overview' })).toContainText('Drafts waiting for my approval1');
  await page.goto('/ai-agents?view=admin');
  await expect(page.getByText('Blocked (needs payments)')).toBeVisible();
  await page.getByRole('button', { name: 'Switch off' }).click();
  await expect(page.getByText('Proposal Agent switched off')).toBeVisible();
  await expect(page.getByText('Live · switched off')).toBeVisible();
  expect(toggles).toEqual([{ enabled: false }]);
});
