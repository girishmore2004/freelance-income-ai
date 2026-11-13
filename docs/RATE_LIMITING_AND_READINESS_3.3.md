# API rate limiting and readiness (3.3)

## Rate limits

Release 3.3 adds fixed-window, Redis-backed rate limits. Authenticated requests are grouped by verified JWT subject; unauthenticated requests are grouped by the direct ASGI client IP. Forwarded IP headers are intentionally not trusted by default.

Default limits per actor:
- General API: `RATE_LIMIT_API_PER_MINUTE=120`
- Login and registration: `RATE_LIMIT_AUTH_PER_MINUTE=10`
- AI/search/coach endpoints: `RATE_LIMIT_AI_PER_MINUTE=30`

All windows are 60 seconds. A 429 response includes `Retry-After`, `X-RateLimit-Limit`, and `X-RateLimit-Remaining` where applicable. Limits are shared across application instances because counters live in Redis.

Set the values in Render environment variables or `.env`. Values must be integers from 1 through 100000. Start with conservative limits, inspect real traffic and 429 logs, then adjust deliberately. These are per-actor controls, not a substitute for account-level business quotas, bot detection, WAF rules or provider-side protections.

Production behavior is fail-closed: if Redis is not configured or rate-limit storage is unavailable, API requests receive HTTP 503 rather than silently bypassing the limit. Development can continue without Redis. Ensure the production Redis service is reachable before deploying.

## Health versus readiness

- `GET /health` is a lightweight liveness check. It does not contact dependencies.
- `GET /ready` checks database connectivity and, when configured, Redis connectivity. Production requires both checks to pass and returns HTTP 503 otherwise.

Use `/health` for platform liveness and `/ready` for deployment/readiness probes. Do not expose internal connection strings or exception details through these endpoints.

## Operational notes

Redis counters expire automatically after the fixed window. Restarting an API process does not reset shared counters. If Redis is flushed or replaced, active counters are lost; monitor Redis availability and protect the service with authentication and network restrictions.
