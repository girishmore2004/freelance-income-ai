# Release 1.8 verification report

## Checks completed
- Python AST parsing passed for 83 backend source and test files.
- Eleven focused tests passed across business intelligence, cash-flow forecast and marketplace registry.
- SQLite migration 0016 upgrade/downgrade smoke test passed, including the nullable foreign-key column and index.
- TypeScript compiler reported zero syntax diagnostics in the inspected frontend project files.
- Full TypeScript typecheck / Next production build could not be completed because the project dependencies are not installed in this packaging environment (`node_modules` is absent).
- ZIP integrity and SHA-256 manifest verified.

## Implemented behavior
- Conversion funnel based on saved opportunities, proposals, application tracking and manually recorded feedback.
- Source performance with explicit project-to-opportunity attribution and paid-invoice revenue by currency.
- Capacity analytics using profile weekly-hours targets and recorded time entries.
- Project profitability with safeguards for missing billable rates and mixed currencies.
- Earnings outlook separating paid, overdue, due, scheduled and open proposal values.
- Historical weighted pipeline estimate is withheld until at least five decided feedback outcomes exist.
- User-scoped project attribution endpoint.
- `/analytics` frontend page and dashboard navigation.

## Not run / not claimed
- Full backend pytest suite, full FastAPI startup, production PostgreSQL migration, PostgreSQL query validation, Redis/RQ, frontend typecheck/production build, browser UI tests, live provider APIs and production deployment.
- No exchange-rate conversion, client payment prediction, automated marketplace submission or external financial action was executed.
- Source revenue excludes projects that have not been explicitly linked to an originating opportunity.
- Profitability excludes tax, fees, overhead and unrecorded work.

## Production verification
1. Back up PostgreSQL.
2. Run `alembic upgrade head` from `backend/`.
3. Run the full backend tests in the deployment environment.
4. Run `npm ci && npm run typecheck && npm run build` in `frontend/`.
5. Verify tenant isolation with two separate test users.
6. Link a test project to an opportunity and confirm only paid invoices on that project appear in source revenue.
7. Confirm mixed currencies are never combined.
