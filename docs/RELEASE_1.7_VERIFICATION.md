# Release 1.7 verification report

## Completed checks
- Python AST parsing across 80 backend source/test files.
- Four focused tests passed: two cash-flow forecast tests and two marketplace-registry regression tests.
- Migration chain check: `0015_delivery_finance` follows `0014_marketplace_foundation`.
- SQLite migration upgrade/downgrade smoke test passed for the four new tables.
- ZIP integrity and SHA-256 manifest validation.
- Static checks for all new route declarations and frontend routes.

## Implemented workflows
- Deliverable creation, task linkage, revisions and version hashes.
- Internal review gate bound to exact deliverable content.
- Manual delivery reference recording after internal approval.
- Client acceptance/change-request status recording after delivery.
- Planned invoice schedules, hash-bound approval and invoice record creation.
- Deterministic cash-flow rollup based on recorded due dates.
- User-scoped resource queries.

## Not run / not claimed
- Full backend pytest suite, FastAPI application startup, PostgreSQL migration execution, pgvector integration, Redis/RQ, live email delivery, production Vercel build, browser-based UI tests and deployment.
- Global `tsc` found no syntax errors after the fix, but the full typecheck is blocked by missing installed React/Node type dependencies (`node_modules` is absent).
- No client handover, invoice email, payment collection, refund or financial transaction was executed.

## Production verification
1. Back up PostgreSQL.
2. Run `alembic upgrade head` in the backend.
3. Run the full backend tests in the configured environment.
4. Run `npm ci && npm run typecheck && npm run build` in the frontend.
5. Verify tenant isolation using two test users.
6. Test review hash invalidation by editing a deliverable after submitting it for review.
7. Confirm invoice creation is rejected until the schedule is approved.
