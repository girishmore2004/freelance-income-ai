# Release v5.21.0 verification

## Feature

Capacity-aware pursuit planner: estimates remaining weekly capacity from profile weekly-hours target minus recorded active-project workload over a configurable 7–90 day lookback. Compares opportunity estimated effort against the remaining capacity until its recorded deadline.

## Data caveats

- Time entries are historical observations, not future bookings.
- Active projects without time entries are surfaced as untracked and reduce confidence.
- Missing effort or deadline remains unknown.
- Task records are displayed as workload context only; no hour estimate is fabricated.

## Verification status

Run `pytest -q tests/test_capacity_planning_v521.py` and the prior focused regression suite in an environment with backend requirements installed. Run `python -m compileall -q app` for syntax validation. Frontend production build requires installed frontend dependencies.
