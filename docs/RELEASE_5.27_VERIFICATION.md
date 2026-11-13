# Release 5.27.0 verification

## Implemented
- Added nullable `ProjectTask.completed_at` and Alembic revision `0034_task_completion_tracking`.
- Task creation with status `done` records a timestamp; transition into `done` records it; reopening clears it.
- Added user-scoped `GET /api/v1/analytics/delivery-performance`.
- Added task-level effort variance, completion-date schedule variance and project-level sample-aware summaries.
- Added Business Intelligence presentation for task/project delivery performance.
- Corrected schedule-plan approval to include current milestone records in stale-input fingerprint validation.

## Checks performed
- Focused regression suite: 66 passed.
- `python -m compileall -q app alembic/versions`: passed.
- Static Alembic revision graph inspection: one head, `0034_task_completion_tracking`, parent `0033_schedule_plan_governance`.
- Frontend typecheck/build: not run; `frontend/node_modules` is absent.
- Alembic CLI/live database migration: not run; runtime import is blocked in this environment by missing `pgvector`.
- Live API/database and browser E2E: not run.

## Data interpretation
- Time entries are counted only when linked to a task and owned by the authenticated user.
- Missing time entries are unknown, not zero.
- Legacy completed tasks receive no inferred historical completion timestamp.
- Median absolute effort error is descriptive and has no predictive guarantee.
