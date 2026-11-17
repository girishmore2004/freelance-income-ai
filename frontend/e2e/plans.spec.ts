import { test, expect, type Route } from '@playwright/test';

/** Phase 5: plan, AI usage and credits on the Account page (no purchases). */

const ok = (data: unknown) => JSON.stringify({ success: true, message: 'ok', data, error: null });

test('account shows the plan, AI usage and extra credits, and says purchases are not open', async ({ page }) => {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
  await page.route('**/api/v1/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'u1', email: 'e2e@example.test', roles: ['freelancer'] }));
    if (path === '/api/v1/me/identity') return reply(ok({ roles: ['freelancer'], organizations: [], client_side_enabled: false }));
    if (path === '/api/v1/me/plan') {
      return reply(ok({
        plan: { code: 'free', name: 'Free', price_minor: 0, currency: 'INR', billing_interval: 'month', ai_daily_limit: 20, ai_monthly_limit: 300, features: [] },
        plan_ends_at: null, usage: { today: 3, this_month: 41 }, limits: { daily: 20, monthly: 300 }, credits: 5, purchases_available: false,
      }));
    }
    if (path === '/api/v1/plans') return reply(ok([{ code: 'free', name: 'Free', price_minor: 0, ai_daily_limit: 20, ai_monthly_limit: 300 }, { code: 'pro', name: 'Pro', price_minor: null, ai_daily_limit: 60, ai_monthly_limit: 1200 }]));
    return reply(JSON.stringify([]));
  });
  await page.goto('/account');
  await expect(page.getByText('AI drafts today: 3 of 20 · this month: 41 of 300 · 5 extra AI credits')).toBeVisible();
  await expect(page.getByText('Pro: 60 AI drafts a day, 1200 a month · Price not set yet')).toBeVisible();
  await expect(page.getByText('Paid plans and credit packs open when payments are enabled.')).toBeVisible();
});
