# Release 5.8.0 verification report

## Scope

Saved Upwork search CRUD, account isolation, recurrence validation, manual run-now, scheduled discovery runner, and documentation/workflow updates.

## Checks completed in the packaging environment

- Python `compileall` for backend application and tests: passed.
- Focused pytest suite: 60 passed (saved-search schema/model, Upwork API, credential vault, opportunity intelligence, discovery, client business intelligence, payment reconciliation and contract revision tests). Tests used a temporary import-only `pgvector` SQLAlchemy type stub because the environment did not have the pinned `pgvector` package installed.
- Marketplace frontend TSX syntax transpilation: passed using the globally installed TypeScript compiler.
- Full FastAPI import could not be run because `python-jose` was absent from the packaging environment.
- Full Next.js build/typecheck and PostgreSQL migration execution were not run.

## Required verification before production

- Python compile and focused pytest suite.
- Alembic graph has one head: `0029_saved_marketplace_searches`.
- PostgreSQL migration execution on staging.
- API tenant-isolation tests for saved search CRUD.
- Frontend production build and TypeScript typecheck.
- Manual execution of both hourly retention and 15-minute saved-discovery workflows on staging.
- Live Upwork OAuth and GraphQL search using an approved developer application.

## Operational constraints

The scheduled runner is read-only. It does not submit proposals. Upwork listing-content retention is handled by the separate hourly cleanup workflow; keep `UPWORK_CACHE_RETENTION_ENABLED=false` until both jobs have been verified.

This report must be updated with actual CI/staging outputs before declaring the release production-certified.
