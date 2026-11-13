# Release 3.1 — Browser regression and operational recovery

## Scope

This release continues directly from 3.0. It does not replace the architecture or remove existing features.

### Browser regression suite

The Playwright suite checks:
- Landing page renders the product sign-in and account-creation actions.
- A rejected login response is shown to the user and does not create a local session.
- Workspace, action planner, workflow monitor, AI coach, delivery and analytics routes show a sign-in prompt when no token exists.
- These tested routes do not raise uncaught browser page errors in the tested unauthenticated state.

The tests deliberately mock the rejected login response. They do not prove live authentication, account registration, database persistence, or authenticated business workflows. Those remain covered by backend tests and must be exercised in a configured staging environment.

### PostgreSQL backup and restore

`ops/backup_postgres.sh` creates a custom-format `pg_dump` and SHA-256 checksum. `ops/restore_postgres.sh` requires an explicit `CONFIRM_RESTORE=YES` guard and is destructive to objects in the target database.

Example backup:

```bash
export DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/DB'
bash ops/backup_postgres.sh
```

Example restore into an isolated recovery database:

```bash
export DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/RECOVERY_DB'
CONFIRM_RESTORE=YES bash ops/restore_postgres.sh ./backups/your-backup.dump
```

Before restore:
1. Verify the backup checksum with `sha256sum -c BACKUP.dump.sha256`.
2. Confirm the target database name and host independently.
3. Take a fresh backup of the target if it contains data.
4. Restore into an isolated recovery database first.
5. Run `alembic upgrade head`, application tests and record-count/business validation.
6. Do not switch production traffic until the recovery test is approved.

The application does not schedule backups automatically. Configure a secure provider-managed schedule or a protected host-level job. Encrypt backups at rest and in transit, restrict access, define retention, and test recovery regularly.

### Health probe

```bash
python backend/scripts/check_health.py --url https://YOUR-API/health
```

The script checks the existing `/health` endpoint only. It does not assert database, Redis, queue, model-provider or external-source readiness.

## Safety and product boundaries

All external actions remain human-approved. This release does not add automatic proposal submission, email sending, contract acceptance, invoice issuance, payment execution or marketplace scraping. The backup scripts do not upload data anywhere.

## No migration

No database schema migration is required for 3.1.
