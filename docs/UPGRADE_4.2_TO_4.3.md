# Upgrade 4.2.0 → 4.3.0

## Scope
This is an incremental release on the existing FastAPI / Next.js / PostgreSQL / Redis / RQ / LangGraph architecture. No schema migration or new runtime dependency is added.

## Changes
- Adds `backend/tests/test_authenticated_business_journey_v43.py`, a deterministic authenticated API journey from opportunity creation through proposal approval, project attribution, deliverable review and unpaid invoice creation. The AI proposal function is stubbed; no provider is contacted.
- Adds `ops/verify_backup_restore.sh`. Default mode verifies the SHA-256 sidecar and archive listing only. Actual restore requires `RESTORE_MODE=restore`, `ALLOW_NONPRODUCTION_RESTORE=YES`, a separate `RESTORE_DATABASE_URL`, and `DATABASE_URL` for a source/production identity comparison.
- Adds `.github/workflows/staging-load.yml`, a manually triggered low-volume k6 smoke workflow. It requires a confirmation checkbox and an HTTPS hostname containing `staging`, `stage` or `stg`. Results are uploaded as a 14-day artifact.
- Updates version metadata to 4.3.0.

## Upgrade
1. Back up the repository and database.
2. Merge/extract this ZIP over the existing repository; preserve `.git`, `.env` and deployment configuration.
3. No Alembic migration or new production environment variable is required.
4. Run backend tests with the declared dependencies and a migrated PostgreSQL/pgvector test database.
5. Use `ops/backup_postgres.sh` to create a backup and `ops/verify_backup_restore.sh` in list-only mode to verify its checksum/archive.
6. Perform an actual restore only against a dedicated disposable database after checking the target carefully.
7. Trigger the k6 workflow only against an isolated staging deployment, never production.

## Safety
The authenticated journey creates only test database records. Proposal generation is stubbed. Mark-ready explicitly reports `external_submission=not_performed`. The delivery endpoint records a reference; it does not transfer files. Invoice creation produces an unpaid record and does not send an invoice or collect payment. The restore script refuses to operate unless its explicit restore flags are provided and the target differs from `DATABASE_URL`.
