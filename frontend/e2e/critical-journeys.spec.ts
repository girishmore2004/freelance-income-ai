
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

const API_LOGIN_PATH = '/api/v1/auth/login';

function normalizedPath(url: URL): string {
  return url.pathname.replace(/\/+$/, '');
}

async function mockLoginFailure(page: Page): Promise<void> {
  await page.route(
    (url) => normalizedPath(url) === API_LOGIN_PATH,
    async (route: Route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: 'Invalid email or password',
        }),
      });
    }
  );
}

async function mockSuccessfulApi(page: Page): Promise<void> {
  await page.route(
    (url) => normalizedPath(url).startsWith('/api/v1/'),
    async (route: Route) => {
      const path = normalizedPath(new URL(route.request().url()));

      let payload: unknown = [];

      if (path === API_LOGIN_PATH) {
        payload = {
          access_token: 'e2e-session-token',
          token_type: 'bearer',
        };
      } else if (path === '/api/v1/profile') {
        payload = {
          full_name: 'E2E User',
          bio: '',
          skills: [],
          preferred_work_types: [],
          preferred_industries: [],
          dealbreakers: [],
        };
      } else if (path === '/api/v1/dashboard') {
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
    }
  );
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
  await mockLoginFailure(page);

  await page.goto('/');

  await fillLoginForm(page, 'incorrect-password');

  const loginResponsePromise = page.waitForResponse((response) => {
    return normalizedPath(new URL(response.url())) === API_LOGIN_PATH;
  });

  await page.getByRole('button', { name: 'Login' }).click();

  const loginResponse = await loginResponsePromise;

  expect(loginResponse.status()).toBe(401);

  await expect(
    page.getByText('Invalid email or password', { exact: true })
  ).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem('fia_token'))
    )
    .toBeNull();
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

  await mockSuccessfulApi(page);

  await page.goto('/');

  await fillLoginForm(page, 'correct-test-password');

  const loginResponsePromise = page.waitForResponse((response) => {
    return normalizedPath(new URL(response.url())) === API_LOGIN_PATH;
  });

  await page.getByRole('button', { name: 'Login' }).click();

  const loginResponse = await loginResponsePromise;

  expect(loginResponse.status()).toBe(200);

  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem('fia_token'))
    )
    .toBe('e2e-session-token');

  await expect(
    page.getByRole('button', { name: 'Log out' })
  ).toBeVisible();

  await expect(
    page.getByText(
      'Discover · Evaluate · Draft · Approve · Deliver'
    )
  ).toBeVisible();

  expect(pageErrors).toEqual([]);
});
