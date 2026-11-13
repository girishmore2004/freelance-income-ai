# Upgrade 5.25.0 → 5.26.0

1. Back up PostgreSQL before deployment.
2. Deploy backend and frontend source.
3. Run `alembic upgrade head` from the backend environment.
4. Confirm the database revision is `0033_schedule_plan_governance`.
5. Open Business Intelligence and save a schedule draft.
6. Review the version and explicitly approve or reject it.
7. Test rollback only after confirming no later manual task-date edits exist.

## Behavior and safeguards

- Draft creation is read-only and stores a versioned snapshot.
- Approval is blocked when the underlying task, project, dependency, availability, capacity or milestone inputs have changed since draft creation.
- Approval updates `planned_start_date` and `planned_finish_date`; it never overwrites contractual `due_date`.
- Rollback is guarded: it refuses to overwrite a task whose planned dates changed after approval.
- All plan records are scoped to the authenticated owner.
