# Upgrade 5.36.0 to 5.37.0

1. Back up the production database.
2. Deploy the source release.
3. Run `cd backend && alembic upgrade head`.
4. Restart the API and deploy the frontend.
5. Open Delivery & Finance Workspace, select a project, create a handover preview, review its JSON contents, and approve only if the preview is correct.
6. Export is local JSON only. The release does not send email or share files externally.

Migration `0040_delivery_handover_snapshots` creates a new table and indexes. It does not alter existing project, task, deliverable, issue, revision, acceptance, scope-change or invoice records. Do not reset the database.
