# Operations runbook (3.1)

## Health

`GET /health` is the lightweight liveness endpoint. Probe it with:

```bash
python backend/scripts/check_health.py --url https://YOUR-API/health
```

A successful response means the endpoint responded, not that every dependency is healthy.

## Backups

Use `ops/backup_postgres.sh` with `DATABASE_URL`. It produces a custom-format dump and checksum. Keep backup files out of Git and outside the web root. Encrypt and restrict access.

## Restore drill

Restore only into a dedicated recovery database. The restore script requires `CONFIRM_RESTORE=YES`. Verify the checksum first, confirm the target host/database, and run migrations and application-level validation after restore.

## Incident checklist

1. Preserve logs and note the incident time in UTC.
2. Do not expose tokens, credentials, customer emails or invoice data in tickets.
3. Take a backup before destructive remediation when the database is accessible.
4. Roll back to the last known-good deployment if an application release caused the incident.
5. For data loss, restore into a separate database and validate before switching traffic.
6. Rotate credentials if exposure is suspected.
