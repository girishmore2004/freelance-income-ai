# Upgrade v4.5.0 to v4.6.0

This is an additive operational release. It does not replace the application architecture or change the database schema.

## Changes
- Adds `ops/package_release.py`, a reproducible source ZIP packager.
- The packager reads the semantic version from `VERSION`, excludes local secrets, databases, backups, caches, virtual environments and dependency directories, writes file-level SHA-256 manifests, then validates archive CRC and source checksums.
- Adds packager regression tests under `ops/tests/`.
- Backup creation now refuses timestamp collisions, validates the generated PostgreSQL archive and only then writes its checksum.
- Restore now requires a checksum sidecar, verifies the checksum and archive structure, validates the PostgreSQL target, and uses `pg_restore --exit-on-error --single-transaction`.
- No database migration or new runtime dependency is introduced.

## Upgrade steps
1. Back up the current database using `bash ops/backup_postgres.sh`.
2. Commit and push the v4.6.0 source changes.
3. Run the existing GitHub Actions full CI workflow.
4. Deploy using `docs/DEPLOYMENT_PRODUCTION.md`; no schema migration is required for this release.
5. Retain the previous release ZIP and database backup for rollback.

## Create a release ZIP
From the repository root:

```bash
python ops/package_release.py --output ../freelance-income-ai-v4.6.0.zip
```

The command prints the ZIP path, byte size, file count and validation status. Keep the generated ZIP outside the source directory. Review the included manifest before distributing it.

## Restore safety
Restores are destructive. The restore script now requires `CONFIRM_RESTORE=YES`, a valid `.sha256` sidecar and PostgreSQL client tools. Use a disposable database for restore drills. Never point a restore drill at production.
