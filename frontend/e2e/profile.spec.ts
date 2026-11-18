import { test, expect, type Route } from '@playwright/test';

/** U17: profile has its own page; resume import fills the form only after ticking; projects and "Projects for you". */

const ok = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });

async function signIn(page: import('@playwright/test').Page): Promise<void> {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
}

const PROFILE = { full_name: 'Ravi', headline: '', bio: '', skills: ['React'], services: [], portfolio_links: [], minimum_budget: 5000, currency: 'INR', weekly_hours: 20, hourly_rate: 1000, timezone: 'Asia/Kolkata', preferred_work_types: ['fixed'], preferred_industries: [], dealbreakers: [] };

test('a freelancer imports a resume, keeps only the ticked items and saves', async ({ page }) => {
  await signIn(page);
  let savedProfile: Record<string, unknown> | null = null;
  let savedProjects: unknown = null;
  let extractCalls = 0;
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string, status = 200) => route.fulfill({ status, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'f1', roles: ['freelancer'] }));
    if (path === '/api/v1/profile' && request.method() === 'PUT') { savedProfile = JSON.parse(request.postData() as string); return reply(ok(savedProfile, 'Profile saved')); }
    if (path === '/api/v1/profile') return reply(ok(PROFILE));
    if (path === '/api/v1/me/portfolio-projects' && request.method() === 'PUT') {
      savedProjects = JSON.parse(request.postData() as string).items;
      return reply(ok({ available: true, items: savedProjects }));
    }
    if (path === '/api/v1/me/portfolio-projects') return reply(ok({ available: true, items: [] }));
    if (path === '/api/v1/me/suggested-projects') {
      return reply(ok({ native: [{ id: 'L1', title: 'Bakery ordering website', client_name: 'Acme', score: 82, reasons: ['Has 2 of 2 requested skills: Next.js, Stripe'], missing_skills: [] }], external: [{ id: 'O1', title: 'React dashboard', source: 'remotive', score: 64, reasons: ['Matches your skills: React'] }], note: '' }));
    }
    if (path === '/api/v1/profile/resume-extract') {
      extractCalls += 1;
      return reply(ok({ mode: 'model', source: 'text', characters: 300, saved: false, note: '', dropped: ['skill "Kubernetes" is not in the resume'], suggestions: {
        headline: 'Next.js developer', summary: 'Builds ordering sites for small shops.', skills: ['Next.js', 'Stripe', 'Excel'], services: ['Online stores'],
        projects: [{ title: 'Bakery ordering website', description: 'Built ordering and payments.', skills: ['Next.js'], link: 'https://bakery.example.com/', year: '2024' }],
        links: ['https://bakery.example.com/'],
      } }));
    }
    return reply(JSON.stringify([]));
  });

  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();
  await expect(page.getByLabel('Full name')).toHaveValue('Ravi');

  // Projects for you, scored.
  const forYou = page.getByRole('region', { name: 'Projects for you' });
  await expect(forYou).toContainText('Bakery ordering website');
  await expect(forYou).toContainText('82/100 · Strong match');
  await expect(forYou.getByRole('link', { name: 'Open project' })).toHaveAttribute('href', '/projects?project=L1');
  await expect(forYou).toContainText('64/100 · Good match');

  // Too short to read.
  const importer = page.getByRole('region', { name: 'Import from resume' });
  await importer.getByRole('button', { name: 'Read resume' }).click();
  await expect(importer.getByRole('alert')).toContainText('paste at least a few lines');
  expect(extractCalls).toBe(0);

  await page.getByLabel('Or paste your resume').fill('Next.js developer. Built a bakery ordering website with Next.js and Stripe in 2024. https://bakery.example.com');
  await importer.getByRole('button', { name: 'Read resume' }).click();
  const suggestions = page.getByRole('group', { name: 'Resume suggestions' });
  await expect(suggestions).toContainText('Headline: Next.js developer');
  await expect(suggestions).toContainText('1 suggestion(s) removed');
  // Nothing saved yet.
  expect(savedProfile).toBeNull();

  await suggestions.getByLabel('Excel').uncheck();
  await suggestions.getByRole('button', { name: 'Add ticked items to the form' }).click();
  await expect(page.getByRole('status')).toContainText('Check them, then press Save profile');
  await expect(page.getByLabel('Headline (your role in one line)')).toHaveValue('Next.js developer');
  await expect(page.getByLabel('Skills (comma separated)')).toHaveValue('React, Next.js, Stripe');
  await expect(page.getByLabel('Title')).toHaveValue('Bakery ordering website');
  expect(savedProfile).toBeNull();

  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status')).toContainText('Profile saved.');
  expect(savedProfile!.skills).toEqual(['React', 'Next.js', 'Stripe']);
  expect(savedProfile!.headline).toBe('Next.js developer');
  expect(savedProfile!.portfolio_links).toEqual(['https://bakery.example.com/']);
  expect(savedProjects).toEqual([{ title: 'Bakery ordering website', description: 'Built ordering and payments.', skills: ['Next.js'], link: 'https://bakery.example.com/', year: '2024' }]);

  // Manual project editing.
  await page.getByRole('button', { name: 'Add a project' }).click();
  await page.locator('#pj-title-1').fill('Inventory dashboard');
  await page.getByRole('button', { name: 'Save projects' }).click();
  await expect(page.getByRole('status')).toContainText('Projects saved.');
  expect((savedProjects as Array<{ title: string }>).map((p) => p.title)).toEqual(['Bakery ordering website', 'Inventory dashboard']);
});

test('the sidebar has its own Profile entry', async ({ page }) => {
  await signIn(page);
  await page.route('**/api/v1/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'f1', roles: ['freelancer'] }));
    if (path === '/api/v1/profile') return reply(ok(PROFILE));
    if (path === '/api/v1/me/portfolio-projects') return reply(ok({ available: true, items: [] }));
    if (path === '/api/v1/me/suggested-projects') return reply(ok({ native: [], external: [], note: 'No matches yet.' }));
    return reply(JSON.stringify([]));
  });
  await page.goto('/profile');
  const link = page.getByRole('link', { name: 'My profile and resume' });
  await expect(link).toHaveAttribute('href', '/profile');
  await expect(link).toHaveAttribute('aria-current', 'page');
});
