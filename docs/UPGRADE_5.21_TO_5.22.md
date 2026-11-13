# Upgrade v5.21.0 → v5.22.0

1. Back up PostgreSQL using `ops/backup_postgres.sh`.
2. Deploy the backend and run `alembic upgrade head` from the backend environment.
3. Deploy the frontend.
4. In Delivery → Project tasks, add an estimated effort, planned start date and due date to tasks you want included in the forward plan.
5. Open Business Intelligence → Forward workload commitments and review weekly capacity.

The migration adds nullable `project_tasks.estimated_hours` and non-null `project_tasks.planned_start_date` (default empty string). Existing tasks are preserved. Missing estimates and planned dates are explicitly reported, not interpreted as zero workload. Rollback: `alembic downgrade 0029_saved_marketplace_searches`; this removes the two new columns and therefore discards values entered for them.
