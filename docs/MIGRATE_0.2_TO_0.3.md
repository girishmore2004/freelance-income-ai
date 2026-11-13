# Upgrade existing 0.2 deployment to 0.3

1. Back up your PostgreSQL database before deployment.
2. Pull/copy the 0.3 source into a new branch; do not overwrite your only working copy.
3. Add `REDIS_URL`, embedding provider/model and retrieval settings to the backend environment.
4. Deploy API and worker using the same database and Redis service.
5. Run `alembic upgrade head` once against the target database (the Docker API command does this at startup).
6. Start Redis and the RQ worker.
7. Confirm `/health`, login, opportunity listing and `/api/v1/background-jobs`.
8. Upload one small TXT/PDF portfolio document and test `/api/v1/portfolio/search`.
9. Queue a discovery job and verify it reaches `completed` or reports a clear feed error.
10. Keep the old deployment available until all checks pass.

Do not point two concurrently running release versions at the same database during schema migration.
