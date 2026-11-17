import { defineConfig, devices } from '@playwright/test';

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './e2e',

  fullyParallel: true,

  // CI runs against the Next.js dev server. All pages share lib/api-client.ts,
  // so compiling one page while another is open triggers a dev-server reload
  // that detaches form inputs mid-test. One worker in CI avoids that race.
  workers: process.env.CI ? 1 : undefined,

  forbidOnly: Boolean(process.env.CI),

  retries: process.env.CI ? 1 : 0,

  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },

  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,

        // Keep mocked API calls on the same origin as the frontend.
        env: {
          NEXT_PUBLIC_API_URL: baseURL,
          // "cookie" runs the suite against HttpOnly cookie sessions.
          NEXT_PUBLIC_AUTH_MODE: process.env.E2E_AUTH_MODE || '',
        },
      },
});
