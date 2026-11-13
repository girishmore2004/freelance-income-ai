# Upgrade 5.23.0 → 5.24.0

## What's new
- Explicit, user-owned finish-to-start task dependency edges.
- Same-project and same-user validation; self-links, duplicates and cycles are rejected.
- Read-only dependency analytics with topological validation, longest-chain estimated hours, unknown-effort flags and schedule-overlap review prompts.
- Analytics dashboard controls for creating dependencies and reviewing the resulting sequence.

## Database
Run `alembic upgrade head`. Migration `0032_task_dependencies` creates the dependency edge table. Existing task records are unchanged; no dependencies are inferred or backfilled.

## API
- `GET /api/v1/analytics/dependency-planning`
- `POST /api/v1/tasks/{task_id}/dependencies` with `{"predecessor_task_id":"..."}`
- `DELETE /api/v1/tasks/dependencies/{dependency_id}`

All endpoints require authentication and are scoped to the current user's tasks. The dependency direction is predecessor → successor (finish-to-start).

## Safety and limitations
The planner does not move task dates, change statuses, notify clients, or perform external actions. Critical-path hours sum entered estimates and do not represent elapsed calendar time. Missing estimates are explicitly flagged. Cross-project dependencies are not supported.
