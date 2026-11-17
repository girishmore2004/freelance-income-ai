import { test, expect, type Route } from '@playwright/test';

/** Phase 8: public pages work without signing in and show only decided values. */

test('public pages are reachable without signing in', async ({ page }) => {
  for (const [path, heading] of [['/how-it-works', 'How it works'], ['/safety', 'Safety'], ['/help', 'Help']]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  }
  await expect(page.getByText('Does the AI send anything for me?')).toBeVisible();
});

test('pricing shows plans and says fees are not decided and payments are not live', async ({ page }) => {
  await page.route('**/api/v1/public/pricing', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: 'Pricing', error: null, data: {
        plans: [{ code: 'free', name: 'Free', description: 'Find work and draft with AI.', price_minor: 0, currency: 'INR', billing_interval: 'month', ai_daily_limit: 20, ai_monthly_limit: 300, features: ['Opportunity discovery'] },
                { code: 'pro', name: 'Pro', description: '', price_minor: null, currency: 'INR', billing_interval: 'month', ai_daily_limit: 60, ai_monthly_limit: 1200, features: [] }],
        fees: { status: 'not_decided' }, payments_live: false, client_marketplace_open: false,
      } }),
    });
  });
  await page.goto('/pricing');
  await expect(page.getByText('20 AI drafts a day, up to 300 a month')).toBeVisible();
  await expect(page.getByText('Price to be announced')).toBeVisible();
  await expect(page.getByText('Marketplace fees have not been set yet. They will be published here before payments open.')).toBeVisible();
  await expect(page.getByText(/no fees are charged today/)).toBeVisible();
});
