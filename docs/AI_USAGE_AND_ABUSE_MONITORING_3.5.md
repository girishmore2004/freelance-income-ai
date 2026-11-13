# AI usage and abuse monitoring — 3.5

## Account usage

`GET /api/v1/usage/ai` returns the existing daily/monthly quota counters plus up to 20 recent events. Each event contains its operation, provider, input/output character counts, and timestamp. The API intentionally does not infer token counts or monetary cost.

## Abuse events

`GET /api/v1/security/abuse-events?limit=50` returns only the authenticated account's events, bounded to 1–100 rows, plus per-event-type counts for the last 30 days. Current event types include quota exhaustion and authenticated rate-limit violations.

## Rate-limit persistence

When Redis rejects an authenticated actor for exceeding a route-category limit, one `rate_limit_exceeded` event is written per account/category per 60 seconds. Redis `SET NX EX` performs deduplication before a database write. Event details contain only category and path; raw IP addresses and request bodies are never persisted. Anonymous IP-based violations remain in application logs only.

Persistence is best-effort: Redis rate limiting still returns 429 if the abuse-event database write fails. Inspect application logs for persistence failures.

## Security and privacy

Both endpoints are authenticated and user-scoped. The event history is capped to prevent unbounded response sizes. This is an operational signal, not a fraud verdict or automated account suspension system.
