/**
 * Unit tests for lib/api-client.ts using Node's built-in test runner
 * (no extra dependency). Run from frontend/:  npm run test:unit
 *
 * AUTH_MODE is read when the module loads, so each mode is imported under a
 * distinct URL (?mode=...) after setting NEXT_PUBLIC_AUTH_MODE.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

type Call = { url: string; init: RequestInit };
const calls: Call[] = [];
let nextResponse: () => Response = () => Response.json({ success: true, message: 'ok', data: { a: 1 } });

const storage = new Map<string, string>();
Object.assign(globalThis, {
  window: {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    },
  },
  document: { cookie: '' },
  fetch: async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return nextResponse();
  },
});

type Client = typeof import('./api-client.ts');

async function load(mode: 'cookie' | 'bearer'): Promise<Client> {
  process.env.NEXT_PUBLIC_AUTH_MODE = mode;
  process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test';
  return (await import(`./api-client.ts?mode=${mode}`)) as Client;
}

function header(call: Call, name: string): string | null {
  return new Headers(call.init.headers).get(name);
}

function reset(): void {
  calls.length = 0;
  storage.clear();
  (globalThis as unknown as { document: { cookie: string } }).document.cookie = '';
  nextResponse = () => Response.json({ success: true, message: 'ok', data: { a: 1 } });
}

test('bearer mode keeps today behaviour: stored token sent as Authorization', async () => {
  reset();
  const client = await load('bearer');
  storage.set('fia_token', 'stored-jwt');
  assert.equal(client.API_BASE, 'https://api.example.test');
  await client.authFetch(`${client.API_BASE}/api/v1/profile`);
  assert.equal(header(calls[0], 'Authorization'), 'Bearer stored-jwt');
  assert.equal(calls[0].init.credentials, 'omit');
});

test('bearer mode respects a header the page already set', async () => {
  reset();
  const client = await load('bearer');
  storage.set('fia_token', 'stored-jwt');
  await client.authFetch('https://api.example.test/api/v1/x', { headers: { Authorization: 'Bearer page-jwt' } });
  assert.equal(header(calls[0], 'Authorization'), 'Bearer page-jwt');
});

test('cookie mode never sends a bearer token and calls the same-origin proxy', async () => {
  reset();
  const client = await load('cookie');
  storage.set('fia_token', 'old-jwt-from-previous-build');
  assert.equal(client.API_BASE, '');
  await client.authFetch(`${client.API_BASE}/api/v1/profile`, { headers: { Authorization: 'Bearer cookie-session' } });
  assert.equal(calls[0].url, '/api/v1/profile');
  assert.equal(header(calls[0], 'Authorization'), null);
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.equal(header(calls[0], 'X-CSRF-Token'), null, 'GET needs no CSRF header');
});

test('cookie mode adds the CSRF header to unsafe methods and opts login into cookies', async () => {
  reset();
  const client = await load('cookie');
  (globalThis as unknown as { document: { cookie: string } }).document.cookie = 'other=1; __Host-fia_csrf=csrf-value-123';
  await client.authFetch('/api/v1/proposals', { method: 'post' });
  assert.equal(header(calls[0], 'X-CSRF-Token'), 'csrf-value-123');
  assert.equal(header(calls[0], 'X-Session-Mode'), null);

  await client.authFetch('/api/v1/auth/login', { method: 'POST' });
  assert.equal(header(calls[1], 'X-Session-Mode'), 'cookie');
});

test('sessionFromAuthResponse handles bearer, cookie and failed responses', async () => {
  const client = await load('cookie');
  assert.equal(client.sessionFromAuthResponse({ access_token: 'jwt' }), 'jwt');
  assert.equal(client.sessionFromAuthResponse({ session_mode: 'cookie' }), client.COOKIE_SESSION);
  assert.equal(client.sessionFromAuthResponse({}), '');
  assert.equal(client.sessionFromAuthResponse(null), '');
});

test('api() unwraps the Edge envelope and raises ApiError with the error code', async () => {
  reset();
  const client = await load('bearer');
  assert.deepEqual(await client.api('/api/v1/x'), { message: 'ok', a: 1 });

  nextResponse = () => Response.json({ success: true, message: 'list', data: [1, 2] });
  assert.deepEqual(await client.api('/api/v1/list'), [1, 2]);

  nextResponse = () => Response.json({ success: false, message: 'Missing or invalid CSRF token.', data: null, error: { code: 'CSRF_TOKEN_INVALID' } }, { status: 403 });
  await assert.rejects(client.api('/api/v1/x', 'POST', {}), (error: unknown) => {
    const e = error as InstanceType<Client['ApiError']>;
    return e instanceof client.ApiError && e.status === 403 && e.code === 'CSRF_TOKEN_INVALID';
  });

  nextResponse = () => Response.json({ success: false, message: 'Check the highlighted fields.', data: null, error: { code: 'INVALID_ORGANIZATION', details: [{ website: 'Use a full https:// address.' }] } }, { status: 422 });
  await assert.rejects(client.api('/api/v1/organizations', 'POST', {}), (error: unknown) => {
    const e = error as InstanceType<Client['ApiError']>;
    return e.code === 'INVALID_ORGANIZATION' && (e.details[0] as Record<string, string>).website === 'Use a full https:// address.';
  });
});
