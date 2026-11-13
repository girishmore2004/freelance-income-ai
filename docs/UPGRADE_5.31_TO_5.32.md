# Upgrade v5.31.0 → v5.32.0

1. Back up PostgreSQL using `ops/backup_postgres.sh` or your managed database backup.
2. Deploy the v5.32.0 source to a staging environment first.
3. Install the exact backend dependencies from the project lock/requirements files.
4. Run `cd backend && alembic upgrade head`.
5. Deploy/restart the API and frontend.
6. Verify `GET /api/v1/deliverables/{id}/acceptance-history` returns event IDs and `GET /api/v1/deliverables/{id}/revisions` returns the two evidence-link fields.
7. In a test project, record a client `changes_requested` event, then create a `client_requested` revision linked to that event ID. Verify a foreign-user, wrong-deliverable, stale-revision or hash-mismatched ID is rejected.
8. For scope-change origin, link only a same-project record with status `approved` and `client_accepted=true`.

The migration is additive. Existing revision rows remain unlinked; no evidence is inferred from text, dates or revision origin. Do not reset the database.
