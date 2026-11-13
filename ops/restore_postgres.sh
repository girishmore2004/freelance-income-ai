#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL to the TARGET PostgreSQL connection string}"
BACKUP_FILE="${1:?Usage: DATABASE_URL=... $0 path/to/backup.dump}"
if [[ ! -f "$BACKUP_FILE" ]]; then echo "Backup file not found: $BACKUP_FILE" >&2; exit 2; fi
if [[ ! -f "$BACKUP_FILE.sha256" ]]; then
  echo "Backup checksum file not found: $BACKUP_FILE.sha256" >&2
  exit 4
fi
if ! command -v sha256sum >/dev/null 2>&1 || ! command -v pg_restore >/dev/null 2>&1; then
  echo "sha256sum and pg_restore are required." >&2
  exit 5
fi
echo "Verifying backup checksum..."
(cd "$(dirname "$BACKUP_FILE")" && sha256sum -c "$(basename "$BACKUP_FILE").sha256")
echo "Validating PostgreSQL archive structure..."
pg_restore --list "$BACKUP_FILE" >/dev/null
python - "$DATABASE_URL" <<'PY'
import sys
from urllib.parse import urlparse
parsed = urlparse(sys.argv[1])
if not parsed.scheme.startswith("postgres") or not parsed.hostname or not parsed.path.strip("/"):
    raise SystemExit("DATABASE_URL must identify a PostgreSQL database target.")
if parsed.path.rstrip("/") in {"/postgres", "/template0", "/template1"}:
    raise SystemExit("Refusing restore to a PostgreSQL system database.")
PY
if [[ "${CONFIRM_RESTORE:-}" != "YES" ]]; then
  echo "Refusing restore: this overwrites objects in the target database." >&2
  echo "Take a fresh backup, verify the target, then rerun with CONFIRM_RESTORE=YES." >&2
  exit 3
fi
pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error --single-transaction --dbname "$DATABASE_URL" "$BACKUP_FILE"
echo "Restore command completed. Run migrations, application smoke tests and record validation before reopening traffic."
