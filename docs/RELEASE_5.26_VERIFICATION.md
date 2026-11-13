# Release 5.26.0 verification

## Added

- Versioned schedule plan snapshots and decision history.
- Explicit draft approval/rejection with decision timestamps and reason.
- SHA-256 stale-input fingerprint validation.
- Apply recommended planned start/finish dates without changing contractual due dates.
- Guarded rollback that preserves subsequent manual edits.
- Authenticated user-scoped API and Analytics UI controls.

## Tests

- Deterministic, order-independent input fingerprint.
- Fingerprint changes when effort, capacity or milestone data changes.
- Existing schedule recommendation tests remain part of focused regression suite.

## Deployment caveats

- Run Alembic migration `0033_schedule_plan_governance` before using plan versioning.
- Frontend production build and live database/API integration must be verified in the deployment environment.

## Checks run in the source workspace

- `python -m compileall -q app tests` — passed.
- Focused pytest suite: `test_schedule_plan_governance_v526.py`, `test_schedule_recommendations_v525.py`, `test_dependency_planning_v524.py`, `test_calendar_intelligence_v523.py`, `test_commitment_planning_v522.py`, `test_portfolio_matching_v520.py` — 22 passed.
- Importing `app.main` was not possible in this workspace because `pgvector` is not installed. This is an environment limitation, not a passing integration check.
- Frontend build was not run because frontend dependencies are not installed in this workspace.
