#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL to the PostgreSQL connection string}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/freelance-income-ai-$STAMP.dump"
umask 077
if [[ -e "$OUT" || -e "$OUT.sha256" ]]; then
  echo "Refusing to overwrite an existing backup: $OUT" >&2
  exit 2
fi
pg_dump --format=custom --no-owner --no-acl --exit-on-error "$DATABASE_URL" --file "$OUT"
pg_restore --list "$OUT" >/dev/null
(cd "$BACKUP_DIR" && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256")
echo "Backup created: $OUT"
echo "Store it encrypted and off-host. Do not commit backups to Git."
