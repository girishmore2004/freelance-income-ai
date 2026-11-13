#!/usr/bin/env bash
set -euo pipefail

: "${BACKUP_FILE:?Set BACKUP_FILE to an existing pg_dump custom-format backup}"
: "${RESTORE_DATABASE_URL:?Set RESTORE_DATABASE_URL to a disposable NON-PRODUCTION database}"
RESTORE_MODE="${RESTORE_MODE:-list}"

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Backup file not found: $BACKUP_FILE" >&2
  exit 1
fi
if [[ ! -f "$BACKUP_FILE.sha256" ]]; then
  echo "Backup checksum file not found: $BACKUP_FILE.sha256" >&2
  exit 1
fi
if ! command -v pg_restore >/dev/null 2>&1; then
  echo "pg_restore is required (install PostgreSQL client tools)." >&2
  exit 1
fi
if ! command -v sha256sum >/dev/null 2>&1; then
  echo "sha256sum is required." >&2
  exit 1
fi

echo "Verifying backup checksum..."
sha256sum -c "$BACKUP_FILE.sha256"

echo "Validating PostgreSQL archive structure..."
pg_restore --list "$BACKUP_FILE" >/dev/null

if [[ "$RESTORE_MODE" == "list" ]]; then
  echo "Archive validation passed. No database was modified."
  echo "To restore into a disposable database, set RESTORE_MODE=restore and ALLOW_NONPRODUCTION_RESTORE=YES."
  exit 0
fi

if [[ "$RESTORE_MODE" != "restore" ]]; then
  echo "RESTORE_MODE must be 'list' or 'restore'." >&2
  exit 1
fi
if [[ "${ALLOW_NONPRODUCTION_RESTORE:-}" != "YES" ]]; then
  echo "Refusing restore: set ALLOW_NONPRODUCTION_RESTORE=YES only after confirming the target is disposable." >&2
  exit 1
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Set DATABASE_URL as the source/production URL so the script can reject restoring over it." >&2
  exit 1
fi

python - "$DATABASE_URL" "$RESTORE_DATABASE_URL" <<'PY'
import sys
from urllib.parse import urlparse, unquote

source = urlparse(sys.argv[1])
target = urlparse(sys.argv[2])
source_identity = (source.hostname, source.port or 5432, unquote(source.path.lstrip("/")))
target_identity = (target.hostname, target.port or 5432, unquote(target.path.lstrip("/")))
if source_identity == target_identity:
    raise SystemExit("Refusing restore: target database is identical to DATABASE_URL.")
if target.path.rstrip("/") in {"", "/postgres", "/template0", "/template1"}:
    raise SystemExit("Refusing restore: choose a dedicated disposable database, not a system database.")
if not target.scheme.startswith("postgres"):
    raise SystemExit("RESTORE_DATABASE_URL must be a PostgreSQL URL.")
PY

echo "WARNING: pg_restore --clean will replace objects in the target database."
echo "Target connection details are intentionally not printed."
pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error \
  --dbname="$RESTORE_DATABASE_URL" "$BACKUP_FILE"
echo "Restore completed. Run application-specific validation queries before considering the backup recoverable."
