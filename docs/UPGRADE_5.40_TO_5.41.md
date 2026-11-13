# Upgrade v5.40.0 to v5.41.0

## Included
- Downloadable archive ZIP bundles with archive manifest JSON, approved handover PDF, project outcome JSON, verification report and SHA-256 checksums.
- Per-record evidence-reference report comparing archived reference text/hashes with the current source record references.
- Immutable archive supersession records linking an older archive version to a newer verified version.
- Immutable project recovery rehearsal checklist records.
- Expanded environment/API-key reference and final GitHub/Render/Neon/Redis deployment guide.

## Database
Back up PostgreSQL and apply migration `0043_archive_bundle_supersession_recovery`:

```bash
cd backend
alembic upgrade head
```

## New endpoints
- `GET /api/v1/archive-manifests/{manifest_id}/evidence-report`
- `GET /api/v1/archive-manifests/{manifest_id}/bundle.zip`
- `POST /api/v1/archive-manifests/{manifest_id}/supersede`
- `GET /api/v1/projects/{project_id}/archive-supersessions`
- `POST /api/v1/projects/{project_id}/recovery-rehearsals`
- `GET /api/v1/projects/{project_id}/recovery-rehearsals`

## Integrity and recovery limitations
- Reference verification checks exact stored reference strings and their hashes; it does not download, parse or authenticate linked external files.
- Recovery rehearsal checklists are human-reported records. The API does not execute a database restore, backup or frontend/API smoke test.
- Bundle SHA-256 is returned in `X-Archive-Bundle-SHA256`; `SHA256SUMS.txt` checksums each bundle file other than itself.
- Archive supersession never deletes or edits either archive manifest.
- No automatic retention purge is introduced.

## Deployment
Use `docs/FINAL_DEPLOYMENT_GUIDE_5.41.md` for exact GitHub, environment, database, Redis, Render, frontend, worker, migration, smoke-test and free-tier instructions.
