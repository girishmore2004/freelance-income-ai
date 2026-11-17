/**
 * Shared browser API client (Progress Report finding 3).
 *
 * Replaces the per-page `req()` helpers and `localStorage.fia_token`.
 * In cookie mode (the default once NEXT_PUBLIC_AUTH_MODE=cookie):
 *   - requests go to the same-origin proxy at /api/v1/* ;
 *   - the session lives in an HttpOnly cookie the page cannot read;
 *   - unsafe methods send X-CSRF-Token copied from the readable CSRF cookie;
 *   - login/register/MFA/password-change send X-Session-Mode: cookie so the
 *     API returns the token only as a cookie.
 * In bearer mode (legacy, NEXT_PUBLIC_AUTH_MODE unset or "bearer") the client
 * keeps today's behaviour so pages can migrate one at a time.
 */

export type AuthMode = 'cookie' | 'bearer';

export const AUTH_MODE: AuthMode = process.env.NEXT_PUBLIC_AUTH_MODE === 'cookie' ? 'cookie' : 'bearer';
export const API_BASE = AUTH_MODE === 'cookie' ? '' : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000');

const LEGACY_TOKEN_KEY = 'fia_token';
const CSRF_COOKIE = '__Host-fia_csrf';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const TOKEN_ISSUING = new Set(['/api/v1/auth/login', '/api/v1/auth/register', '/api/v1/auth/mfa/verify-login', '/api/v1/auth/password/change']);

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) {
    super(message);
    this.name = 'ApiError';
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

export type Json = Record<string, unknown>;

/**
 * Calls the API and unwraps the Edge envelope `{success, message, data}`.
 * Arrays are returned as-is; objects get the envelope message merged in,
 * matching the existing page helpers so callers need no changes.
 */
export async function api<T = any>(path: string, method = 'GET', body?: Json | FormData): Promise<T> {
  const upper = method.toUpperCase();
  const headers: Record<string, string> = {};
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';

  if (AUTH_MODE === 'cookie') {
    if (UNSAFE.has(upper)) headers['X-CSRF-Token'] = readCookie(CSRF_COOKIE);
    if (TOKEN_ISSUING.has(path)) headers['X-Session-Mode'] = 'cookie';
  } else {
    const token = legacyToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(API_BASE + path, {
      method: upper,
      headers,
      credentials: AUTH_MODE === 'cookie' ? 'same-origin' : 'omit',
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
