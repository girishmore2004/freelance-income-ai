
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

function isApiRequest(url: URL): boolean {
  return url.pathname.includes('/api/v1/');
}

function isLoginRequest(url: URL): boolean {
  return url.pathname.replace(/\/+$/, '').endsWith(LOGIN_PATH);
}

/**
 * Intercepts API calls independently of the API hostname.
 * This supports localhost, deployed API domains, and URL prefixes.
 */
async function installApiMock(
  page: Page,
  loginStatus: number,
  loginPayload: Record<string, unknown>
): Promise<{ getLoginRequestCount: () => number }> {
  let loginRequestCount = 0;

  await page.route('**/*', async (route: Route) => {
    const requestUrl = new URL(route.request().url());

    if (!isApiRequest(requestUrl)) {
      await route.continue();
      return;
    }

    if (isLoginRequest(requestUrl)) {
      loginRequestCount += 1;

      await route.fulfill({
        status: loginStatus,
        contentType: 'application/json',
        body: JSON.stringify(loginPayload),
      });

      return;
    }

    let payload: unknown = [];

    if (requestUrl.pathname.endsWith('/profile')) {
      payload = {
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
      };
    } else if (requestUrl.pathname.endsWith('/dashboard')) {
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

  return {
    getLoginRequestCount: () => loginRequestCount,
  };
}

async function fillLoginForm(
  page: Page,
  password: string
): Promise<void> {
  await page.locator('input[autocomplete="email"]').fill(
    'e2e@example.test'
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
    page.getByText('Freelance Income AI', { exact: true })
  ).toBeVisible();

  await expect(
    page.getByRole('button', { name: 'Login' })
  ).toBeVisible();

  await expect(
    page.getByRole('button', { name: 'Create account' })
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

  const mock = await installApiMock(page, 401, {
    detail: 'Invalid email or password',
  });

  await page.goto('/');

  await fillLoginForm(page, 'incorrect-password');

  await page.getByRole('button', { name: 'Login' }).click();

  // Verify that the application actually sent the login request.
  await expect
    .poll(() => mock.getLoginRequestCount(), {
      message: 'The login button should send exactly one login request',
      timeout: 10000,
    })
    .toBe(1);

  await expect(
    page.getByText('Invalid email or password', { exact: true })
  ).toBeVisible();

  expect(
    await page.evaluate(() => localStorage.getItem('fia_token'))
  ).toBeNull();

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
      page.getByText(/sign in/i).first()
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

  const mock = await installApiMock(page, 200, {
    access_token: 'e2e-session-token',
    token_type: 'bearer',
  });

  await page.goto('/');

  await fillLoginForm(page, 'correct-test-password');

  await page.getByRole('button', { name: 'Login' }).click();

  await expect
    .poll(() => mock.getLoginRequestCount(), {
      message: 'The login button should send exactly one login request',
      timeout: 10000,
    })
    .toBe(1);

  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem('fia_token'))
    )
    .toBe('e2e-session-token');

  await expect(
    page.getByRole('button', { name: 'Log out' })
  ).toBeVisible();

  await expect(
    page.getByText('Discover · Evaluate · Draft · Approve · Deliver')
  ).toBeVisible();

  expect(pageErrors).toEqual([]);
});
