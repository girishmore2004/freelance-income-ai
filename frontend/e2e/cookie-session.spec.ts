import { test, expect, type Page, type Request, type Route } from '@playwright/test';

/**
 * Cookie-session journey (Progress Report finding 3).
 * Runs only when the dev server is built with NEXT_PUBLIC_AUTH_MODE=cookie
 * (CI step "Run browser regression suite in cookie-session mode").
 *
 * The Edge API is mocked. A real cookie-mode login response carries the token
 * only in Set-Cookie and returns { session_mode: "cookie" } in the body, so the
 * page must never see or store a token.
 */

test.skip(process.env.E2E_AUTH_MODE !== 'cookie', 'Cookie-session mode only');

const apiRequests: Request[] = [];

async function installCookieApiMock(page: Page): Promise<void> {
  let signedIn = false;

  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    apiRequests.push(request);
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');

    if (path === '/api/v1/me') {
      await route.fulfill(
        signedIn
          ? { status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: 'ok', data: { id: 'u1', email: 'e2e@example.test' } }) }
          : { status: 401, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Authentication required', data: null, error: { code: 'AUTHENTICATION_REQUIRED' } }) },
      );
      return;
    }

    if (path === '/api/v1/auth/login') {
      signedIn = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: 'Signed in',
          data: { status: 'authenticated', token_type: 'cookie', session_mode: 'cookie' },
        }),
      });
      return;
    }

    if (path.endsWith('/profile')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ full_name: 'E2E User', bio: '', skills: [], preferred_work_types: [], preferred_industries: [], dealbreakers: [], hourly_rate: 0, minimum_budget: 5000, weekly_hours: 10, timezone: 'Asia/Kolkata' }),
      });
      return;
    }

    if (path.endsWith('/dashboard')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ opportunities: 0, proposals: 0, pending_approvals: 0, paid_revenue: 0, currency: 'INR' }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
}

test('cookie mode signs in without exposing a token to page JavaScript', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  apiRequests.length = 0;

  // A token left behind by an older build must be removed.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('fia_token', 'stale-token-from-old-build');
      sessionStorage.setItem('seeded', '1');
    }
  });

  await installCookieApiMock(page);
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('fia_token'))).toBeNull();

  await page.locator('input[autocomplete="email"]').fill('e2e@example.test');
  await page.locator('input[autocomplete="current-password"]').fill('correct-test-password');

  const login = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/v1/auth/login');
  await page.getByRole('button', { name: 'Login' }).click();
  const loginRequest = await login;

  // Same-origin call through the proxy, opting into cookie sessions.
  expect(new URL(loginRequest.url()).origin).toBe(new URL(page.url()).origin);
  expect(loginRequest.headers()['x-session-mode']).toBe('cookie');

  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();

  // Nothing token-like is stored, and no request carries a bearer token.
  expect(await page.evaluate(() => localStorage.getItem('fia_token'))).toBeNull();
  for (const request of apiRequests) {
    expect(request.headers()['authorization'], request.url()).toBeUndefined();
  }

  expect(pageErrors).toEqual([]);
});

test('cookie mode shows the sign-in prompt on protected pages without a session', async ({ page }) => {
  await installCookieApiMock(page);
  await page.goto('/workspace');
  await expect(page.getByText(/sign in/i).first()).toBeVisible();
});
