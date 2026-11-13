# Upgrade v5.44.0 to v5.45.0

## Changes
- Serializes MFA setup, enable, disable and recovery-code rotation by locking the account row before checking state or writing changes.
- Adds security-readiness regression tests and an operator backup/restore rehearsal runbook.
- No schema migration. Alembic head remains `0045_mfa_and_login_lockout`.

## Deployment
1. Back up production PostgreSQL and verify the backup checksum/archive.
2. Merge/push the v5.45.0 source to GitHub.
3. Deploy the backend and worker, then the frontend if changed.
4. Confirm `/health` reports `5.45.0` and `/ready` is healthy.
5. Run the focused regression suite and then full GitHub Actions CI.
6. Perform a disposable PostgreSQL restore rehearsal before relying on the backup process.

No production migration command is required for this release. Preserve the existing `SECRET_KEY`, `DATABASE_URL`, `REDIS_URL` and SMTP settings.
