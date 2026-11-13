# Release 3.3 verification record

## Implemented

- Redis-backed fixed-window API rate limiting, shared across application instances.
- Separate configurable limits for authentication, AI/search and general API request classes.
- Verified JWT subject as the authenticated rate-limit actor; direct client IP fallback for anonymous/invalid-token requests.
- Explicit 429 responses with retry and rate-limit headers.
- Production fail-closed behavior when Redis rate-limit storage is not configured or unavailable; development remains usable without Redis.
- `/ready` dependency probe for database and Redis, while `/health` remains lightweight liveness.
- Production preflight validation for positive, bounded rate-limit configuration.
- Unit tests for rate-limit counter behavior, expiry initialization and policy classification.
- Updated deployment examples and runbooks.
- Version metadata updated to 3.3.0.

## Verification in this package build

- Focused deterministic tests: 26 passed.
- Python `compileall` passed.
- Shell syntax checks passed.
- CI YAML parsed and required jobs were present.
- Production preflight was run with safe CI-like settings.
- Archive CRC and manifest SHA-256 integrity checked before packaging.

## Not claimed

- Redis-backed middleware was not exercised against a live Redis service in this environment.
- `/ready` was not exercised against live PostgreSQL/Redis services.
- The 3.2 tenant-isolation API test still requires the full backend dependency set and PostgreSQL/pgvector; it previously could not be collected here because `pgvector` was unavailable.
- Playwright, full backend integration, frontend build, dependency audit results, k6 staging load test, real backup restore drill and live deployment were not executed here.
- No independent penetration test or production security certification is claimed.

No schema migration is included. External marketplace submissions, client emails, deliverables and financial actions remain human-approved.
