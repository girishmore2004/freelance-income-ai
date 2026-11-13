# Upgrade 5.24.0 → 5.25.0

## Summary
Adds read-only capacity-aware delivery schedule recommendations. No database migration or new dependency is required.

## New endpoint
`GET /api/v1/analytics/schedule-recommendations?horizon_days=56`

The endpoint is authenticated and user-scoped. It reads active tasks, projects, task dependencies, availability blocks, milestones and profile weekly capacity.

## Scheduling behavior
- Uses explicit positive task effort estimates only.
- Allocates work across Monday–Friday using weekly capacity divided evenly across five weekdays.
- Subtracts user-entered unavailable hours on matching dates.
- Respects task planned-start dates and finish-to-start predecessor order.
- Does not schedule a successor if a predecessor is missing an effort estimate or cannot be scheduled.
- Flags dependency cycles, missing estimates, projected late tasks and project-level milestone impacts.
- Milestone impact is project-level because the current schema does not connect milestones to individual tasks.

## Safety and compatibility
- Read-only recommendations; no task mutation, client communication or deadline change.
- No schema migration and no new runtime dependency.
- Existing task and dependency records are unchanged.

## Deployment
1. Back up the database.
2. Deploy backend and frontend source.
3. No Alembic migration is required; latest schema remains `0032_task_dependencies`.
4. Open Business Intelligence and review the schedule recommendations.
5. Manually update task dates only after review.
