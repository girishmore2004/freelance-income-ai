# Upgrade 2.5 → 2.6

1. Back up the PostgreSQL database.
2. Pull v2.6 and install `backend/requirements.txt`.
3. Keep the existing environment variables and secrets.
4. From `backend/`, run `alembic upgrade head`.
5. Restart API and RQ worker; redeploy frontend.
6. Open Agent Workflows, check metrics, start a test run and cancel it.
7. Call retention cleanup with `dry_run: true` first. Only set false after reviewing the eligible count.

Rollback: stop API/workers and restore the backup if needed, then deploy v2.5. The migration downgrade removes the two added metadata columns; it cannot restore intentionally deleted workflow history.
