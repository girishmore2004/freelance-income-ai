#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/backend"

echo "[1/4] Validate production environment (secrets are never printed)"
python scripts/production_preflight.py

echo "[2/4] Validate installed Python dependency consistency"
python -m pip check

echo "[3/4] Verify Alembic has exactly one migration head"
HEADS="$(alembic heads)"
printf '%s\n' "$HEADS"
HEAD_COUNT="$(printf '%s\n' "$HEADS" | grep -c '(head)' || true)"
if [[ "$HEAD_COUNT" != "1" ]]; then
  echo "Expected exactly one Alembic head; found $HEAD_COUNT." >&2
  exit 1
fi

echo "[4/4] Migration policy"
if [[ "${APPLY_MIGRATIONS:-NO}" == "YES" ]]; then
  echo "Applying migrations to DATABASE_URL. Confirm this is the intended deployment database."
  alembic upgrade head
else
  echo "Migration not applied. Set APPLY_MIGRATIONS=YES only during a planned deployment."
fi

echo "Preflight completed."
