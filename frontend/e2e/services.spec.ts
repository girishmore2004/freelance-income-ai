import { test, expect, type Route } from '@playwright/test';

/** U18: Fiverr-style services — a freelancer publishes packages, a client orders one and gets a contract. */

const ok = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });
const fail = (code: string, message: string, details: unknown[] = []) => JSON.stringify({ success: false, message, data: null, error: { code, details } });

async function signIn(page: import('@playwright/test').Page): Promise<void> {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
}

const PKG = (key: string, name: string, price: number, days: number) => ({ key, name, description: '', price_minor: price, delivery_days: days, revisions: 1, deliverables: ['2 logo concepts', 'PNG and SVG files'] });
const SERVICE = {
  id: 'S1', title: 'I will design a logo for your bakery', category_slug: 'graphic_design', skills: ['Illustrator'], currency: 'INR', from_price_minor: 150000, fastest_delivery_days: 3,
  packages: [PKG('basic', 'Basic', 150000, 3), PKG('standard', 'Standard', 300000, 5)], published_at: '2026-11-18T00:00:00Z', mine: false,
  freelancer: { user_id: 'f2', display_name: 'Meera', headline: 'Brand designer', verified: true, rating: { average: 4.8, count: 6 }, newcomer: false },
};
const CATS = [{ slug: 'website_development', name: 'Website development' }, { slug: 'graphic_design', name: 'Graphic design' }];

test('a client finds a service, chooses a package and orders it', async ({ page }) => {
  await signIn(page);
  let order: Record<string, unknown> | null = null;
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string, status = 200) => route.fulfill({ status, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'c1', roles: ['client'] }));
    if (path === '/api/v1/project-categories') return reply(ok(CATS));
    if (path === '/api/v1/services') return reply(ok({ items: [SERVICE], next_before: null }));
    if (path === '/api/v1/services/S1') return reply(ok({ ...SERVICE, description: 'Clean logos for food businesses.', requirements: 'Your business name and colours.', completed_orders: 4, status: 'published' }));
    if (path === '/api/v1/organizations') return reply(ok([{ id: 'o1', name: 'Sweet Crumbs', membership_role: 'owner', status: 'active' }]));
    if (path === '/api/v1/finance/fee-quote') return reply(ok({ client_fee_minor: 15000, freelancer_fee_minor: 9000, client_pays_minor: 315000, freelancer_receives_minor: 291000, platform_fee_minor: 24000 }));
    if (path === '/api/v1/services/S1/order') {
      order = JSON.parse(request.postData() as string);
      if (!String(order!.requirements ?? '').trim()) return reply(fail('INVALID_ORDER', 'Check the highlighted fields.', [{ requirements: "Answer the freelancer's questions so they can start." }]), 422);
      return reply(ok({ order_id: 'SO1', contract_id: 'K9', status: 'offered', total_minor: 300000 }, 'Order placed'), 201);
    }
    return reply(JSON.stringify([]));
  });

  await page.goto('/services');
  const list = page.getByRole('list', { name: 'Services' });
  await expect(list).toContainText('I will design a logo for your bakery');
  await expect(list).toContainText('From ₹1,500');
  await expect(list).toContainText('★ 4.8 (6)');
  await list.getByRole('button', { name: 'View I will design a logo for your bakery' }).click();

  const detail = page.getByRole('region', { name: 'Service' });
  await expect(detail).toContainText('4 completed orders');
  await expect(detail).toContainText('The freelancer asks: Your business name and colours.');
  await detail.getByRole('radio', { name: /Standard/ }).check();
  await expect(detail.getByRole('button', { name: 'Order for ₹3,000' })).toBeVisible();

  await detail.getByRole('button', { name: 'Order for ₹3,000' }).click();
  await expect(detail.getByRole('alert')).toContainText('Check the highlighted fields.');
  await expect(detail).toContainText("Answer the freelancer's questions");

  await page.getByLabel(/What you need/).fill('Sweet Crumbs bakery, brown and cream.');
  await detail.getByRole('button', { name: 'Order for ₹3,000' }).click();
  await expect(page.getByRole('status')).toContainText('Order placed');
  await expect(page.getByRole('link', { name: 'Open the contract' })).toHaveAttribute('href', '/contracts#K9');
  expect(order).toEqual({ organization_id: 'o1', package: 'standard', requirements: 'Sweet Crumbs bakery, brown and cream.' });
});

test('a freelancer creates a service with two packages and publishes it', async ({ page }) => {
  await signIn(page);
  const mine: Array<Record<string, unknown>> = [];
  let created: Record<string, unknown> | null = null;
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string, status = 200) => route.fulfill({ status, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'f2', roles: ['freelancer'] }));
    if (path === '/api/v1/project-categories') return reply(ok(CATS));
    if (path === '/api/v1/me/services' && request.method() === 'POST') {
      created = JSON.parse(request.postData() as string);
      const s = { ...SERVICE, id: 'S2', ...created!, status: 'draft', from_price_minor: 150000, orders: 0, open_orders: 0, moderation_note: '' };
      mine.push(s);
      return reply(ok(s, 'Draft saved'), 201);
    }
    if (path === '/api/v1/me/services') return reply(ok({ items: mine, max: 20, can_sell: true }));
    if (path === '/api/v1/services/S2/transition') { mine[0] = { ...mine[0], status: 'published' }; return reply(ok(mine[0], 'Published')); }
    return reply(JSON.stringify([]));
  });

  await page.goto('/services?view=mine');
  const section = page.getByRole('region', { name: 'My services' });
  await expect(section).toContainText('You have no services yet');
  await section.getByRole('button', { name: 'New service' }).click();

  const form = page.getByRole('form', { name: 'New service' });
  await form.getByLabel('Title').fill('I will design a logo for your bakery');
  await form.getByLabel('Category').selectOption('graphic_design');
  await form.getByLabel(/What you do/).fill('Clean, modern logos for food businesses, with source files.');
  await form.getByLabel('Basic price (₹)').fill('1500');
  await form.getByLabel('Basic deliverables (one per line)').fill('2 logo concepts\nPNG and SVG files');
  await form.getByLabel('Offer Standard').check();
  await form.getByLabel('Standard price (₹)').fill('3,000');
  await form.getByLabel('Standard deliverables (one per line)').fill('4 logo concepts\nSource files');
  await form.getByRole('button', { name: 'Save service' }).click();

  await expect(page.getByRole('status')).toContainText('Draft saved');
  expect((created!.packages as Array<{ key: string; price_minor: number }>).map((p) => [p.key, p.price_minor])).toEqual([['basic', 150000], ['standard', 300000]]);
  await section.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('status')).toContainText('Live: clients can find and order it.');
  await expect(section).toContainText('Live');
});
