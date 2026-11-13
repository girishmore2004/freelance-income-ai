# Security and backup/restore rehearsal runbook — v5.45.0

This is an operator procedure, not an automated restore service. Perform it during a maintenance window using an isolated disposable PostgreSQL database. Never point the rehearsal at the production database.

## 1. Before the rehearsal

- Confirm the current production release, database host/name, migration head and a maintenance contact.
- Ensure the backup destination is encrypted, access-controlled and off-host. The backup contains personal and client financial data.
- Install PostgreSQL client tools compatible with the server (`pg_dump`, `pg_restore`) and `sha256sum`.
- Use a separate disposable PostgreSQL database. Do not use `postgres`, `template0`, `template1`, or the production database.
- Record operator, UTC start time, source database identifier (redacted), target identifier (redacted), release and retention location. Never paste credentials into the record.

## 2. Create and validate a backup

Run from the repository root with the production `DATABASE_URL` set in a protected shell environment:

```bash
DATABASE_URL="$PRODUCTION_DATABASE_URL" BACKUP_DIR="./secure-backup-staging" bash ops/backup_postgres.sh
```

The script creates a custom-format `pg_dump`, validates its archive table of contents with `pg_restore --list`, and writes a SHA-256 sidecar. It refuses to overwrite an existing timestamped file. Restrict file permissions and transfer the backup to encrypted off-host storage immediately.

## 3. Validate and restore to a disposable target

Set both source and target URLs securely. The verification script compares their host/port/database identities and refuses a matching target. First run the non-destructive archive/checksum validation:

```bash
BACKUP_FILE="./secure-backup-staging/your-backup.dump" \
DATABASE_URL="$PRODUCTION_DATABASE_URL" \
RESTORE_DATABASE_URL="$DISPOSABLE_DATABASE_URL" \
RESTORE_MODE=list bash ops/verify_backup_restore.sh
```

Only after independently confirming that the target is disposable, run:

```bash
BACKUP_FILE="./secure-backup-staging/your-backup.dump" \
DATABASE_URL="$PRODUCTION_DATABASE_URL" \
RESTORE_DATABASE_URL="$DISPOSABLE_DATABASE_URL" \
RESTORE_MODE=restore ALLOW_NONPRODUCTION_RESTORE=YES \
bash ops/verify_backup_restore.sh
```

The restore replaces objects in the target. It must never be run against production. Do not expose connection URLs in terminal recordings, CI logs or support messages.

## 4. Post-restore validation

- Confirm `alembic current` reports `0045_mfa_and_login_lockout` (or the expected head for the exact backup release).
- Run read-only row-count and referential-integrity checks for users, projects, invoices, tasks, deliverables and audit records.
- Start the application against the disposable restored database only; check `/health` and `/ready`.
- Sign in using a designated test account; verify session validity and MFA status without exposing recovery codes.
- Confirm one known project/invoice and associated audit history are present. Do not use real client data in screenshots or reports.
- Record duration, failures, database engine/version, backup checksum, migration head and evidence references. Redact all secrets and personal data.

## 5. Recovery and security controls

- Keep the last known-good backup until a newer backup has passed a restore rehearsal.
- Store the backup and checksum together; verify SHA-256 before every restore.
- Keep `SECRET_KEY` and database credentials in the hosting secret manager. The application cannot decrypt existing TOTP secrets if `SECRET_KEY` is changed without a planned migration/recovery procedure.
- Restrict production DB access to the application, migration operator and designated administrators. Use least-privilege credentials where the hosting platform supports them.
- Rotate exposed credentials immediately; do not include them in issue reports.
- Treat the rehearsal as evidence of recoverability for that specific backup and environment only. It does not establish an RPO/RTO guarantee or prove all backups are recoverable.

## 6. MFA concurrency note

v5.45.0 serializes sensitive MFA state mutations by locking the account row with PostgreSQL `SELECT ... FOR UPDATE`. SQLite ignores row-level locks; therefore, concurrency correctness must be verified against PostgreSQL in CI/staging, not inferred from SQLite-only unit tests.
