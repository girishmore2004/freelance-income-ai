import type { Env, RateLimiterBinding } from "../types";
import { readSessionToken } from "./auth-context";
import { failure } from "./response";

/**
 * Request throttling with Cloudflare's Rate Limiting binding (KNOWN_ISSUES K-03).
 *
 *   AUTH_RATE_LIMITER  anonymous auth endpoints (login, register, MFA verify,
 *                      password reset, verification), keyed by endpoint + client IP.
 *   API_RATE_LIMITER   all other /api/v1 requests, keyed by a hash of the
 *                      session token when present, else by client IP.
 *
 * Limits are configured in wrangler.jsonc ("ratelimits"). They are approximate
 * and per Cloudflare location (Cloudflare documentation): this is abuse
 * throttling, not billing-grade metering. Login lockout and the AI governor
 * still enforce exact limits in the database. If a binding is absent (local
 * development) requests are allowed.
 */

const AUTH_PATHS = new Set([
  "/api/v1/auth/login",
  "/api/v1/auth/register",
  "/api/v1/auth/mfa/verify-login",
  "/api/v1/auth/password-reset/request",
  "/api/v1/auth/password-reset/confirm",
  "/api/v1/auth/verify-email",
  "/api/v1/auth/resend-verification"
]);

const RETRY_AFTER_SECONDS = 60;

async function shortHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() || "unknown";
}

export interface RateDecision {
  limiter: "auth" | "api" | null;
  key: string;
}

/** Which limiter and key apply to this request (null limiter = not limited). */
export async function rateKey(request: Request, env: Env): Promise<RateDecision> {
  const path = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  if (method === "OPTIONS" || !path.startsWith("/api/v1/") || path === "/api/v1/health/database") {
    return { limiter: null, key: "" };
  }
  if (method === "POST" && AUTH_PATHS.has(path)) {
    return { limiter: "auth", key: `auth:${path.slice("/api/v1/auth/".length)}:${clientIp(request)}` };
  }
  if (method === "POST" && path === "/api/v1/support/tickets") {
    // Public form: the strict per-IP limiter, like sign-in.
    return { limiter: "auth", key: `support:${clientIp(request)}` };
  }
  const session = readSessionToken(request, env);
  return { limiter: "api", key: session ? `user:${await shortHash(session.token)}` : `ip:${clientIp(request)}` };
}

/** Returns a 429 response when the caller is over the limit, otherwise null. */
export async function enforceRateLimit(request: Request, env: Env, requestId: string): Promise<Response | null> {
  const decision = await rateKey(request, env);
  if (!decision.limiter) return null;
  const binding: RateLimiterBinding | undefined = decision.limiter === "auth" ? env.AUTH_RATE_LIMITER : env.API_RATE_LIMITER;
  if (!binding) return null;

  let allowed = true;
  try {
    allowed = (await binding.limit({ key: decision.key })).success;
  } catch (error) {
    // Fail open on limiter outages: availability matters more than throttling here.
    console.warn(JSON.stringify({ event: "rate_limit.unavailable", error_message: error instanceof Error ? error.message : "unknown" }));
    return null;
  }
  if (allowed) return null;

  console.warn(JSON.stringify({ event: "rate_limit.exceeded", limiter: decision.limiter, request_id: requestId }));
  const response = failure(
    "RATE_LIMITED",
    decision.limiter === "auth" ? "Too many attempts. Wait a minute and try again." : "Too many requests. Slow down and try again shortly.",
    429,
    requestId
  );
  const headers = new Headers(response.headers);
  headers.set("Retry-After", String(RETRY_AFTER_SECONDS));
  return new Response(response.body, { status: 429, headers });
}
