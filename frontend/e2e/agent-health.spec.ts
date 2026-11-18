import { test, expect, type Route } from '@playwright/test';

/** U20: the Admin workspace's agent health check (self-tests and an optional live model test). */

const ok = (data: unknown) => JSON.stringify({ success: true, message: 'ok', data, error: null });

test('an admin sees which agents work and can test the AI model', async ({ page }) => {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
  let live = false;
  await page.route('**/api/v1/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'a1', roles: ['freelancer', 'admin'] }));
    if (path === '/api/v1/admin/agents/health') {
      live = url.searchParams.get('live') === '1';
      return reply(ok({
        ai_provider: { configured: true, model: '@cf/meta/llama-3.1-8b-instruct', calls_7d: 12, live_check: live ? { ok: true, ms: 420, detail: 'Model answered: "OK"' } : null },
        items: [
          { code: 'C2', name: 'Match and Shortlist Agent', status: 'live', enabled: true, runs_7d: 5, failed_7d: 0, last_run_at: null, self_test: { ok: true, detail: 'Match score 85 for a full skill match.' }, verdict: 'working' },
          { code: 'F10', name: 'Finance and Cash-Flow Agent', status: 'blocked', enabled: true, runs_7d: 0, failed_7d: 0, last_run_at: null, self_test: null, verdict: 'blocked' },
        ],
        passed: 12, total: 12, note: 'Self-tests run each rules-based agent on fixed examples.',
      }));
    }
    return reply(JSON.stringify([]));
  });
  await page.goto('/ai-agents?view=admin');
  const panel = page.getByRole('region', { name: 'Agent health' });
  await expect(panel).toContainText('Self-tests passed: 12/12');
  await expect(panel.getByRole('row', { name: /C2 · Match and Shortlist Agent/ })).toContainText('✓ Working');
  await expect(panel.getByRole('row', { name: /F10/ })).toContainText('Blocked (needs live payments)');
  await panel.getByRole('button', { name: 'Test the AI model' }).click();
  await expect(panel.getByRole('status')).toContainText('Model test: answered in 420 ms');
  expect(live).toBe(true);
  await expect(page.getByRole('group', { name: 'Workspace' }).getByRole('button', { name: 'Admin' })).toHaveAttribute('aria-pressed', 'true');
});
