import { test, expect, type Page, type Route } from '@playwright/test';

/** U9: proposal discussion and interview scheduling, opened from the unified inbox. */

const ok = (data: unknown, message = 'ok') => JSON.stringify({ success: true, message, data, error: null });
const fail = (code: string, message: string, details: unknown[] = []) => JSON.stringify({ success: false, message, data: null, error: { code, message, details } });

async function signIn(page: Page): Promise<void> {
  if (process.env.E2E_AUTH_MODE !== 'cookie') await page.addInitScript(() => localStorage.setItem('fia_token', 'e2e-session-token'));
}

const future = new Date(Date.now() + 3 * 86_400_000).toISOString();

test('a freelancer replies in a proposal thread and accepts the client’s interview time', async ({ page }) => {
  await signIn(page);
  let accepted = false;
  const messages = [{ id: 'M1', from: 'client', mine: false, body: 'Can you start next week?', created_at: '2026-11-18T05:00:00Z' }];
  const posts: Array<{ path: string; body: unknown }> = [];
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string, status = 200) => route.fulfill({ status, contentType: 'application/json', body });
    const payload = request.postData() ? JSON.parse(request.postData() as string) : null;
    if (request.method() === 'POST') posts.push({ path, body: payload });
    if (path === '/api/v1/me') return reply(ok({ id: 'f1', roles: ['freelancer'] }));
    if (path === '/api/v1/inbox') {
      return reply(ok([
        { kind: 'proposal', id: 'P1', title: 'Bakery ordering site', last_message: 'Can you start next week?', last_at: '2026-11-18T05:00:00.000Z', from_other_side: true, href: '/inbox?proposal=P1' },
        { kind: 'contract', id: 'C1', title: 'Salon booking page', last_message: 'Thanks, approved.', last_at: '2026-11-17T05:00:00.000Z', from_other_side: false, href: '/contracts#C1' },
      ]));
    }
    if (path === '/api/v1/listing-proposals/P1/discussion') {
      return reply(ok({
        party: 'freelancer', can_message: true, can_schedule: true, proposal_status: 'shortlisted', note: '', messages,
        interviews: [{ id: 'I1', status: accepted ? 'accepted' : 'proposed', proposed_party: 'client', mine: false, starts_at: future, duration_minutes: 30, mode: 'video', meeting_link: 'https://meet.google.com/abc-defg-hij', agenda: 'Walk through your approach', outcome_note: '', responded_at: null }],
      }));
    }
    if (path === '/api/v1/listing-proposals/P1/messages') {
      if (/@/.test(String(payload?.body))) return reply(fail('MESSAGE_NOT_ALLOWED', 'Keep contact and payment on the platform: remove phone numbers, emails, messaging apps or payment requests.'), 422);
      messages.push({ id: 'M2', from: 'freelancer', mine: true, body: payload.body, created_at: '2026-11-18T06:00:00Z' });
      return reply(ok({ id: 'M2' }, 'Message sent'), 201);
    }
    if (path === '/api/v1/proposal-interviews/I1/respond') { accepted = true; return reply(ok({ id: 'I1', status: 'accepted' }, 'Interview accepted')); }
    return reply(JSON.stringify([]));
  });

  await page.goto('/inbox');
  await expect(page.getByRole('button', { name: 'Waiting for you (1)' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open contract' })).toHaveAttribute('href', '/contracts#C1');
  await page.getByRole('button', { name: 'Open conversation' }).click();
  await expect(page.getByRole('list', { name: 'Messages' })).toContainText('Can you start next week?');

  await page.getByLabel('Message', { exact: true }).fill('Email me at me@example.com');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('alert')).toContainText('Keep contact and payment on the platform');

  await page.getByLabel('Message', { exact: true }).fill('Yes, Monday works.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('list', { name: 'Messages' })).toContainText('Yes, Monday works.');

  await expect(page.getByRole('list', { name: 'Interviews' })).toContainText('Proposed by the client');
  await page.getByRole('button', { name: 'Accept time' }).click();
  await expect(page.getByRole('list', { name: 'Interviews' })).toContainText('Confirmed');
  await expect(page.getByRole('link', { name: 'Join link' })).toHaveAttribute('href', 'https://meet.google.com/abc-defg-hij');
  expect(posts.find((p) => p.path === '/api/v1/proposal-interviews/I1/respond')?.body).toEqual({ response: 'accept' });
});

test('a client proposes an interview time and sees field errors from the server', async ({ page }) => {
  await signIn(page);
  const interviews: unknown[] = [];
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    const reply = (body: string, status = 200) => route.fulfill({ status, contentType: 'application/json', body });
    const payload = request.postData() ? JSON.parse(request.postData() as string) : null;
    if (path === '/api/v1/me') return reply(ok({ id: 'c1', roles: ['client'] }));
    if (path === '/api/v1/inbox') return reply(ok([]));
    if (path === '/api/v1/listing-proposals/P2/discussion') {
      return reply(ok({ party: 'client', can_message: true, can_schedule: true, proposal_status: 'submitted', note: '', messages: [], interviews }));
    }
    if (path === '/api/v1/listing-proposals/P2/interviews') {
      if (payload.meeting_link && !payload.meeting_link.startsWith('https://meet.google.com')) {
        return reply(fail('INVALID_INTERVIEW', 'Check the highlighted fields.', [{ meeting_link: 'Use an https link from Google Meet, Zoom, Microsoft Teams, Whereby or Jitsi.' }]), 422);
      }
      interviews.push({ id: 'I2', status: 'proposed', proposed_party: 'client', mine: true, starts_at: payload.starts_at, duration_minutes: payload.duration_minutes, mode: payload.mode, meeting_link: payload.meeting_link, agenda: payload.agenda, outcome_note: '', responded_at: null });
      return reply(ok(interviews[0], 'Interview proposed'), 201);
    }
    return reply(JSON.stringify([]));
  });

  await page.goto('/inbox?proposal=P2');
  await expect(page.getByText('No conversations yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Propose an interview time' }).click();
  const local = new Date(Date.now() + 2 * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  await page.getByLabel('Date and time (your time zone)').fill(`${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T10:30`);
  await page.getByLabel('Length').selectOption('45');
  await page.getByLabel(/Meeting link/).fill('https://example.com/call');
  await page.getByRole('button', { name: 'Propose time', exact: true }).click();
  await expect(page.getByText('Use an https link from Google Meet')).toBeVisible();
  await page.getByLabel(/Meeting link/).fill('https://meet.google.com/xyz');
  await page.getByRole('button', { name: 'Propose time', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Interviews' })).toContainText('Waiting for the freelancer');
  await expect(page.getByRole('list', { name: 'Interviews' })).toContainText('45 min video');
});
