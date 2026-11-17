import { test, expect, type Route } from '@playwright/test';

/** In-app notifications: unread badge, inbox, mark all as read. */

const ok = (data: unknown) => JSON.stringify({ success: true, message: 'ok', data, error: null });

test('the inbox lists notifications and marks them read', async ({ page }) => {
  let read = false;
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string) => route.fulfill({ status: 200, contentType: 'application/json', body });
    if (path === '/api/v1/me') return reply(ok({ id: 'f1', roles: ['freelancer'] }));
    if (path === '/api/v1/notifications/unread-count') return reply(ok({ unread: read ? 0 : 2 }));
    if (path === '/api/v1/notifications/read') { read = true; return reply(ok({ marked: 2 })); }
    if (path === '/api/v1/notifications') {
      return reply(ok([
        { id: 'n1', title: 'You received an offer: Cafe website', message: 'You received an offer', kind: 'offer.sent', link: '/contracts#K1', read, created_at: '2026-11-17T10:00:00Z' },
        { id: 'n2', title: 'Payment released to you', message: 'Payment released to you', kind: 'milestone.released', link: '/earnings', read, created_at: '2026-11-17T11:00:00Z' },
      ]));
    }
    return reply(JSON.stringify([]));
  });
  await page.goto('/notifications');
  await expect(page.getByText('● You received an offer: Cafe website')).toBeVisible();
  await page.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(page.getByText('● Payment released to you')).toHaveCount(0);
  await expect(page.getByText('Payment released to you').first()).toBeVisible();
});
