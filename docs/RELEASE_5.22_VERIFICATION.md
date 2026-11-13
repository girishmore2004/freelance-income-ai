# Release v5.22.0 verification

## Scope
Forward workload commitment planning from task-level estimated effort and planned dates.

## Checks
- Unit tests: `pytest -q tests/test_commitment_planning_v522.py tests/test_capacity_planning_v521.py tests/test_service_intelligence_v519.py`
- Syntax: `python -m compileall -q app`
- Migration: `alembic upgrade head` against a disposable PostgreSQL database, then downgrade/upgrade if rollback is being validated.
- Frontend: `npm ci && npm run typecheck && npm run build`.

## Interpretation
Weekly task hours are distributed evenly over the inclusive planned date range. This is an estimate, not calendar time blocking. Weekly capacity uses the user's profile target. Leave, meetings, external obligations and task dependencies are not modeled.
