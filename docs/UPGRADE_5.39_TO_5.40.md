# Upgrade v5.39.0 to v5.40.0

## Included
- Immutable versioned archive manifests for explicitly closed projects.
- Archive integrity verification and JSON download.
- Post-closeout project outcome review.
- Retention policy proposal and approval workflow.
- Retention previews use the active approved retention period unless explicitly overridden.

## Database
Run Alembic migration `0042_post_closeout_archive_and_retention` after backing up PostgreSQL:
`cd backend && alembic upgrade head`

## New endpoints
- `POST /api/v1/projects/{project_id}/archive-manifests`
- `GET /api/v1/projects/{project_id}/archive-manifests`
- `GET /api/v1/archive-manifests/{manifest_id}/verify`
- `GET /api/v1/archive-manifests/{manifest_id}/download`
- `GET /api/v1/projects/{project_id}/outcome-review`
- `GET /api/v1/retention-policy`
- `GET /api/v1/retention-policy/reviews`
- `POST /api/v1/retention-policy/reviews`
- `POST /api/v1/retention-policy/reviews/{review_id}/decide`

## Safety
- Archive creation requires a completed project with an explicit closure record.
- Manifest downloads require successful hash and source-reference checks.
- Financial values are manually recorded and remain separated by currency.
- Evidence reference hashes cover the reference text, not external file contents.
- Retention approvals change preview timing only. No automatic deletion or archiving is performed.
- No client messages, contract actions or payment operations are triggered.
