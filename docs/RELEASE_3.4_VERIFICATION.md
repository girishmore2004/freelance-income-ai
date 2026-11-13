# Release 3.4 verification record

## Implemented

- Durable account-scoped AI usage events.
- UTC daily and monthly quotas, configurable through environment variables.
- Usage summary endpoint requiring authentication.
- Quota checks on proposal generation, client email reply drafting and business coach generation.
- PostgreSQL row locking around quota checks to reduce concurrent oversubscription.
- Quota exhaustion event records.
- Alembic migration `0021_ai_usage_quotas`.
- No token/cost fabrication; only character counts are stored.

## Checks completed in this build environment

- Focused usage, rate-limit and production-config tests: **17 passed, 1 skipped**.
- Redis integration test: skipped because `TEST_REDIS_URL` is not configured in this environment.
- Python `compileall` across backend application, tests and migrations: passed.
- Alembic revision graph head: `0021_ai_usage_quotas`.
- The environment did not have `pgvector`; focused tests used a temporary test-only SQLAlchemy `Vector` stub and did not create vector-backed tables. This does not replace CI validation with the real dependency.
- Full backend suite and live PostgreSQL migration: pending CI execution.
- Frontend typecheck/build: pending CI execution.
- Browser journey: pending staging execution.
- Live Redis outage/recovery: pending staging execution.
- Dependency audit: pending CI execution.
- k6 staging baseline and backup/restore drill: pending operator execution.

## Known scope limitations

- Usage accounting currently covers three AI flows, not every embedding, RAG, background worker or agent operation.
- Token counts and monetary costs are not yet reported.
- Abuse event persistence currently records quota exhaustion; request-burst events are logged by the existing rate-limit middleware, not persisted as per-IP rows.
- No email/SMS alerting or admin abuse dashboard is included.
- Tenant isolation still depends on each existing endpoint's user-scoped query; this release adds account-scoped usage tables and tests but is not a comprehensive independent audit of every domain table.
- Full authenticated staging workflow, browser journey, security audit and load test require live staging infrastructure and are not claimed as completed.
