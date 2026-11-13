# Upgrade 4.3.0 → 4.4.0

## Summary
Incremental reliability and release-evidence upgrade. Existing FastAPI, Next.js, PostgreSQL, Redis/RQ and LangGraph architecture is preserved. No schema migration or new production dependency is introduced.

## Changes
- Add a Redis/RQ integration regression that cancels a queued workflow and verifies a worker pickup is a no-op: status remains cancelled and attempt_count remains zero.
- Add a stale-worker fencing unit test proving a superseded attempt cannot write a durable checkpoint.
- Extend GitHub Actions dependency audit to retain Python and npm JSON reports as a 30-day artifact, including when npm audit finds vulnerabilities.
- Pin the Playwright test dependency to an exact version rather than a floating patch range.
- Update release metadata and operational documentation.

## Upgrade steps
1. Back up the repository and database.
2. Merge/extract this release over the existing repository while preserving `.git`, `.env` and deployment configuration.
3. No Alembic migration or new production environment variable is required.
4. Push to GitHub and wait for all CI jobs. The new Redis cancellation test requires the configured Redis service.
5. If dependency audit fails, download the `dependency-audit-reports` artifact and review findings before upgrading dependencies. Do not blindly apply major-version updates.
6. Continue to perform staging load testing and disposable-database restore drills using the v4.3 runbooks.

## Safety
The new worker tests use only test records and a test Redis service. They do not invoke AI providers, send email, submit proposals, hand over files or process payments.
