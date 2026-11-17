import { defineConfig, devices } from '@playwright/test';

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './e2e',

  fullyParallel: true,

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
        // CI tests a production build: no dev-server hot reloads (which
        // detached form inputs mid-test once all pages shared
        // lib/api-client.ts), and it is what actually ships. With
        // output: 'standalone', `next start` only logs a warning and still
        // serves the build (packages/next/src/server/next.ts). Local runs keep
        // the faster dev server.
        command: process.env.CI ? 'npm run build && npm run start -- --port 3000' : 'npm run dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: process.env.CI ? 300_000 : 120_000,

        // Keep mocked API calls on the same origin as the frontend.
        env: {
          NEXT_PUBLIC_API_URL: baseURL,
          // "cookie" runs the suite against HttpOnly cookie sessions.
          NEXT_PUBLIC_AUTH_MODE: process.env.E2E_AUTH_MODE || '',
        },
      },
});
