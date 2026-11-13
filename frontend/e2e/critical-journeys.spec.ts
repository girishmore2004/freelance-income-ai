
import { test, expect, type Page, type Route } from '@playwright/test';

const protectedPages = [
  '/workspace',
  '/agent',
  '/agent-workflows',
  '/coach',
  '/delivery',
  '/analytics',
  '/clients',
];

const LOGIN_PATH = '/api/v1/auth/login';

function isLoginRequest(url: string): boolean {
  return new URL(url).pathname.replace(/\/+$/, '') === LOGIN_PATH;
}

/**
 * All API calls are intercepted by Playwright.
 * The frontend uses the same origin for API calls in E2E mode.
 */
async function installApiMock(
  page: Page,
  loginStatus: number,
): Promise<void> {
  await page.route('**/api/v1/**', async (route: Route) => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname.replace(/\/+$/, '');

    if (path === LOGIN_PATH) {
      const successful = loginStatus >= 200 && loginStatus < 300;

      await route.fulfill({
        status: loginStatus,
        contentType: 'application/json',
        body: JSON.stringify(
          successful
            ? {
                access_token: 'e2e-session-token',
                token_type: 'bearer',
              }
            : {
                detail: 'Invalid email or password',
              },
        ),
      });

      return;
    }

    if (path.endsWith('/profile')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          full_name: 'E2E User',
          bio: '',
          skills: [],
          preferred_work_types: [],
          preferred_industries: [],
          dealbreakers: [],
          hourly_rate: 0,
          minimum_budget: 5000,
          weekly_hours: 10,
          timezone: 'Asia/Kolkata',
        }),
      });

      return;
    }

    if (path.endsWith('/dashboard')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          opportunities: 0,
          proposals: 0,
          pending_approvals: 0,
          paid_revenue: 0,
          currency: 'INR',
        }),
      });

      return;
    }

    // Return empty collections for other dashboard API endpoints.
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });
}

async function waitForLoginResponse(
  page: Page,
  expectedStatus: number,
): Promise<void> {
  const responsePromise = page.waitForResponse((response) => {
    return (
      isLoginRequest(response.url()) &&
      response.status() === expectedStatus
    );
  });

  await page.getByRole('button', { name: 'Login' }).click();

  await responsePromise;
}

async function fillLoginForm(
  page: Page,
  password: string,
): Promise<void> {
  await page.locator('input[autocomplete="email"]').fill(
    'e2e@example.test',
  );

  await page
    .locator('input[autocomplete="current-password"]')
    .fill(password);
}

test('landing page exposes sign-in and account creation', async ({
  page,
}) => {
  const pageErrors: string[] = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await page.goto('/');

  await expect(
    page.getByText('Freelance Income AI', { exact: true }),
  ).toBeVisible();

  await expect(
    page.getByRole('button', { name: 'Login' }),
  ).toBeVisible();

  await expect(
    page.getByRole('button', { name: 'Create account' }),
  ).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('login failure is visible and does not create a local session', async ({
  page,
}) => {
  const pageErrors: string[] = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await installApiMock(page, 401);

  await page.goto('/');

  await fillLoginForm(page, 'incorrect-password');

  await waitForLoginResponse(page, 401);

  await expect(
    page.getByText('Invalid email or password', { exact: true }),
  ).toBeVisible();

  const storedToken = await page.evaluate(() =>
    localStorage.getItem('fia_token'),
  );

  expect(storedToken).toBeNull();
  expect(pageErrors).toEqual([]);
});

for (const path of protectedPages) {
  test(`${path} safely prompts unauthenticated visitors to sign in`, async ({
    page,
  }) => {
    const pageErrors: string[] = [];

    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    await page.goto(path);

    await expect(
      page.getByText(/sign in/i).first(),
    ).toBeVisible();

    expect(pageErrors).toEqual([]);
  });
}

test('successful login stores a session and opens the authenticated workspace shell', async ({
  page,
}) => {
  const pageErrors: string[] = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await installApiMock(page, 200);

  await page.goto('/');

  await fillLoginForm(page, 'correct-test-password');

  await waitForLoginResponse(page, 200);

  await expect
    .poll(
      () => page.evaluate(() => localStorage.getItem('fia_token')),
      { timeout: 10000 },
    )
    .toBe('e2e-session-token');

  await expect(
    page.getByRole('button', { name: 'Log out' }),
  ).toBeVisible();

  await expect(
    page.getByText(
      'Discover · Evaluate · Draft · Approve · Deliver',
    ),
  ).toBeVisible();

  expect(pageErrors).toEqual([]);
});
