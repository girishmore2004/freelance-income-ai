# Upgrade v5.20.0 → v5.21.0

## Capacity-aware opportunity pursuit planning

- Added `backend/app/services/capacity_planning.py` for deterministic workload and deadline feasibility estimates.
- Added authenticated `GET /api/v1/analytics/capacity-planning?lookback_days=28`.
- Uses the authenticated user's profile weekly-hours target, active projects, project time entries and opportunity estimated-hours/deadline fields.
- Active projects without time logs are explicitly identified and reduce confidence; missing opportunity effort/deadline yields unknown feasibility.
- Added the capacity planner to Business Intelligence analytics.
- Added focused regression tests in `backend/tests/test_capacity_planning_v521.py`.

## Compatibility and safety

- No database migration or new Python dependency.
- Read-only analytics; no project, opportunity, proposal or task records are modified.
- No external client communication, proposal submission or contract action is triggered.
- Historical logged hours are a planning baseline, not a confirmed future calendar. Existing project tasks have no reliable effort estimates and are not converted into hours.

## Deployment

Replace the source with this release, install the existing backend requirements, and deploy frontend/backend as usual. No migration command is required for this release.
