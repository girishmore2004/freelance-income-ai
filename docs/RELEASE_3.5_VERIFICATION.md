# Release 3.5 verification record

## Implemented and locally checked

- Added recent usage history to the existing authenticated AI usage endpoint.
- Added a bounded authenticated abuse-event endpoint with per-account summaries.
- Added best-effort persistence of authenticated rate-limit rejections; Redis deduplicates writes per actor/category for 60 seconds.
- No database schema change; no migration required.
- Focused regression tests: 7 passed, 1 skipped.
- Python compilation: run as part of package verification.

## Test environment limitation

The build environment does not have `pgvector` installed. Focused model tests were run with a temporary test-only SQLAlchemy `Vector` type stub outside the project source tree. The Redis integration test was skipped because a live Redis service was not configured. This does not validate PostgreSQL/pgvector behavior or live Redis failure/recovery.

## Not run / not certified

- Full backend integration suite against PostgreSQL + pgvector.
- Live Redis rate-limit and abuse-event integration, including outage/recovery.
- Frontend typecheck/build and Playwright staging journey.
- Dependency audit, k6 load baseline, backup/restore drill, and live deployment.
- Independent security or penetration test.

Do not interpret this report as production certification.
