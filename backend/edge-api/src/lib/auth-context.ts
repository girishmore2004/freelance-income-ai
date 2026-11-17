import type { Env } from "../types";
import { authenticateAccessToken } from "./session-service";
import type { AuthenticatedSession } from "./session-service";
import { failure } from "./response";

/**
 * One place that decides who is calling (Progress Report finding 3).
 *
 * Two transports are accepted during the migration away from localStorage:
 *
 *  1. Cookie mode (target): an HttpOnly, Secure, SameSite=Lax host-only cookie
 *     `__Host-fia_session` holds the JWT, so page JavaScript can never read it.
 *     Unsafe methods (POST/PUT/PATCH/DELETE) must also send header
 *     `X-CSRF-Token` equal to the readable `__Host-fia_csrf` cookie
 *     (double-submit), and any Origin header must be an allowed origin.
 *  2. Bearer mode (legacy): `Authorization: Bearer <jwt>`. Kept so existing
 *     clients keep working; set AUTH_ALLOW_BEARER=false once the frontend has
 *     fully moved to cookie mode.
 *
 * Cookies only work when the browser sees the API as same-site with the
 * frontend. `*.workers.dev` is on the Public Suffix List, so the frontend
 * Worker must proxy `/api/v1/*` to this Worker (same origin). See
 * freelance-income-ai/docs/project/DEPLOYMENT_RUNBOOK.md, "Cookie sessions".
 */

export const SESSION_COOKIE = "__Host-fia_session";
export const CSRF_COOKIE = "__Host-fia_csrf";
export const CSRF_HEADER = "X-CSRF-Token";
export const SESSION_MODE_HEADER = "X-Session-Mode";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface SessionToken {
  token: string;
  via: "cookie" | "bearer";
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name && !(name in out)) {
      try {
        out[name] = decodeURIComponent(value);
      } catch {
        out[name] = value;
      }
    }
  }
  return out;
}

export function bearerAllowed(env: Env): boolean {
  return String(env.AUTH_ALLOW_BEARER ?? "true").trim().toLowerCase() !== "false";
}

export function readSessionToken(request: Request, env: Env): SessionToken | null {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const cookieToken = cookies[SESSION_COOKIE];
  if (cookieToken) return { token: cookieToken, via: "cookie" };

  if (!bearerAllowed(env)) return null;
  const match = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token ? { token, via: "bearer" } : null;
}

function allowedOrigins(env: Env): string[] {
  return [env.CORS_ORIGINS, env.PUBLIC_APP_URL, env.FRONTEND_URL]
    .flatMap((value) => String(value ?? "").split(","))
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * CSRF check for cookie-authenticated unsafe requests. Returns an error
 * Response, or null when the request may proceed.
 */
export function csrfViolation(request: Request, env: Env, requestId: string): Response | null {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return null;

  const origin = request.headers.get("Origin");
  if (origin) {
    const requestOrigin = new URL(request.url).origin;
    const normalized = origin.replace(/\/+$/, "");
    if (normalized !== requestOrigin && !allowedOrigins(env).includes(normalized)) {
      return failure("CSRF_ORIGIN_REJECTED", "Request origin is not allowed.", 403, requestId);
    }
  }

  const cookie = parseCookies(request.headers.get("Cookie"))[CSRF_COOKIE] ?? "";
  const header = request.headers.get(CSRF_HEADER) ?? "";
  if (cookie.length < 32 || !constantTimeEqual(cookie, header)) {
    return failure("CSRF_TOKEN_INVALID", "Missing or invalid CSRF token. Reload the page and try again.", 403, requestId);
  }
  return null;
}

/** Authenticates the caller, enforcing CSRF for cookie sessions. */
export async function authenticateRequest(
  request: Request,
  env: Env,
  requestId: string
): Promise<AuthenticatedSession | Response> {
  const session = readSessionToken(request, env);
  if (!session) {
    return failure("AUTHENTICATION_REQUIRED", "Authentication required", 401, requestId);
  }
  if (session.via === "cookie") {
    const violation = csrfViolation(request, env, requestId);
    if (violation) return violation;
  }
  const authenticated = await authenticateAccessToken(env, session.token);
  if (!authenticated) {
    return failure(
      "INVALID_OR_EXPIRED_SESSION",
      "Session is invalid, expired or revoked. Please sign in again.",
      401,
      requestId
    );
  }
  return authenticated;
}

/* ------------------------------------------------------------------ */
/* Issuing and clearing cookies                                        */
/* ------------------------------------------------------------------ */

export function newCsrfToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function sessionCookieHeaders(accessToken: string, maxAgeSeconds: number, csrfToken = newCsrfToken()): string[] {
  const maxAge = Math.max(60, Math.floor(maxAgeSeconds));
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(accessToken)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`,
    `${CSRF_COOKIE}=${csrfToken}; Path=/; Max-Age=${maxAge}; Secure; SameSite=Lax`
  ];
}

export function clearedCookieHeaders(): string[] {
  return [
    `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    `${CSRF_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax`
  ];
}

/** Endpoints whose successful JSON response may contain a new access token. */
export const TOKEN_ISSUING_PATHS = new Set([
  "/api/v1/auth/login",
  "/api/v1/auth/register",
  "/api/v1/auth/mfa/verify-login",
  "/api/v1/auth/password/change"
]);

export const SESSION_ENDING_PATHS = new Set([
  "/api/v1/auth/logout",
  "/api/v1/auth/logout-all",
  "/api/v1/auth/mfa/enable",
  "/api/v1/auth/mfa/disable"
]);

function wantsCookieMode(request: Request): boolean {
  return (request.headers.get(SESSION_MODE_HEADER) ?? "").trim().toLowerCase() === "cookie";
}

/**
 * Applies cookie mode to auth responses, centrally, so individual routes stay
 * unchanged. When the client opted in with `X-Session-Mode: cookie`, a token
 * in a successful response is moved into the HttpOnly cookie and removed from
 * the JSON body. Session-ending endpoints always clear the cookies.
 */
export async function applySessionCookies(request: Request, response: Response, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  if (method !== "POST") return response;

  if (SESSION_ENDING_PATHS.has(path) && response.ok) {
    const headers = new Headers(response.headers);
    for (const cookie of clearedCookieHeaders()) headers.append("Set-Cookie", cookie);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  if (!TOKEN_ISSUING_PATHS.has(path) || !response.ok || !wantsCookieMode(request)) return response;

  const text = await response.clone().text();
  let parsed: { data?: Record<string, unknown> | null } & Record<string, unknown>;
  try {
    parsed = JSON.parse(text);
  } catch {
    return response;
  }
  const data = parsed.data;
  const token = data && typeof data.access_token === "string" ? data.access_token : "";
  if (!token || !data) return response;

  const expiresAt = typeof data.expires_at === "string" ? Date.parse(data.expires_at) : NaN;
  const fallbackMinutes = Number(env.ACCESS_TOKEN_EXPIRE_MINUTES ?? "720") || 720;
  const maxAge = Number.isFinite(expiresAt) ? (expiresAt - Date.now()) / 1000 : fallbackMinutes * 60;

  const body = {
    ...parsed,
    data: { ...data, access_token: undefined, token_type: "cookie", session_mode: "cookie" }
  };
  const headers = new Headers(response.headers);
  headers.set("Content-Type", "application/json");
  headers.delete("Content-Length");
  headers.set("Cache-Control", "no-store");
  for (const cookie of sessionCookieHeaders(token, maxAge)) headers.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(body), { status: response.status, statusText: response.statusText, headers });
}
