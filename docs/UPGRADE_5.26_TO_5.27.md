# Upgrade 5.26.0 → 5.27.0

## Changes
- Adds nullable `project_tasks.completed_at` for an explicit completion timestamp.
- Adds `GET /api/v1/analytics/delivery-performance`.
- Adds actual-versus-estimated effort and planned-versus-recorded completion reporting to Business Intelligence.
- Task transition to `done` records the timestamp; reopening a task clears it. Existing rows remain NULL so historical completion dates are not invented.
- Fixes schedule approval fingerprint validation to include the user's milestones.

## Deployment
1. Back up PostgreSQL.
2. Deploy the backend and frontend source.
3. Run `alembic upgrade head` (new revision: `0034_task_completion_tracking`).
4. Restart the API.
5. Deploy the frontend.
6. Start recording time against individual tasks. Task-level actual effort excludes unlinked time entries.

## Compatibility and limitations
- Migration is additive and nullable; existing task records are preserved.
- Existing tasks already marked done will have unknown `completed_at` until reopened and completed again; no historical date is inferred.
- Effort comparisons require an estimate and task-linked time entries.
- Schedule comparisons require both `planned_finish_date` and an explicit `completed_at`.
- Statistics are descriptive, not guarantees; sample sizes are exposed.
- No new runtime dependencies. No client communication or automatic date changes.

## Verification
Run focused tests:

```bash
cd backend
pytest -q tests/test_delivery_performance_v527.py tests/test_schedule_plan_governance_v526.py tests/test_schedule_recommendations_v525.py tests/test_dependency_planning_v524.py
```
