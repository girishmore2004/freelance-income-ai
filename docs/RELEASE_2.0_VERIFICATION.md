# Release 2.0 Verification Report

## Scope checked in this release package

- Python source AST/bytecode compilation.
- Alembic migration syntax and revision-chain metadata.
- SQLite smoke test for creation and rollback of migration 0017.
- Frontend TypeScript compiler diagnostics, where dependencies are available.
- ZIP integrity and SHA-256 manifest consistency.

## Important limits

A successful static check is not a production certification. Unless explicitly recorded in the delivery summary, this release has not been validated against a live PostgreSQL database, Redis/RQ worker, real Gmail/Microsoft OAuth account, marketplace provider, deployed Render API, deployed Vercel frontend, or a browser end-to-end session. The full frontend typecheck/build depends on installing the pinned npm packages. Do not infer that a cloud deployment has been performed.

## Manual smoke checklist

1. Run `alembic upgrade head` against a backup/staging database.
2. Sign in and open `/workspace`.
3. Save business goals and reload; confirm they persist for the signed-in account.
4. Create test overdue invoice/task records, due reminders, upcoming project deadlines, stale opportunities and over-capacity time entries; verify alerts are shown only for that account.
5. Create a pending proposal approval and pending email approval; verify each appears in the workspace.
6. Confirm no external action occurs merely by opening the workspace or saving goals.
7. Run `npm ci`, `npm run typecheck`, and `npm run build` in `frontend`.

## Checks executed while preparing this ZIP

- Python `compileall` passed for backend application and Alembic migration source.
- Python AST parsing passed for 38 backend application Python files.
- SQLite migration 0017 upgrade/insert/downgrade smoke test passed.
- 11 existing focused tests passed: business intelligence, finance forecast and marketplace service.
- TypeScript/TSX transpile syntax check passed for 6 frontend files.
- Full `tsc --noEmit` and Next.js production build were not run because `frontend/node_modules` is not present in this environment.
- FastAPI application import/runtime was not verified because the current environment is missing pinned runtime dependencies including `pgvector` and `python-jose`.
