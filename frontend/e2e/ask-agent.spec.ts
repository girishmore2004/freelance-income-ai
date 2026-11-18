import { test, expect, type Route } from '@playwright/test';

/** U15: ask about one agent from its card; the answer is grounded in your records and cited. */

const ok = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });

test('a freelancer asks about the proposal agent and sees the cited records', async ({ page }) => {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
  let asked: unknown = null;
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'f1', roles: ['freelancer'] }));
    if (path === '/api/v1/agents') {
      return reply(ok([{ code: 'F4', name: 'Proposal Agent', side: 'freelancer', purpose: 'Drafts proposals from confirmed evidence.', autonomy_ceiling: 'A2', human_gate: 'Hash-bound approval before submission', tools: [], status: 'live', enabled: true }]));
    }
    if (path === '/api/v1/coach/ask') {
      asked = JSON.parse(request.postData() as string);
      return reply(ok({ answer: 'Two drafts were made this week [agent_run:R1]; one is waiting for your approval.', generation_mode: 'llm_grounded_context',
        citation_validation: { valid: ['agent_run:R1'] },
        sources: [{ id: 'agent:F4', type: 'agent', excerpt: 'F4 Proposal Agent; status=live' }, { id: 'agent_run:R1', type: 'agent_run', excerpt: 'completed; drafted 2 proposals' }] }));
    }
    return reply(JSON.stringify([]));
  });
  await page.goto('/ai-agents');
  await page.getByText('Details and history').click();
  await page.getByLabel('Ask about F4 Proposal Agent').fill('How did you do this week?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByText('one is waiting for your approval')).toBeVisible();
  await expect(page.getByText('it never takes action for you')).toBeVisible();
  expect(asked).toEqual({ question: 'How did you do this week?', agent: 'F4' });
});
