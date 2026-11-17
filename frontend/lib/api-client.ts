import { useCallback, useEffect, useState } from 'react';

/**
 * Shared browser API client (Progress Report finding 3).
 *
 * Replaces the per-page `localStorage.fia_token` handling.
 * In cookie mode (NEXT_PUBLIC_AUTH_MODE=cookie):
 *   - requests go to the same-origin proxy at /api/v1/* ;
 *   - the session lives in an HttpOnly cookie the page cannot read;
 *   - unsafe methods send X-CSRF-Token copied from the readable CSRF cookie;
 *   - login/register/MFA/password-change send X-Session-Mode: cookie so the
 *     API returns the token only as a cookie;
 *   - any token left in localStorage by older builds is deleted.
 * In bearer mode (default until cookie mode is switched on) behaviour matches
 * the previous per-page code: the token is kept in localStorage and sent as
 * `Authorization: Bearer`.
 */

export type AuthMode = 'cookie' | 'bearer';

export const AUTH_MODE: AuthMode = process.env.NEXT_PUBLIC_AUTH_MODE === 'cookie' ? 'cookie' : 'bearer';
export const API_BASE = AUTH_MODE === 'cookie' ? '' : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000');

/**
 * Non-secret value pages hold instead of a token in cookie mode. Pages only
 * test it for truthiness (`if (!token)`); it is never sent anywhere because
 * authFetch drops Authorization headers in cookie mode.
 */
export const COOKIE_SESSION = 'cookie-session';

const LEGACY_TOKEN_KEY = 'fia_token';
const CSRF_COOKIE = '__Host-fia_csrf';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const TOKEN_ISSUING = new Set(['/api/v1/auth/login', '/api/v1/auth/register', '/api/v1/auth/mfa/verify-login', '/api/v1/auth/password/change']);

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function readCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  for (const part of document.cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

/** Legacy bearer token; always empty in cookie mode. */
export function legacyToken(): string {
  if (AUTH_MODE === 'cookie' || typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(LEGACY_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function storeLegacyToken(token: string): void {
  if (AUTH_MODE === 'cookie' || typeof window === 'undefined') return;
  try {
    if (token) window.localStorage.setItem(LEGACY_TOKEN_KEY, token);
    else window.localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    /* storage unavailable: session lasts for this page only */
  }
}

/** Removes any token left in localStorage by older builds. */
export function purgeLegacyToken(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

function pathOf(input: string): string {
  if (input.startsWith('/')) return input.split('?')[0];
  try {
    return new URL(input).pathname;
  } catch {
    return input;
  }
}

/**
 * Drop-in replacement for `fetch` for API calls. Pages may keep building URLs
 * as `${API}/api/v1/...` (API is '' in cookie mode, so the call becomes
 * same-origin) and may keep passing an Authorization header: in cookie mode it
 * is removed and the CSRF/session headers are added instead; in bearer mode
 * the stored token is used when the page did not set one.
 */
export function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  const path = pathOf(input);

  if (AUTH_MODE === 'cookie') {
    headers.delete('Authorization');
    if (UNSAFE.has(method)) headers.set('X-CSRF-Token', readCookie(CSRF_COOKIE));
    if (TOKEN_ISSUING.has(path)) headers.set('X-Session-Mode', 'cookie');
    return fetch(input, { ...init, method, headers, credentials: 'same-origin' });
  }

  const authorization = headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/i.test(authorization)) {
    const token = legacyToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    else headers.delete('Authorization');
  }
  return fetch(input, { ...init, method, headers, credentials: 'omit' });
}

export type Json = Record<string, unknown>;

/**
 * Calls the API and unwraps the Edge envelope `{success, message, data}`.
 * Arrays are returned as-is; objects get the envelope message merged in,
 * matching the existing page helpers so callers need no changes.
 */
export async function api<T = any>(path: string, method = 'GET', body?: Json | FormData): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers: Record<string, string> = {};
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await authFetch(API_BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Network error. Check your connection and try again.', 0, 'NETWORK_ERROR');
  }

  const json = (await response.json().catch(() => ({ detail: 'Invalid server response' }))) as Json;
  if (!response.ok) {
    const error = json.error as { code?: string } | null | undefined;
    const message = String(json.detail || json.message || 'Request failed');
    throw new ApiError(message, response.status, error?.code ?? null);
  }
  if (json && json.success === true && 'data' in json) {
    const data = json.data as unknown;
    return (Array.isArray(data) ? data : { message: json.message, ...((data as Json) || {}) }) as T;
  }
  return json as T;
}

/**
 * What a page should store after a successful login/register/MFA/password
 * change response: the token in bearer mode, the cookie marker in cookie mode.
 */
export function sessionFromAuthResponse(response: { access_token?: unknown; session_mode?: unknown } | null | undefined): string {
  if (!response) return '';
  if (typeof response.access_token === 'string' && response.access_token) return response.access_token;
  return response.session_mode === 'cookie' ? COOKIE_SESSION : '';
}

/** True when the browser currently has a session (cookie mode asks the API). */
export async function hasSession(): Promise<boolean> {
  if (AUTH_MODE === 'bearer') return Boolean(legacyToken());
  try {
    await api('/api/v1/me');
    return true;
  } catch {
    return false;
  }
}

/**
 * Replaces `const [token, setToken] = useState('')` plus the localStorage
 * effect in each page. Returns a truthy value while signed in (the bearer
 * token, or COOKIE_SESSION in cookie mode) and '' otherwise. The setter
 * persists bearer tokens and clears storage on sign-out.
 */
export function useSessionToken(): [string, (value: string | null | undefined) => void] {
  const [token, setTokenState] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (AUTH_MODE === 'bearer') {
      setTokenState(legacyToken());
      return () => {
        cancelled = true;
      };
    }
    purgeLegacyToken();
    void hasSession().then((ok) => {
      if (!cancelled) setTokenState(ok ? COOKIE_SESSION : '');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setToken = useCallback((value: string | null | undefined) => {
    const next = value || '';
    if (AUTH_MODE === 'bearer') storeLegacyToken(next);
    setTokenState(AUTH_MODE === 'cookie' && next ? COOKIE_SESSION : next);
  }, []);

  return [token, setToken];
}
