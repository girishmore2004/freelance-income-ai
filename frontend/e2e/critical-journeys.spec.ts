import { test, expect } from '@playwright/test';

const protectedPages = [
  '/workspace',
  '/agent',
  '/agent-workflows',
  '/coach',
  '/delivery',
  '/analytics',
  '/clients',
];

test('landing page exposes sign-in and account creation', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.getByText('Freelance Income AI', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('login failure is visible and does not create a local session', async ({ page }) => {
  await page.route('**/api/v1/auth/login', async route => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Invalid email or password' }),
    });
  });

  await page.goto('/');
  await page.locator('input[type="email"]').fill('e2e@example.test');
  await page.locator('input[type="password"]').fill('incorrect-password');
  await page.getByRole('button', { name: 'Login' }).click();

  await expect(page.getByText('Invalid email or password')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('fia_token'))).toBeNull();
});

for (const path of protectedPages) {
  test(`${path} safely prompts unauthenticated visitors to sign in`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto(path);
    await expect(page.getByText(/sign in first/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /back to dashboard/i })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
}

test('successful login stores a session and opens the authenticated workspace shell', async ({ page }) => {
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    let payload: unknown = [];
    if (url.pathname.endsWith('/auth/login')) {
      payload = { access_token: 'e2e-session-token', token_type: 'bearer' };
    } else if (url.pathname.endsWith('/profile')) {
      payload = {
        full_name: 'E2E User',
        bio: '',
        skills: [],
        preferred_work_types: [],
        preferred_industries: [],
        dealbreakers: [],
      };
    } else if (url.pathname.endsWith('/dashboard')) {
      payload = {
        opportunities: 0,
        proposals: 0,
        pending_approvals: 0,
        paid_revenue: 0,
        currency: 'INR',
      };
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });

  await page.goto('/');
  await page.locator('input[type="email"]').fill('e2e@example.test');
  await page.locator('input[type="password"]').fill('correct-test-password');
  await page.getByRole('button', { name: 'Login' }).click();

  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('fia_token')))
    .toBe('e2e-session-token');
  await expect(page.getByText('Discover · Evaluate · Draft · Approve · Deliver')).toBeVisible();
});
